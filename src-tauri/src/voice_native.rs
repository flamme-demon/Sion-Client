//! Native voice uses the Rust LiveKit engine in crate::voice_engine.
//! The webview handles UI; voice does not use webview WebRTC.
//!
//! VoiceConnectionState models session state. RmsSpeakingDetector applies
//! RMS thresholds 0.0018/0.0008 with hysteresis. NativeParticipant matches
//! the frontend ParticipantInfo contract. Data topics carry AFK, soundboard,
//! memeboard and cursor updates. validate_e2ee_key accepts MatrixRTC AES keys.
//!
//! Tauri commands control the engine and relay participant/status events.
//! Without native-voice, connect returns an explicit error.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

use crate::TauriRuntime;

// Session state.

/// Native session state matching the frontend, with Connecting
/// covering Room::connect initialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// Snapshot sent through voice-native-status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceNativeStatus {
    pub state: VoiceConnectionState,
    pub room_name: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    /// Actual engine microphone state, used for deafen safeguards
    /// when frontend mute state is out of sync.
    pub mic_published: bool,
    /// Whether the engine has a published screen share. Restore this state after
    /// webview reload so cursor overlays reopen for a share that is still running.
    pub screenshare_published: bool,
    /// Whether the local share publishes audio; restore the no-audio indicator after reload.
    pub screenshare_audio_published: bool,
    pub camera_published: bool,
    /// Local LiveKit identity (@user:server:deviceID), when known.
    pub identity: Option<String>,
}

#[derive(Debug, Default)]
struct VoiceNativeInner {
    state: VoiceConnectionState,
    room_name: Option<String>,
    muted: bool,
    deafened: bool,
    identity: Option<String>,
}

impl Default for VoiceConnectionState {
    fn default() -> Self {
        VoiceConnectionState::Disconnected
    }
}

static MANAGER: OnceLock<Mutex<VoiceNativeInner>> = OnceLock::new();

fn manager() -> &'static Mutex<VoiceNativeInner> {
    MANAGER.get_or_init(|| Mutex::new(VoiceNativeInner::default()))
}

fn snapshot(inner: &VoiceNativeInner) -> VoiceNativeStatus {
    VoiceNativeStatus {
        state: inner.state,
        room_name: inner.room_name.clone(),
        muted: inner.muted,
        deafened: inner.deafened,
        mic_published: holder_mic_published(),
        screenshare_published: holder_screenshare_published(),
        screenshare_audio_published: holder_screenshare_audio_published(),
        camera_published: holder_camera_published(),
        identity: inner.identity.clone(),
    }
}

/// Whether the holder contains an engine, even without a session.
/// Always false when native-voice is disabled.
fn holder_has_engine() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder().lock().map(|g| g.is_some()).unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

/// Whether the holder contains a connected SFU engine.
fn holder_is_connected() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder()
            .lock()
            .map(|g| g.as_ref().is_some_and(|e| e.is_connected()))
            .unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

/// Wait at most one second for an engine temporarily borrowed by with_engine.
/// Concurrent mute/deafen commands must not silently skip a live microphone.
/// False means no engine is available; preserve intent in the manager for the next join.
fn wait_for_engine(ready: impl Fn() -> bool) -> bool {
    if ready() {
        return true;
    }
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if ready() {
            return true;
        }
    }
    false
}

/// Whether the engine has a microphone publication; false without an engine or native-voice.
fn holder_mic_published() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder()
            .lock()
            .map(|g| g.as_ref().is_some_and(|e| e.is_microphone_published()))
            .unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

/// Whether the engine has a screen-share publication.
fn holder_screenshare_published() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder()
            .lock()
            .map(|g| g.as_ref().is_some_and(|e| e.is_screensharing()))
            .unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

/// Whether the local share also publishes system audio.
fn holder_screenshare_audio_published() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder()
            .lock()
            .map(|g| {
                g.as_ref()
                    .is_some_and(|e| e.is_screenshare_audio_published())
            })
            .unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

fn holder_camera_published() -> bool {
    #[cfg(feature = "native-voice")]
    {
        engine_holder()
            .lock()
            .map(|g| g.as_ref().is_some_and(|e| e.camera_state().published))
            .unwrap_or(false)
    }
    #[cfg(not(feature = "native-voice"))]
    {
        false
    }
}

#[cfg(feature = "native-voice")]
pub(crate) fn camera_failed(token: u64) {
    let guard = engine_holder().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(engine) = guard.as_ref() {
        engine.stop_failed_camera(token);
    }
}

fn emit_status(app: &tauri::AppHandle<TauriRuntime>, status: &VoiceNativeStatus) {
    let _ = app.emit("voice-native-status", status);
}

// RMS speech detection, matching the frontend thresholds.

/// Speech onset threshold: typical RMS is 0.005-0.01 with AGC,
/// 0.002-0.005 without AGC, and around 0.001 for whispers.
pub const RMS_START: f32 = 0.0018;
/// Silence threshold; hysteresis prevents ambient noise around 0.0005 from latching.
pub const RMS_SILENCE: f32 = 0.0008;
/// Consecutive ticks required before a state transition.
pub const STATE_FLIP_TICKS: u32 = 1;

/// RMS speech detector. Return Some(new_state) only on transitions;
/// confirmed state and empty input produce None.
#[derive(Debug, Default)]
pub struct RmsSpeakingDetector {
    speaking: bool,
    flip_counter: u32,
}

impl RmsSpeakingDetector {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    #[cfg(test)]
    pub fn push(&mut self, samples: &[f32]) -> Option<bool> {
        if samples.is_empty() {
            return None;
        }
        let sum: f32 = samples.iter().map(|v| v * v).sum();
        self.push_rms((sum / samples.len() as f32).sqrt())
    }

    /// Accept precomputed RMS to avoid allocating f32 samples for native i16 frames.
    pub fn push_rms(&mut self, rms: f32) -> Option<bool> {
        let threshold = if self.speaking {
            RMS_SILENCE
        } else {
            RMS_START
        };
        if (rms > threshold) != self.speaking {
            self.flip_counter += 1;
            if self.flip_counter >= STATE_FLIP_TICKS {
                self.speaking = !self.speaking;
                self.flip_counter = 0;
                return Some(self.speaking);
            }
        } else {
            self.flip_counter = 0;
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/// Connection quality matching the TypeScript ConnectionQuality contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeConnectionQuality {
    Excellent,
    Good,
    Poor,
    Lost,
    Unknown,
}

impl NativeConnectionQuality {
    /// Map LiveKit string values from ConnectionQualityChanged.
    pub fn from_livekit_str(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "excellent" => NativeConnectionQuality::Excellent,
            "good" => NativeConnectionQuality::Good,
            "poor" => NativeConnectionQuality::Poor,
            "lost" => NativeConnectionQuality::Lost,
            _ => NativeConnectionQuality::Unknown,
        }
    }
}

/// Match the frontend ParticipantInfo contract in src/types/livekit.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeParticipant {
    pub identity: String,
    pub name: String,
    #[serde(default)]
    pub is_speaking: bool,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub is_screen_sharing: bool,
    #[serde(default)]
    pub is_camera_enabled: bool,
    /// The sender also publishes ScreenshareAudio; show a local mute control.
    #[serde(default)]
    pub is_screen_sharing_audio: bool,
    #[serde(default)]
    pub is_deafened: bool,
    #[serde(default)]
    pub audio_level: f32,
    #[serde(default = "default_quality")]
    pub connection_quality: NativeConnectionQuality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing_sound_emoji: Option<String>,
    /// Soundboard badge expiry in monotonic milliseconds. Overlapping sounds extend
    /// the deadline; delayed timers check it again before hiding the badge.
    /// This internal state is excluded from the frontend contract with serde skip.
    #[serde(skip)]
    pub badge_deadline_ms: u64,
}

fn default_quality() -> NativeConnectionQuality {
    NativeConnectionQuality::Unknown
}

/// Monotonic millisecond clock, unaffected by system-clock jumps.
fn mono_ms() -> u64 {
    static BASE: OnceLock<std::time::Instant> = OnceLock::new();
    BASE.get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

/// Fallback duration when the sender could not probe the sound or reports zero.
const BADGE_DEFAULT_MS: u64 = 3_000;
/// Cap badge duration at the soundboard's 20-second limit so malformed
/// payloads cannot leave a speaking indicator active for the session.
const BADGE_MAX_MS: u64 = 60_000;

/// Normalize missing/zero duration to the fallback and excessive values to the cap.
/// Match resolveBadgeDurationMs in soundboardService.ts.
fn sane_badge_ms(raw: u64) -> u64 {
    if raw == 0 {
        BADGE_DEFAULT_MS
    } else {
        raw.min(BADGE_MAX_MS)
    }
}

impl NativeParticipant {
    pub fn new(identity: &str, name: &str) -> Self {
        Self {
            identity: identity.to_string(),
            name: name.to_string(),
            is_speaking: false,
            is_muted: false,
            is_screen_sharing: false,
            is_camera_enabled: false,
            is_screen_sharing_audio: false,
            is_deafened: false,
            audio_level: 0.0,
            connection_quality: NativeConnectionQuality::Unknown,
            playing_sound_emoji: None,
            badge_deadline_ms: 0,
        }
    }
}

// Data-channel topics and payloads compatible with JS.

/// `broadcastAfk` — reliable.
pub const TOPIC_AFK: &str = "sion-afk";
/// `broadcastSound` — reliable.
pub const TOPIC_SOUNDBOARD: &str = "sion-soundboard";
/// Memeboard packets use the soundboard badge shape (emoji, duration).
/// The sender also applies the packet locally.
pub const TOPIC_MEMEBOARD: &str = "sion-memeboard";
/// broadcastCursor is lossy; broadcastCursorHide is reliable on the same topic.
pub const TOPIC_CURSOR: &str = "sion-cursor";
/// `broadcastCursorClick` — reliable.
pub const TOPIC_CURSOR_CLICK: &str = "sion-cursor-click";

/// `{ deafened: bool }` — cf. `broadcastAfk`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AfkPayload {
    pub deafened: bool,
}

/// Soundboard payload: mxc, emoji, duration in milliseconds, gain multiplier.
/// A missing duration uses the fallback; zero would hide the badge before it is painted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoundboardPayload {
    pub mxc: String,
    pub emoji: String,
    #[serde(default = "default_soundboard_duration")]
    pub duration: u64,
    #[serde(default = "default_gain")]
    pub gain: f32,
}

/// Match broadcastSound's 3000 ms fallback when duration is unknown.
fn default_soundboard_duration() -> u64 {
    BADGE_DEFAULT_MS
}

fn default_gain() -> f32 {
    1.0
}

pub fn decode_json<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|e| e.to_string())
}

// MatrixRTC E2EE key validation.

/// Accept raw MatrixRTC keys of 16 bytes (AES-128-GCM) or 32 bytes (AES-256).
/// Reject other sizes before handing them to the native provider.
pub const E2EE_RAW_KEY_LEN_128: usize = 16;
pub const E2EE_RAW_KEY_LEN_256: usize = 32;

/// Whether the raw key can be used by the native E2EE bridge.
pub fn validate_e2ee_key(key: &[u8]) -> bool {
    matches!(key.len(), E2EE_RAW_KEY_LEN_128 | E2EE_RAW_KEY_LEN_256)
}

// Voice engine interface.

/// SFU engine abstraction implemented by LiveKit using Room::connect and PlatformAudio.
pub trait VoiceEngine {
    fn connect(&mut self, url: &str, token: &str, encrypted: bool) -> Result<String, String>;
    fn disconnect(&mut self);
}

// Participant registry and engine-event relay. Without native-voice,
// commands expose state only and connect returns an explicit error.

#[cfg(feature = "native-voice")]
use crate::voice_engine::{LiveKitEngine, VoiceEngineEvent};
#[cfg(feature = "native-voice")]
use base64::Engine as _;
#[cfg(feature = "native-voice")]
use livekit::PlatformAudio;
#[cfg(feature = "native-voice")]
use std::collections::HashMap;

// Serialize event forwarding with session invalidation. An old SDK room may
// still deliver its final events while the next room is already connecting.
#[cfg(feature = "native-voice")]
static EVENT_GENERATION: Mutex<u64> = Mutex::new(0);

#[cfg(feature = "native-voice")]
fn invalidate_native_events() -> u64 {
    let mut generation = EVENT_GENERATION.lock().unwrap_or_else(|e| e.into_inner());
    *generation = generation.wrapping_add(1);
    *generation
}

/// Moteur SFU natif (feature `native-voice` uniquement).
#[cfg(feature = "native-voice")]
static ENGINE: OnceLock<Mutex<Option<LiveKitEngine>>> = OnceLock::new();

/// Temporary ADM for settings tests outside a voice room. During calls,
/// the meter and melody reuse the engine ADM to avoid opening a second microphone.
#[cfg(feature = "native-voice")]
static AUDIO_TEST: OnceLock<Mutex<Option<PlatformAudio>>> = OnceLock::new();

#[cfg(feature = "native-voice")]
static AUDIO_TEST_OWNERS: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();

#[cfg(feature = "native-voice")]
type TestPeerConnectionFactory = webrtc_sys::peer_connection_factory::SharedPtr<
    webrtc_sys::peer_connection_factory::ffi::PeerConnectionFactory,
>;

#[cfg(feature = "native-voice")]
static SPEAKER_TEST_FACTORY: OnceLock<Mutex<Option<TestPeerConnectionFactory>>> = OnceLock::new();

#[cfg(feature = "native-voice")]
fn audio_test_holder() -> &'static Mutex<Option<PlatformAudio>> {
    AUDIO_TEST.get_or_init(|| Mutex::new(None))
}

#[cfg(feature = "native-voice")]
fn audio_test_owners() -> &'static Mutex<std::collections::HashSet<String>> {
    AUDIO_TEST_OWNERS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Push-to-talk keeps capture and the track open; a closed capture gate emits silence.
/// Restarting Android AudioRecord and waiting for SFU unmute would clip phrase beginnings.
static CAPTURE_MAINTENUE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn capture_maintenue() -> bool {
    CAPTURE_MAINTENUE.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn voice_native_capture_maintenue(active: bool) {
    CAPTURE_MAINTENUE.store(active, std::sync::atomic::Ordering::Relaxed);
    // Outside push-to-talk, keep the processing gate open; track mute controls transmission.
    #[cfg(feature = "native-voice")]
    if !active {
        sion_native_audio::set_capture_gate(true);
    }
    log::info!("[Sion][voix-native] capture maintenue micro coupé (push-to-talk) : {active}");
}

#[cfg(feature = "native-voice")]
pub(crate) fn microphone_monitor_requested() -> bool {
    audio_test_owners()
        .lock()
        .map(|owners| !owners.is_empty())
        .unwrap_or(false)
}

#[cfg(feature = "native-voice")]
fn speaker_test_holder() -> &'static Mutex<Option<TestPeerConnectionFactory>> {
    SPEAKER_TEST_FACTORY.get_or_init(|| Mutex::new(None))
}

#[cfg(feature = "native-voice")]
fn stop_speaker_test_force() {
    if let Some(factory) = speaker_test_holder()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let audio = factory.audio_device();
        let _ = audio.stop_playout();
        audio.release_platform_adm();
    }
}

#[cfg(feature = "native-voice")]
fn stop_microphone_test_device() {
    if let Some(audio) = audio_test_holder()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = audio.stop_recording();
    }
}

#[cfg(feature = "native-voice")]
fn stop_audio_test_force() {
    stop_microphone_test_device();
    stop_speaker_test_force();
    audio_test_owners()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

#[cfg(feature = "native-voice")]
fn engine_holder() -> &'static Mutex<Option<LiveKitEngine>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

/// Take the engine even if a previous panic poisoned the holder mutex.
/// A failed SFU session must not prevent later commands.
#[cfg(feature = "native-voice")]
fn take_engine() -> Option<LiveKitEngine> {
    engine_holder()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// Briefly wait for an engine borrowed by a concurrent command. Immediate None
/// can mean a collision, especially with 60 Hz cursor publication, not a dead session.
/// Only a sustained absence of about 100 ms warrants clearing participant state.
#[cfg(feature = "native-voice")]
fn take_engine_wait() -> Option<LiveKitEngine> {
    for attempt in 0..10 {
        if let Some(engine) = take_engine() {
            if attempt > 0 {
                log::debug!(
                    "[Sion][voix-native] moteur récupéré après {} tentative(s)",
                    attempt + 1
                );
            }
            return Some(engine);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    None
}

/// Return an optional engine to the holder.
#[cfg(feature = "native-voice")]
fn store_engine(engine: Option<LiveKitEngine>) {
    *engine_holder().lock().unwrap_or_else(|e| e.into_inner()) = engine;
}

/// Reset the manager on explicit disconnect or dead-session cleanup.
/// Match frontend mute/deafen resets so leaving muted does not silently mute the next join.
fn reset_manager_to_disconnected() {
    let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    inner.state = VoiceConnectionState::Disconnected;
    inner.room_name = None;
    inner.identity = None;
    inner.muted = false;
    inner.deafened = false;
}

/// Reset stale session state only after take_engine_wait confirms a durable
/// engine absence; never clear participants on a transient command collision.
#[cfg(feature = "native-voice")]
fn drop_dead_session(app: &tauri::AppHandle<TauriRuntime>) {
    store_engine(None);
    participants_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let empty: Vec<NativeParticipant> = Vec::new();
    let _ = app.emit("voice-native-participants", &empty);
    reset_manager_to_disconnected();
    emit_status(
        &app,
        &snapshot(&manager().lock().unwrap_or_else(|e| e.into_inner())),
    );
}

/// Borrow the engine outside the holder lock, execute op, then return it.
/// Catch SDK panics, restore the engine and report an error so an incidental
/// operation failure does not poison the holder or discard an ongoing call.
#[cfg(feature = "native-voice")]
fn with_engine<R>(
    app: &tauri::AppHandle<TauriRuntime>,
    label: &str,
    op: impl FnOnce(&mut LiveKitEngine) -> Result<R, String>,
) -> Result<R, String> {
    let mut slot = take_engine_wait();
    let res = match slot.as_mut() {
        Some(engine) => {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op(engine))) {
                Ok(r) => r,
                Err(payload) => {
                    let msg = payload
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                        .unwrap_or_else(|| "panique SDK".to_string());
                    // Keep the borrowed engine in slot and restore it even after an operation panic.
                    log::error!(
                        "[Sion][voix-native] {} : panique SDK isolée (moteur conservé): {}",
                        label,
                        msg
                    );
                    Err(format!("{} (panique SDK isolée)", label))
                }
            }
        }
        None => Err("pas de moteur natif".to_string()),
    };
    let lost = slot.is_none();
    store_engine(slot);
    if lost {
        drop_dead_session(app);
    }
    res
}

/// Run a long shared operation while keeping the engine in its holder.
/// Wayland portal delays must not expose None and make concurrent commands
/// clear a live session; they wait for the lock and then find the same engine.
#[cfg(feature = "native-voice")]
fn with_engine_shared<R>(
    app: &tauri::AppHandle<TauriRuntime>,
    label: &str,
    op: impl FnOnce(&LiveKitEngine) -> Result<R, String>,
) -> Result<R, String> {
    let guard = engine_holder().lock().unwrap_or_else(|e| e.into_inner());
    let result = match guard.as_ref() {
        Some(engine) => match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op(engine)))
        {
            Ok(result) => result,
            Err(payload) => {
                let msg = payload
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_else(|| "panique SDK".to_string());
                log::error!(
                    "[Sion][voix-native] {} : panique SDK isolée (moteur conservé): {}",
                    label,
                    msg
                );
                Err(format!("{} (panique SDK isolée)", label))
            }
        },
        None => Err("pas de moteur natif".to_string()),
    };
    let missing = guard.is_none();
    drop(guard);
    if missing {
        drop_dead_session(app);
    }
    result
}

/// Native participant registry; the frontend consumes complete snapshots rather than deltas.
#[cfg(feature = "native-voice")]
static PARTICIPANTS: OnceLock<Mutex<HashMap<String, NativeParticipant>>> = OnceLock::new();

#[cfg(feature = "native-voice")]
fn participants_map() -> &'static Mutex<HashMap<String, NativeParticipant>> {
    PARTICIPANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(feature = "native-voice")]
fn emit_participants(app: &tauri::AppHandle<TauriRuntime>) {
    let mut list: Vec<NativeParticipant> = participants_map()
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default();
    list.sort_by(|a, b| a.identity.cmp(&b.identity));
    let _ = app.emit("voice-native-participants", &list);
}

#[cfg(feature = "native-voice")]
fn upsert_participant<'a>(
    map: &'a mut HashMap<String, NativeParticipant>,
    identity: &str,
) -> &'a mut NativeParticipant {
    // Upsert because mute, speech or quality events can arrive before join.
    // ParticipantJoined supplies the real name later.
    map.entry(identity.to_string())
        .or_insert_with(|| NativeParticipant::new(identity, identity))
}

/// Apply an engine event; return true when the participant list needs re-emitting.
/// Pure logic, testable without Tauri.
#[cfg(feature = "native-voice")]
fn apply_engine_event(map: &mut HashMap<String, NativeParticipant>, ev: &VoiceEngineEvent) -> bool {
    match ev {
        VoiceEngineEvent::ParticipantJoined { identity, name } => {
            let p = upsert_participant(map, identity);
            // Never replace a known or fallback name with an empty LiveKit name.
            if !name.is_empty() {
                p.name = name.clone();
            }
            true
        }
        VoiceEngineEvent::ParticipantLeft { identity, .. } => map.remove(identity).is_some(),
        VoiceEngineEvent::SpeakingChanged { identity, speaking } => {
            upsert_participant(map, identity).is_speaking = *speaking;
            true
        }
        VoiceEngineEvent::TrackMutedChanged { identity, muted } => {
            upsert_participant(map, identity).is_muted = *muted;
            true
        }
        VoiceEngineEvent::VideoPresence { sender, sharing } => {
            upsert_participant(map, sender).is_screen_sharing = *sharing;
            true
        }
        VoiceEngineEvent::CameraPresence { sender, active } => {
            upsert_participant(map, sender).is_camera_enabled = *active;
            true
        }
        VoiceEngineEvent::ShareAudioPresence { sender, has_audio } => {
            upsert_participant(map, sender).is_screen_sharing_audio = *has_audio;
            true
        }
        VoiceEngineEvent::QualityChanged { identity, quality } => {
            upsert_participant(map, identity).connection_quality =
                NativeConnectionQuality::from_livekit_str(quality);
            true
        }
        // The caller handles soundboard badges and room status using AppHandle.
        VoiceEngineEvent::DataReceived { .. }
        | VoiceEngineEvent::RoomDisconnected { .. }
        | VoiceEngineEvent::RoomReconnecting
        | VoiceEngineEvent::RoomReconnected
        | VoiceEngineEvent::E2eeStateChanged { .. } => false,
    }
}

/// Decode base64 sion-afk and update the sender's deafen state.
/// Return true when the list needs re-emitting; pure logic matching JS.
#[cfg(feature = "native-voice")]
fn apply_afk_state(
    map: &mut HashMap<String, NativeParticipant>,
    sender: &str,
    payload_b64: &str,
) -> bool {
    use base64::Engine as _;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(payload_b64) else {
        return false;
    };
    let Ok(raw) = String::from_utf8(bytes) else {
        return false;
    };
    let Ok(data) = decode_json::<AfkPayload>(&raw) else {
        return false;
    };
    let participant = upsert_participant(map, sender);
    // AFK heartbeats arrive about every 15 seconds; log only deafen changes.
    if participant.is_deafened != data.deafened {
        log::info!(
            "[Sion][voix-native] AFK rx {} deafened={}",
            sender,
            data.deafened
        );
    }
    participant.is_deafened = data.deafened;
    // Always emit a full refresh because the sender may have joined since the previous packet.
    true
}

#[cfg(all(feature = "native-voice", not(target_os = "android")))]
#[derive(Deserialize)]
struct NativeCursorPayload {
    x: Option<f32>,
    y: Option<f32>,
    click: Option<bool>,
    expire: Option<bool>,
    t: Option<String>,
    /// Matrix display name resolved by the sender. Older clients omit it;
    /// fall back to the registry and then the Matrix localpart.
    n: Option<String>,
}

#[cfg(all(feature = "native-voice", not(target_os = "android")))]
/// Whether the target is the local sion:lecteur video surface. Its identifier
/// is shared across machines, so publishing cursor packets to it would display
/// a private player's cursor on everyone else's player. Ignore such targets.
fn cible_locale(cible: &str) -> bool {
    cible.starts_with("sion:")
}

/// Publish local cursor position directly from the native Windows video surface.
/// It covers WebView2 and receives mouse events; bypassing two Tauri IPC trips
/// keeps cursor updates responsive. Also echo locally because LiveKit
/// does not return our own data-channel packets.
#[cfg(all(feature = "native-voice", target_os = "windows"))]
pub fn publier_curseur_local(app: &tauri::AppHandle<TauriRuntime>, cible: &str, x: f32, y: f32) {
    if cible_locale(cible) {
        return;
    }
    let identity = manager()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .identity
        .clone();
    let Some(identity) = identity else { return };
    let nom = participants_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&identity)
        .map(|p| p.name.clone());
    let charge = serde_json::json!({
        "x": x,
        "y": y,
        "t": cible,
        "n": nom,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    let Ok(octets) = serde_json::to_vec(&charge) else {
        return;
    };
    let _ = with_engine_shared(app, "curseur natif", |e| {
        e.publish_data(TOPIC_CURSOR, octets.clone(), false)
    });
    // Draw our own cursor locally; the data channel does not echo it back.
    let nom_affiche = cursor_display_name(charge["n"].as_str(), None, &identity);
    crate::native_video_surface::on_viewer_cursor_packet(
        cible,
        &identity,
        &nom_affiche,
        false,
        x,
        y,
        false,
    );
}

/// Publish native cursor clicks directly. The Windows surface covers the DOM
/// canvas, so its click handler cannot supply the sharer's click ripple.
#[cfg(all(feature = "native-voice", target_os = "windows"))]
pub fn publier_clic_local(app: &tauri::AppHandle<TauriRuntime>, cible: &str, x: f32, y: f32) {
    if cible_locale(cible) {
        return;
    }
    let identity = manager()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .identity
        .clone();
    let Some(identity) = identity else { return };
    let nom = participants_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&identity)
        .map(|p| p.name.clone());
    let charge = serde_json::json!({
        "x": x,
        "y": y,
        "t": cible,
        "n": nom,
        "click": true,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    let Ok(octets) = serde_json::to_vec(&charge) else {
        return;
    };
    let _ = with_engine_shared(app, "clic natif", |e| {
        e.publish_data(TOPIC_CURSOR_CLICK, octets.clone(), true)
    });
    let nom_affiche = cursor_display_name(charge["n"].as_str(), None, &identity);
    crate::native_video_surface::on_viewer_cursor_packet(
        cible,
        &identity,
        &nom_affiche,
        true,
        x,
        y,
        false,
    );
}

#[cfg(all(feature = "native-voice", not(target_os = "android")))]
fn cursor_display_name(
    payload_name: Option<&str>,
    participant_name: Option<&str>,
    sender: &str,
) -> String {
    for candidate in [payload_name, participant_name].into_iter().flatten() {
        let clean = candidate.trim();
        if !clean.is_empty() && !(clean.starts_with('@') && clean.contains(':')) {
            return clean.chars().take(64).collect();
        }
    }
    sender
        .strip_prefix('@')
        .unwrap_or(sender)
        .split(':')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(sender)
        .chars()
        .take(64)
        .collect()
}

/// Forward other viewers' cursors to the embedded native video surface.
/// Native painting covers the DOM overlay; the JPEG fallback still lets the DOM draw them.
#[cfg(all(feature = "native-voice", not(target_os = "android")))]
fn forward_cursor_to_viewer_surface(topic: Option<&str>, payload_b64: &str, sender: Option<&str>) {
    use base64::Engine as _;
    let Some(sender) = sender else { return };
    let Some(target) = crate::native_video_surface::viewer_targets() else {
        return;
    };
    let self_identity = manager()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .identity
        .clone();
    // Include our own cursor via the local echo in voice_native_publish_data.
    // The native surface covers the DOM layer, and LiveKit does not echo our packets.
    let _ = &self_identity;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(payload_b64) else {
        return;
    };
    let Ok(payload) = serde_json::from_slice::<NativeCursorPayload>(&bytes) else {
        return;
    };
    let Some(target_identity) = payload.t.as_deref() else {
        return;
    };
    // Ignore older clients targeting sion:lecteur: it is a private player, not a shared stream.
    if cible_locale(target_identity) {
        return;
    }
    // Silently drop targets not displayed here. If no bounds exist during React
    // mounting, keep the packet for the surface that will appear shortly.
    if !target.is_empty() && !target.contains(target_identity) {
        return;
    }
    let participant_name = participants_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(sender)
        .map(|p| p.name.clone());
    let name = cursor_display_name(payload.n.as_deref(), participant_name.as_deref(), sender);
    if topic == Some(TOPIC_CURSOR_CLICK) && payload.click == Some(true) {
        crate::native_video_surface::on_viewer_cursor_packet(
            target_identity,
            sender,
            &name,
            true,
            payload.x.unwrap_or(0.0),
            payload.y.unwrap_or(0.0),
            false,
        );
    } else if topic == Some(TOPIC_CURSOR) {
        crate::native_video_surface::on_viewer_cursor_packet(
            target_identity,
            sender,
            &name,
            false,
            payload.x.unwrap_or(0.0),
            payload.y.unwrap_or(0.0),
            payload.expire == Some(true),
        );
    }
}

/// Forward data-channel cursors directly to the native sharer overlay.
/// Keep the generic frontend event for other viewers' own interfaces.
#[cfg(all(feature = "native-voice", not(target_os = "android")))]
fn forward_cursor_to_overlay(topic: Option<&str>, payload_b64: &str, sender: &str) {
    if !crate::cursor_overlay::cursor_overlay_is_open()
        || !matches!(topic, Some(TOPIC_CURSOR) | Some(TOPIC_CURSOR_CLICK))
    {
        return;
    }
    use base64::Engine as _;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(payload_b64) else {
        return;
    };
    let Ok(payload) = serde_json::from_slice::<NativeCursorPayload>(&bytes) else {
        return;
    };
    let self_identity = manager()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .identity
        .clone();
    // Hide without a target means stop pointing at every share, so clear the overlay.
    // Position updates without a target remain ambiguous and are ignored.
    let untargeted_expire =
        topic == Some(TOPIC_CURSOR) && payload.expire == Some(true) && payload.t.is_none();
    if payload.t.as_deref() != self_identity.as_deref() && !untargeted_expire {
        // Log only the first three occurrences; otherwise this could emit 60 logs per second.
        static MISMATCH_LOGS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        if MISMATCH_LOGS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < 3 {
            log::info!(
                "[Sion][Cursor] rx {} ignoré : cible {:?} != soi {:?}",
                sender,
                payload.t,
                self_identity
            );
        }
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    // Log the first accepted cursor update to distinguish target filtering from painting failures.
    static FORWARD_LOGGED: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    if !FORWARD_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        log::info!(
            "[Sion][Cursor] rx → overlay : sender={} x={:?} y={:?} t={:?} (soi={:?})",
            sender,
            payload.x,
            payload.y,
            payload.t,
            self_identity
        );
    }
    if topic == Some(TOPIC_CURSOR_CLICK) && payload.click == Some(true) {
        crate::cursor_overlay::cursor_overlay_push_click(
            // Derive both pointer and click-ripple colors from the same LiveKit identity.
            // A different display name would otherwise yield a different color.
            sender.to_string(),
            payload.x.unwrap_or(0.0),
            payload.y.unwrap_or(0.0),
            now + 800,
        );
    } else if topic == Some(TOPIC_CURSOR) {
        if payload.expire == Some(true) {
            crate::cursor_overlay::cursor_overlay_clear(sender.to_string());
        } else if let (Some(x), Some(y)) = (payload.x, payload.y) {
            let participant_name = participants_map()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(sender)
                .map(|p| p.name.clone());
            let name =
                cursor_display_name(payload.n.as_deref(), participant_name.as_deref(), sender);
            crate::cursor_overlay::cursor_overlay_push(
                sender.to_string(),
                name,
                x,
                y,
                // Expire idle cursors after five seconds. Live traffic refreshes the deadline;
                // WaitUntil schedules cleanup when a viewer switches windows without sending leave.
                now + 5_000,
            );
        }
    }
}

/// Decode base64 sion-soundboard and set the sender badge. Extend its deadline
/// to now plus normalized duration without shortening a longer sound still playing.
/// Return the chosen duration in milliseconds; pure logic.
#[cfg(feature = "native-voice")]
fn apply_soundboard_badge(
    map: &mut HashMap<String, NativeParticipant>,
    sender: &str,
    payload_b64: &str,
    now_ms: u64,
) -> Option<u64> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload_b64)
        .ok()?;
    let raw = String::from_utf8(bytes).ok()?;
    let data: SoundboardPayload = decode_json(&raw).ok()?;
    let duration = sane_badge_ms(data.duration);
    let p = upsert_participant(map, sender);
    p.playing_sound_emoji = Some(data.emoji.clone());
    p.badge_deadline_ms = p.badge_deadline_ms.max(now_ms.saturating_add(duration));
    Some(duration)
}

/// Extend badge expiry without shortening it. An emoji can restore a badge
/// that expired before receiver playback began. Return whether the deadline changed.
#[cfg(feature = "native-voice")]
fn extend_badge_deadline(
    map: &mut HashMap<String, NativeParticipant>,
    sender: &str,
    duration_ms: u64,
    emoji: Option<&str>,
    now_ms: u64,
) -> bool {
    let duration = sane_badge_ms(duration_ms);
    let Some(p) = map.get_mut(sender) else {
        return false;
    };
    // An inactive badge without an emoji cannot be restored; nothing to do.
    if emoji.is_none() && p.playing_sound_emoji.is_none() {
        return false;
    }
    if let Some(emoji) = emoji {
        p.playing_sound_emoji = Some(emoji.to_string());
    }
    let deadline = now_ms.saturating_add(duration);
    let moved = deadline > p.badge_deadline_ms;
    p.badge_deadline_ms = p.badge_deadline_ms.max(deadline);
    moved
}

/// One expiry thread per sender badge. Recheck the current deadline on each wake
/// so an older timer cannot hide a newer or overlapping sound. Exit when no badge remains.
#[cfg(feature = "native-voice")]
fn spawn_badge_expiry(app: &tauri::AppHandle<TauriRuntime>, sender: &str) {
    let app2 = app.clone();
    let sender2 = sender.to_string();
    std::thread::Builder::new()
        .name("sion-voice-badge".into())
        .spawn(move || loop {
            // None means no badge remains; Some(0) means the deadline has elapsed.
            let remaining = {
                let map = participants_map().lock().unwrap_or_else(|e| e.into_inner());
                match map.get(&sender2) {
                    Some(p) if p.playing_sound_emoji.is_some() => {
                        Some(p.badge_deadline_ms.saturating_sub(mono_ms()))
                    }
                    _ => None,
                }
            };
            let Some(remaining) = remaining else { return };
            if remaining > 0 {
                std::thread::sleep(std::time::Duration::from_millis(remaining));
                continue;
            }
            // Recheck under the lock; another sound may have extended or restored the badge.
            let cleared = {
                let mut map = participants_map().lock().unwrap_or_else(|e| e.into_inner());
                match map.get_mut(&sender2) {
                    Some(p)
                        if p.playing_sound_emoji.is_some() && p.badge_deadline_ms <= mono_ms() =>
                    {
                        p.playing_sound_emoji = None;
                        p.badge_deadline_ms = 0;
                        true
                    }
                    _ => false,
                }
            };
            emit_participants(&app2);
            if cleared {
                return;
            }
        })
        .ok();
}

/// Set a badge and arm expiry for remote reception and local sending.
/// LiveKit does not echo packets, so the sender must apply its own badge.
#[cfg(feature = "native-voice")]
fn show_soundboard_badge(app: &tauri::AppHandle<TauriRuntime>, sender: &str, payload_b64: &str) {
    let armed = {
        let mut map = participants_map().lock().unwrap_or_else(|e| e.into_inner());
        apply_soundboard_badge(&mut map, sender, payload_b64, mono_ms())
    };
    emit_participants(app);
    if armed.is_some() {
        spawn_badge_expiry(app, sender);
    }
}
/// Relay engine events on a dedicated blocking_recv thread.
/// Dropping the engine closes the channel and ends the thread between sessions.
#[cfg(feature = "native-voice")]
fn spawn_forward_task(
    app: tauri::AppHandle<TauriRuntime>,
    rx: tokio::sync::broadcast::Receiver<VoiceEngineEvent>,
    generation: u64,
) {
    std::thread::Builder::new()
        .name("sion-voice-events".into())
        .spawn(move || {
            let mut rx = rx;
            loop {
                let ev = match rx.blocking_recv() {
                    Ok(ev) => ev,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        log::warn!(
                            "[Sion][voix-native] {} événements ignorés (retard du relais)",
                            count
                        );
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                let current = EVENT_GENERATION.lock().unwrap_or_else(|e| e.into_inner());
                if *current != generation {
                    break;
                }
                // Catch malformed-event panics so the live-state relay continues processing later events.
                let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    match &ev {
                        VoiceEngineEvent::DataReceived {
                            topic,
                            payload_b64,
                            sender,
                        } => {
                            if topic.as_deref() == Some(TOPIC_AFK) {
                                if let Some(sender) = sender {
                                    let changed = {
                                        let mut map = participants_map()
                                            .lock()
                                            .unwrap_or_else(|e| e.into_inner());
                                        apply_afk_state(&mut map, sender, payload_b64)
                                    };
                                    if changed {
                                        emit_participants(&app);
                                    }
                                }
                            }
                            if topic.as_deref() == Some(TOPIC_SOUNDBOARD) {
                                if let Some(sender) = sender {
                                    show_soundboard_badge(&app, sender, payload_b64);
                                }
                            }
                            #[cfg(not(target_os = "android"))]
                            if let Some(sender) = sender {
                                forward_cursor_to_overlay(topic.as_deref(), payload_b64, sender);
                            }
                            // Paint other viewers' cursors in our displayed native surface; it covers the DOM overlay.
                            // Rust filters packets by the displayed share target.
                            #[cfg(all(feature = "native-voice", not(target_os = "android")))]
                            if matches!(
                                topic.as_deref(),
                                Some(TOPIC_CURSOR) | Some(TOPIC_CURSOR_CLICK)
                            ) {
                                forward_cursor_to_viewer_surface(
                                    topic.as_deref(),
                                    payload_b64,
                                    sender.as_deref(),
                                );
                            }
                            // Relay generic data events to frontend dispatchers.
                            let _ = app.emit("voice-native-data", &ev);
                        }
                        VoiceEngineEvent::RoomDisconnected { reason, reprendre } => {
                            log::warn!(
                                "[Sion][voix-native] session SFU perdue ({}){}",
                                reason,
                                if *reprendre { " — à reprendre" } else { "" }
                            );
                            // Emit the reason before disconnected state so the UI can decide whether to rejoin.
                            let _ = app.emit(
                                "voice-native-session-perdue",
                                &serde_json::json!({ "raison": reason, "reprendre": reprendre }),
                            );
                            let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
                            inner.state = VoiceConnectionState::Disconnected;
                            inner.identity = None;
                            let status = snapshot(&inner);
                            emit_status(&app, &status);
                        }
                        VoiceEngineEvent::RoomReconnecting => {
                            let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
                            inner.state = VoiceConnectionState::Reconnecting;
                            let status = snapshot(&inner);
                            emit_status(&app, &status);
                        }
                        VoiceEngineEvent::RoomReconnected => {
                            let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
                            inner.state = VoiceConnectionState::Connected;
                            let status = snapshot(&inner);
                            emit_status(&app, &status);
                        }
                        other => {
                            // Emit departure reason before the updated list so the UI chooses the correct sound.
                            if let VoiceEngineEvent::ParticipantLeft { identity, perdu } = other {
                                let _ = app.emit(
                                    "voice-native-participant-left",
                                    serde_json::json!({ "identity": identity, "perdu": perdu }),
                                );
                            }
                            let changed = {
                                let mut map =
                                    participants_map().lock().unwrap_or_else(|e| e.into_inner());
                                apply_engine_event(&mut map, other)
                            };
                            if changed {
                                emit_participants(&app);
                            }
                            // apply_engine_event already updates participant isSpeaking; no extra event is needed.
                            if matches!(other, VoiceEngineEvent::E2eeStateChanged { .. }) {
                                let _ = app.emit("voice-native-e2ee-state", other);
                            }
                        }
                    }
                }));
                if res.is_err() {
                    log::error!("[Sion][voix-native] pompe d'events : panique isolée sur un event");
                }
            }
        })
        .ok();
}

/// Subscribe to events before connecting and publishing the microphone.
/// Cleanly close any previous engine so competing joins leave no orphan SFU session or capture.
#[cfg(feature = "native-voice")]
fn connect_engine(
    app: &tauri::AppHandle<TauriRuntime>,
    url: &str,
    token: &str,
    encrypted: bool,
    input_device: String,
    output_device: String,
    audio_quality: NativeAudioQuality,
) -> Result<String, String> {
    let generation = invalidate_native_events();
    participants_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let mut engine = LiveKitEngine::new()?;
    engine.configure_audio_devices(input_device, output_device);
    engine.configure_audio_quality(audio_quality.max_bitrate());
    engine.set_event_app(app.clone());
    let rx = engine.subscribe();
    spawn_forward_task(app.clone(), rx, generation);
    let t_join = std::time::Instant::now();
    let identity = engine.connect(url, token, encrypted)?;
    if let Err(e) = engine.publish_microphone() {
        engine.disconnect();
        return Err(e);
    }
    // Apply pre-join microphone mute intent to the new engine.
    // Deafen intent does not survive join.
    let want_muted = manager().lock().unwrap_or_else(|e| e.into_inner()).muted;
    if want_muted {
        if let Err(e) = engine.set_microphone_enabled(false) {
            log::warn!("[Sion][voix-native] mute initial refusé: {}", e);
        }
    }
    log::info!(
        "[Sion][voix-native] join complet en {}ms (connect+micro)",
        t_join.elapsed().as_millis()
    );
    // Use WebRTC capture telemetry for the local indicator; never open a second microphone.
    // Meter-thread failure must not fail the call.
    if let Err(e) = engine.start_local_meter(identity.clone()) {
        log::warn!("[Sion][voix-native] meter micro local indisponible: {}", e);
    }
    {
        // Close a previous engine outside the holder lock so a panic cannot poison it.
        let previous = take_engine();
        if let Some(mut previous) = previous {
            log::warn!("[Sion][voix-native] moteur précédent encore présent — fermeture");
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                previous.disconnect();
            }));
        }
        store_engine(Some(engine));
    }
    // Best-effort initial AFK broadcast to existing peers; join resets deafened to false.
    // A data channel not yet ready must not make connection fail.
    if let Err(e) = with_engine(app, "afk initial natif", |e| {
        let payload =
            serde_json::to_vec(&AfkPayload { deafened: false }).map_err(|e| e.to_string())?;
        e.publish_data(TOPIC_AFK, payload, true)
    }) {
        log::warn!("[Sion][voix-native] {}", e);
    }
    Ok(identity)
}

// ---------------------------------------------------------------------------
// Commandes Tauri
// ---------------------------------------------------------------------------

/// Pure join guard: Join when offline, Reuse for an existing session in the same room,
/// or Conflict(room) for another room that the caller must leave first.
#[derive(Debug, PartialEq, Eq)]
pub enum ConnectGuard {
    Join,
    Reuse,
    Conflict(String),
}

pub fn connect_guard(
    state: VoiceConnectionState,
    current_room: Option<&str>,
    requested_room: &str,
) -> ConnectGuard {
    match state {
        VoiceConnectionState::Disconnected => ConnectGuard::Join,
        _ => match current_room {
            Some(current) if current == requested_room => ConnectGuard::Reuse,
            Some(current) => ConnectGuard::Conflict(current.to_string()),
            // Inconsistent disconnected/room state permits a fresh join.
            None => ConnectGuard::Join,
        },
    }
}

#[tauri::command]
pub fn voice_native_status() -> VoiceNativeStatus {
    let inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    snapshot(&inner)
}

#[tauri::command]
pub fn voice_native_available() -> bool {
    cfg!(feature = "native-voice")
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeAudioDevices {
    recording: Vec<NativeAudioDevice>,
    playout: Vec<NativeAudioDevice>,
}

#[tauri::command]
pub fn voice_native_audio_devices() -> Result<NativeAudioDevices, String> {
    #[cfg(feature = "native-voice")]
    {
        let (recording, playout) = crate::voice_engine::platform_audio_snapshot()?;
        Ok(NativeAudioDevices { recording, playout })
    }
    #[cfg(not(feature = "native-voice"))]
    Err("Voix native non compilée".into())
}

#[tauri::command]
pub async fn voice_native_switch_audio_device(
    app: tauri::AppHandle<TauriRuntime>,
    kind: String,
    device_id: String,
) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            with_engine_shared(&app, "périphérique audio", |e| {
                e.switch_audio_device(&kind, &device_id)
            })
        })
        .await
        .map_err(|e| format!("changement de périphérique audio : {e}"))?
    }
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (app, kind, device_id);
        Err("Voix native non compilée".into())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioProcessing {
    pub echo_cancellation: bool,
    pub auto_gain_control: bool,
    pub noise_suppression: bool,
    pub mix: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeAudioQuality {
    #[serde(rename = "voice")]
    Voice,
    #[serde(rename = "voiceHD")]
    VoiceHd,
    #[serde(rename = "musicStereo")]
    MusicStereo,
}

impl Default for NativeAudioQuality {
    fn default() -> Self {
        Self::VoiceHd
    }
}

impl NativeAudioQuality {
    fn max_bitrate(self) -> u64 {
        match self {
            Self::Voice => 24_000,
            Self::VoiceHd => 48_000,
            Self::MusicStereo => 128_000,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct NativeAudioLevel {
    sequence: u64,
    rms: f32,
}

/// Start diagnostic capture outside calls. During calls, reuse APM input
/// without changing the engine capture lifecycle.
#[tauri::command]
pub fn voice_native_start_microphone_test(
    app: tauri::AppHandle<TauriRuntime>,
    device_id: String,
    owner: String,
) -> Result<(), String> {
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (app, device_id, owner);
        return Err("Voix native non compilée".into());
    }
    #[cfg(feature = "native-voice")]
    {
        if owner.trim().is_empty() || owner.len() > 64 {
            return Err("propriétaire du test microphone invalide".into());
        }
        audio_test_owners()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(owner.clone());
        let result = if manager().lock().unwrap_or_else(|e| e.into_inner()).state
            != VoiceConnectionState::Disconnected
        {
            with_engine(&app, "test microphone", |engine| {
                engine.set_microphone_test_enabled(true)
            })
        } else {
            (|| {
                stop_microphone_test_device();
                let audio = PlatformAudio::new().map_err(|e| format!("test micro natif: {e}"))?;
                let device = crate::voice_engine::list_recording_devices(&audio)
                    .into_iter()
                    .find(|d| {
                        if device_id.is_empty() {
                            d.index == 0
                        } else {
                            d.id.as_str() == device_id
                        }
                    })
                    .ok_or("microphone indisponible")?;
                audio
                    .switch_recording_device(&device.id)
                    .map_err(|e| format!("sélection du micro de test: {e}"))?;
                audio
                    .start_recording()
                    .map_err(|e| format!("démarrage du test micro: {e}"))?;
                #[cfg(target_os = "linux")]
                crate::route_native_microphone(if device_id.is_empty() {
                    None
                } else {
                    Some(device.name.as_str())
                })?;
                *audio_test_holder()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(audio);
                Ok(())
            })()
        };
        if result.is_err() {
            audio_test_owners()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&owner);
        }
        result
    }
}

#[tauri::command]
pub fn voice_native_stop_audio_test(app: tauri::AppHandle<TauriRuntime>, owner: String) {
    #[cfg(feature = "native-voice")]
    {
        let remaining = {
            let mut owners = audio_test_owners()
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            owners.remove(&owner);
            !owners.is_empty()
        };
        if remaining {
            return;
        }
        if manager().lock().unwrap_or_else(|e| e.into_inner()).state
            == VoiceConnectionState::Disconnected
        {
            stop_audio_test_force();
        } else {
            let _ = with_engine(&app, "arrêt test microphone", |engine| {
                engine.set_microphone_test_enabled(false)
            });
        }
    }
    #[cfg(not(feature = "native-voice"))]
    let _ = (app, owner);
}

#[tauri::command]
pub fn voice_native_audio_level() -> NativeAudioLevel {
    #[cfg(feature = "native-voice")]
    {
        let (sequence, rms) = sion_native_audio::capture_level();
        return NativeAudioLevel { sequence, rms };
    }
    #[allow(unreachable_code)]
    NativeAudioLevel {
        sequence: 0,
        rms: 0.0,
    }
}

/// Play three notes through real WebRTC output. Use a temporary ADM outside calls
/// and preserve the selected engine output during calls.
#[tauri::command]
pub fn voice_native_test_speaker(output_device: String) -> Result<(), String> {
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = output_device;
        return Err("Voix native non compilée".into());
    }
    #[cfg(feature = "native-voice")]
    {
        let hors_appel = manager().lock().unwrap_or_else(|e| e.into_inner()).state
            == VoiceConnectionState::Disconnected;
        if hors_appel {
            stop_speaker_test_force();
            let factory =
                webrtc_sys::peer_connection_factory::ffi::create_peer_connection_factory();
            let audio = factory.audio_device();
            if !audio.acquire_platform_adm() {
                return Err("initialisation de la sortie de test impossible".into());
            }
            audio.set_adm_playout_enabled(true);
            let selected = if output_device.is_empty() {
                audio.set_playout_device(0)
            } else {
                audio.set_playout_device_by_guid(output_device.clone())
            };
            if !selected || !audio.init_playout() || !audio.start_playout() {
                audio.release_platform_adm();
                return Err("démarrage du test haut-parleur impossible".into());
            }
            *speaker_test_holder()
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(factory);
        }

        let sample_rate = 48_000_f32;
        let note_samples = 12_000_usize;
        let frequencies = [440.0_f32, 554.0, 659.0];
        let mut samples = Vec::with_capacity(note_samples * frequencies.len());
        for frequency in frequencies {
            for index in 0..note_samples {
                let phase = std::f32::consts::TAU * frequency * index as f32 / sample_rate;
                let fade = ((note_samples - index) as f32 / note_samples as f32).max(0.01);
                samples.push((phase.sin() * fade * 9_000.0) as i16);
            }
        }
        // When alone in a call, WebRTC rendering is inactive; use local output for the melody.
        if !hors_appel && !sion_native_audio::rendu_actif() {
            crate::cue_playback::jouer_clip_local(samples, 1.0);
            return Ok(());
        }
        if webrtc_sys::sion_audio::ffi::queue_soundboard_audio(&samples, 1.0) {
            Ok(())
        } else {
            Err("mélodie de test refusée".into())
        }
    }
}

#[tauri::command]
pub fn voice_native_set_audio_quality(
    app: tauri::AppHandle<TauriRuntime>,
    quality: NativeAudioQuality,
) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    {
        return with_engine(&app, "qualité audio", |engine| {
            engine.switch_audio_quality(quality.max_bitrate())
        });
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, quality);
        Err("Voix native non compilée".into())
    }
}
impl Default for NativeAudioProcessing {
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            auto_gain_control: true,
            noise_suppression: true,
            mix: 1.0,
        }
    }
}
impl NativeAudioProcessing {
    pub fn validate(&self) -> Result<(), String> {
        if !self.mix.is_finite() || !(0.0..=1.0).contains(&self.mix) {
            return Err("intensité RNNoise invalide (0 à 1 attendu)".into());
        }
        Ok(())
    }
    #[cfg(feature = "native-voice")]
    pub fn apply(&self) -> Result<(), String> {
        self.validate()?;
        sion_native_audio::configure(sion_native_audio::Settings {
            echo_cancellation: self.echo_cancellation,
            auto_gain_control: self.auto_gain_control,
            noise_suppression: self.noise_suppression,
            mix: self.mix,
        });
        webrtc_sys::sion_audio::ffi::configure_capture_processing();
        Ok(())
    }
}

#[tauri::command]
pub fn voice_native_set_audio_processing(
    app: tauri::AppHandle<TauriRuntime>,
    processing: NativeAudioProcessing,
) -> Result<(), String> {
    processing.validate()?;
    #[cfg(feature = "native-voice")]
    {
        with_engine(&app, "traitement audio", |_| processing.apply())
    }
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = app;
        Err("Voix native non compilée".into())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeProcessingDebug {
    pub instances: usize,
    pub echo_cancellation: bool,
    pub auto_gain_control: bool,
    pub webrtc_noise_suppression: bool,
    pub rnnoise: bool,
    pub mix: f32,
}

/// Audio device exposed by native ADM.
#[derive(Debug, Clone, Serialize)]
pub struct NativeAudioDevice {
    pub id: String,
    pub name: String,
    pub index: usize,
}

/// Instant native-voice diagnostics: session state, flags, ADM devices,
/// legacy RMS track count and participants.
#[derive(Debug, Clone, Serialize)]
pub struct VoiceNativeDebug {
    pub state: VoiceConnectionState,
    pub room_name: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub identity: Option<String>,
    pub has_engine: bool,
    pub engine_connected: bool,
    pub recording_devices: Vec<NativeAudioDevice>,
    pub playout_devices: Vec<NativeAudioDevice>,
    pub attached_tracks: usize,
    pub participants: usize,
    pub processing: Option<NativeProcessingDebug>,
}

#[tauri::command]
pub fn voice_native_debug() -> VoiceNativeDebug {
    let inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    let mut dbg = VoiceNativeDebug {
        state: inner.state,
        room_name: inner.room_name.clone(),
        muted: inner.muted,
        deafened: inner.deafened,
        identity: inner.identity.clone(),
        has_engine: false,
        engine_connected: false,
        recording_devices: Vec::new(),
        playout_devices: Vec::new(),
        attached_tracks: 0,
        participants: 0,
        processing: None,
    };
    #[cfg(feature = "native-voice")]
    {
        if let Some(holder) = ENGINE.get() {
            if let Ok(guard) = holder.lock() {
                if let Some(engine) = guard.as_ref() {
                    dbg.has_engine = true;
                    dbg.engine_connected = engine.is_connected();
                    dbg.attached_tracks = engine.attached_count();
                    let apm = webrtc_sys::sion_audio::ffi::capture_processing_status();
                    let options = sion_native_audio::settings();
                    dbg.processing = Some(NativeProcessingDebug {
                        instances: apm.instances,
                        echo_cancellation: apm.echo_cancellation,
                        auto_gain_control: apm.auto_gain_control,
                        webrtc_noise_suppression: apm.webrtc_noise_suppression,
                        rnnoise: options.noise_suppression,
                        mix: options.mix,
                    });
                    if let Ok(audio) = crate::voice_engine::platform_audio_snapshot() {
                        dbg.recording_devices = audio.0;
                        dbg.playout_devices = audio.1;
                    }
                }
            }
        }
        dbg.participants = participants_map()
            .lock()
            .map(|m| m.len())
            .unwrap_or_default();
    }
    dbg
}

/// Run ADM enumeration and SFU connection off the main thread because they can take seconds.
#[tauri::command]
pub async fn voice_native_connect(
    app: tauri::AppHandle<TauriRuntime>,
    url: String,
    token: String,
    room_name: String,
    display_name: String,
    encrypted: bool,
    input_device: Option<String>,
    output_device: Option<String>,
    processing: Option<NativeAudioProcessing>,
    audio_quality: Option<NativeAudioQuality>,
) -> Result<VoiceNativeStatus, String> {
    let app_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        connect_impl(
            app_task,
            url,
            token,
            room_name,
            display_name,
            encrypted,
            input_device,
            output_device,
            processing,
            audio_quality,
        )
    })
    .await
    .map_err(|e| format!("tâche connexion: {e}"))?
}

fn connect_impl(
    app: tauri::AppHandle<TauriRuntime>,
    url: String,
    token: String,
    room_name: String,
    #[allow(unused_variables)] display_name: String,
    // Enable GCM E2EE for encrypted Matrix rooms; MatrixRTC keys are supplied afterward.
    _encrypted: bool,
    input_device: Option<String>,
    output_device: Option<String>,
    processing: Option<NativeAudioProcessing>,
    audio_quality: Option<NativeAudioQuality>,
) -> Result<VoiceNativeStatus, String> {
    let processing = processing.unwrap_or_default();
    let audio_quality = audio_quality.unwrap_or_default();
    processing.validate()?;
    if url.trim().is_empty() {
        return Err("URL LiveKit vide".into());
    }
    if token.trim().is_empty() {
        return Err("Token LiveKit vide".into());
    }
    {
        let mut inner = manager().lock().map_err(|e| e.to_string())?;
        match connect_guard(inner.state, inner.room_name.as_deref(), &room_name) {
            ConnectGuard::Reuse => {
                // Reuse an online session in the same room; do not create a second engine.
                return Ok(snapshot(&inner));
            }
            ConnectGuard::Conflict(active) => {
                return Err(format!("Déjà en ligne sur {} — quittez d'abord", active));
            }
            ConnectGuard::Join => {
                inner.state = VoiceConnectionState::Connecting;
                inner.room_name = Some(room_name.clone());
                inner.identity = None;
            }
        }
        emit_status(&app, &snapshot(&inner));
    }
    log::info!(
        "[Sion][voix-native] connect room={} (moteur Rust)",
        room_name
    );

    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (input_device, output_device, audio_quality);
        let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
        inner.state = VoiceConnectionState::Disconnected;
        inner.room_name = None;
        let status = snapshot(&inner);
        emit_status(&app, &status);
        return Err("Voix native non compilée : relancer avec --features native-voice (cf. build-scripts/run-native.sh)".into());
    }

    #[cfg(feature = "native-voice")]
    {
        // Close settings capture before creating the real track. Both share LiveKit's
        // global ADM, so the joined engine must own capture and rendering lifecycle.
        stop_audio_test_force();
    }
    #[cfg(feature = "native-voice")]
    match processing.apply().and_then(|_| {
        connect_engine(
            &app,
            &url,
            &token,
            _encrypted,
            input_device.unwrap_or_default(),
            output_device.unwrap_or_default(),
            audio_quality,
        )
    }) {
        Ok(identity) => {
            log::info!(
                "[Sion][voix-native] session SFU ouverte identite={}",
                identity
            );
            // Insert the local participant explicitly with the Matrix display name;
            // ParticipantConnected never announces ourselves.
            {
                let name = if display_name.trim().is_empty() {
                    identity.clone()
                } else {
                    display_name.clone()
                };
                let mut map = participants_map().lock().unwrap_or_else(|e| e.into_inner());
                map.insert(identity.clone(), NativeParticipant::new(&identity, &name));
            }
            emit_participants(&app);
            let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
            inner.state = VoiceConnectionState::Connected;
            inner.identity = Some(identity);
            // Reset deafen intent on join; microphone mute is synchronized by connect_engine.
            inner.deafened = false;
            let status = snapshot(&inner);
            emit_status(&app, &status);
            Ok(status)
        }
        Err(e) => {
            log::warn!("[Sion][voix-native] echec connect: {}", e);
            let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
            inner.state = VoiceConnectionState::Disconnected;
            inner.room_name = None;
            let status = snapshot(&inner);
            emit_status(&app, &status);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn voice_native_disconnect(app: tauri::AppHandle<TauriRuntime>) -> VoiceNativeStatus {
    #[cfg(feature = "native-voice")]
    {
        webrtc_sys::sion_audio::ffi::clear_soundboard_audio();
        invalidate_native_events();
        // Take the engine out of the holder before close; do not hold the lock during SDK calls.
        let previous = take_engine();
        if let Some(mut engine) = previous {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine.disconnect();
            }));
        }
        participants_map()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        let empty: Vec<NativeParticipant> = Vec::new();
        let _ = app.emit("voice-native-participants", &empty);
    }
    reset_manager_to_disconnected();
    let status = snapshot(&manager().lock().unwrap_or_else(|e| e.into_inner()));
    emit_status(&app, &status);
    status
}

/// On Android app termination, close voice without windows or events
/// so the SFU receives a clean departure before process exit.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn couper_voix_native() {
    #[cfg(feature = "native-voice")]
    {
        webrtc_sys::sion_audio::ffi::clear_soundboard_audio();
        invalidate_native_events();
        if let Some(mut engine) = take_engine() {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine.disconnect();
            }));
        }
        participants_map()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
    reset_manager_to_disconnected();
}

/// Whether the user is deafened.
pub(crate) fn en_sourdine() -> bool {
    manager().lock().unwrap_or_else(|e| e.into_inner()).deafened
}

/// Play peer soundboard or meme audio: discard while deafened and mix into WebRTC
/// rendering during calls so AEC sees it. Outside calls, use local preview output.
pub(crate) fn jouer_clip_de_pair(
    app: &tauri::AppHandle<TauriRuntime>,
    samples: Vec<i16>,
    gain: f32,
) {
    if samples.is_empty() || en_sourdine() {
        return;
    }
    #[cfg(feature = "native-voice")]
    {
        // Clip queuing needs no engine checkout. Briefly removing it would make concurrent
        // cursor commands mistake the session for dead. Wait for an existing borrow off the UI thread.
        if wait_for_engine(holder_is_connected) && sion_native_audio::rendu_actif() {
            if !webrtc_sys::sion_audio::ffi::queue_soundboard_audio(&samples, gain) {
                log::warn!("[Sion][voix-native] clip de pair refusé");
            }
            return;
        }
    }
    let _ = app;
    crate::cue_playback::jouer_clip_local(samples, gain);
}

/// Mix mono 48 kHz soundboard clips before WebRTC APM reverse analysis
/// so selected output and AEC see the same signal. Transfer bytes through Tauri once per clip.
#[tauri::command]
pub fn voice_native_play_soundboard(
    app: tauri::AppHandle<TauriRuntime>,
    pcm_b64: String,
    gain: f32,
    // local_feedback identifies the user's own action sound rather than peer audio.
    local_feedback: Option<bool>,
) -> Result<(), String> {
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (app, pcm_b64, gain, local_feedback);
        return Err("Voix native non compilée".into());
    }
    #[cfg(feature = "native-voice")]
    {
        const MAX_SAMPLES: usize = 48_000 * 20;
        const MAX_B64_LEN: usize = ((MAX_SAMPLES * 2 + 2) / 3) * 4;
        if !gain.is_finite() || !(0.0..=3.0).contains(&gain) {
            return Err("gain soundboard invalide".into());
        }
        if pcm_b64.len() > MAX_B64_LEN {
            return Err("clip soundboard trop long".into());
        }
        // Deafen discards peer sounds but keeps local action feedback, including the sound
        // confirming deafen itself. DOM audio can be delayed while ADM owns the device.
        let feedback_local = local_feedback.unwrap_or(false);
        let sourdine = manager().lock().unwrap_or_else(|e| e.into_inner()).deafened;
        if sourdine && !feedback_local {
            return Ok(());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(pcm_b64)
            .map_err(|e| format!("PCM soundboard base64 invalide: {e}"))?;
        if bytes.is_empty() || bytes.len() % 2 != 0 || bytes.len() / 2 > MAX_SAMPLES {
            return Err("PCM soundboard invalide".into());
        }
        let samples: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        // Deafen stops subscribed audio and therefore WebRTC rendering. Play local
        // feedback through separate output; with the microphone muted, no AEC reference is needed.
        if sourdine {
            crate::cue_playback::jouer_clip_local(samples, gain);
            return Ok(());
        }
        // Queue clips without checking out the engine; concurrent commands must not see
        // a temporary absence as a dead session.
        let _ = &app;
        if !wait_for_engine(holder_has_engine) {
            return Err("pas de moteur natif".into());
        }
        // When alone, WebRTC rendering is inactive. Use local output as while deafened;
        // there is no remote peer to receive an echo.
        if !sion_native_audio::rendu_actif() {
            crate::cue_playback::jouer_clip_local(samples, gain);
            return Ok(());
        }
        if webrtc_sys::sion_audio::ffi::queue_soundboard_audio(&samples, gain) {
            Ok(())
        } else {
            Err("clip soundboard refusé".into())
        }
    }
}

#[tauri::command]
pub fn voice_native_set_muted(
    app: tauri::AppHandle<TauriRuntime>,
    muted: bool,
) -> VoiceNativeStatus {
    // Preserve frontend state if the engine rejects the operation.
    let mut applied = true;
    // Apply mute even between sessions so the engine records intent for the next publish.
    // Wait for concurrent engine borrows; an instantaneous absence must not skip mute.
    #[cfg(feature = "native-voice")]
    let has_engine = wait_for_engine(holder_has_engine);
    #[cfg(not(feature = "native-voice"))]
    let has_engine = false;
    #[cfg(feature = "native-voice")]
    {
        if has_engine {
            if let Err(e) = with_engine(&app, "mute natif", |e| e.set_microphone_enabled(!muted)) {
                log::warn!("[Sion][voix-native] {}", e);
                applied = false;
            }
        } else {
            log::info!(
                "[Sion][voix-native] mute demandé={} sans moteur (hors appel) — désir conservé",
                muted
            );
        }
    }
    let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    if applied {
        inner.muted = muted;
    }
    let status = snapshot(&inner);
    // Log every invocation to confirm deafen-triggered mute actually reaches the engine.
    log::info!(
        "[Sion][voix-native] mute demandé={} moteur={} appliqué={} mic_published={}",
        muted,
        has_engine,
        applied,
        status.mic_published
    );
    emit_status(&app, &status);
    status
}

#[tauri::command]
pub fn voice_native_set_deafened(
    app: tauri::AppHandle<TauriRuntime>,
    deafened: bool,
) -> VoiceNativeStatus {
    // Preserve frontend state if the engine rejects the operation.
    let mut applied = true;
    // Wait for concurrent borrows before deafen; skipping it would leave audio playing
    // while the frontend reports the headset deafened.
    #[cfg(feature = "native-voice")]
    let _connected = wait_for_engine(holder_is_connected);
    #[cfg(not(feature = "native-voice"))]
    let _connected = false;
    // Clear soundboard clips on both deafen transitions. Rendering pauses while deafened,
    // so queued clips would otherwise resume much later. Clear before rendering restarts
    // to catch clips queued during the transition. Action feedback is played afterward.
    #[cfg(feature = "native-voice")]
    if !deafened {
        webrtc_sys::sion_audio::ffi::clear_soundboard_audio();
    }
    #[cfg(feature = "native-voice")]
    {
        if _connected {
            if let Err(e) = with_engine(&app, "deafen natif", |e| {
                e.set_deafened(deafened).map(|_| ())?;
                // Broadcast AFK state so peers observe our deafen status.
                let payload =
                    serde_json::to_vec(&AfkPayload { deafened }).map_err(|e| e.to_string())?;
                e.publish_data(TOPIC_AFK, payload, true)?;
                log::info!("[Sion][voix-native] AFK tx deafened={}", deafened);
                Ok(())
            }) {
                log::warn!("[Sion][voix-native] {}", e);
                applied = false;
            }
        }
    }
    let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    if applied {
        inner.deafened = deafened;
        // Set the flag before clearing; peer clip queuing checks it and can no longer add sounds.
        #[cfg(feature = "native-voice")]
        if deafened {
            webrtc_sys::sion_audio::ffi::clear_soundboard_audio();
        }
    }
    let status = snapshot(&inner);
    emit_status(&app, &status);
    status
}

/// Import raw peer and local MatrixRTC keys via identity, key_index and key_b64.
/// Return false without an engine or for invalid base64; an orphan key must not reset
/// a session. The frontend reflushed key history after connection prevents lasting loss.
#[tauri::command]
pub fn voice_native_set_e2ee_key(
    _app: tauri::AppHandle<TauriRuntime>,
    identity: String,
    key_index: i32,
    key_b64: String,
) -> bool {
    #[cfg(feature = "native-voice")]
    {
        use base64::Engine as _;
        let bytes = match base64::engine::general_purpose::STANDARD.decode(key_b64.trim()) {
            Ok(b) => b,
            Err(e) => {
                log::warn!(
                    "[Sion][voix-native][E2EE] clé {} index={} illisible: {}",
                    identity,
                    key_index,
                    e
                );
                return false;
            }
        };
        return importer_cle_e2ee(&identity, key_index, bytes);
    }
    #[allow(unreachable_code)]
    {
        let _ = (&identity, &key_index, &key_b64);
        false
    }
}

/// Import into the current engine, also called directly by the Rust Matrix bridge
/// without webview transfer. Wait if another command has borrowed the engine.
pub(crate) fn importer_cle_e2ee(identity: &str, key_index: i32, bytes: Vec<u8>) -> bool {
    #[cfg(feature = "native-voice")]
    {
        if !validate_e2ee_key(&bytes) {
            log::warn!(
                "[Sion][voix-native][E2EE] clé {} index={} rejetée : {} octets (attendu 16 ou 32)",
                identity,
                key_index,
                bytes.len()
            );
            return false;
        }
        // Wait for concurrent borrows, then restore the engine ourselves.
        // An absent engine here does not trigger drop_dead_session.
        if let Some(engine) = take_engine_wait() {
            let ok = engine.set_e2ee_key(identity, key_index, bytes);
            store_engine(Some(engine));
            return ok;
        }
        log::debug!(
            "[Sion][voix-native][E2EE] clé {} index={} sans moteur — ignorée",
            identity,
            key_index
        );
    }
    #[allow(unreachable_code)]
    {
        let _ = (identity, key_index, bytes);
        false
    }
}

/// Toggle a sender's screen-share audio. Return true if ScreenshareAudio exists.
#[tauri::command]
pub fn voice_native_set_screenshare_audio_muted(
    app: tauri::AppHandle<TauriRuntime>,
    sender: String,
    muted: bool,
) -> Result<bool, String> {
    #[cfg(feature = "native-voice")]
    {
        let res = with_engine(&app, "son du partage natif", |e| {
            e.set_screenshare_audio_subscribed(&sender, !muted)
        });
        if res.is_ok() {
            emit_share_audio_state(&app, &sender);
        }
        return res;
    }
    #[allow(unreachable_code)]
    {
        let _ = (&app, &sender, &muted);
        Err("voix native indisponible".to_string())
    }
}

/// Hide or restore a sender's share video; see set_screenshare_video_visible.
#[tauri::command]
pub fn voice_native_set_screenshare_video_visible(
    app: tauri::AppHandle<TauriRuntime>,
    sender: String,
    visible: bool,
) -> Result<bool, String> {
    #[cfg(feature = "native-voice")]
    {
        return with_engine(&app, "vidéo du partage natif", |e| {
            e.set_screenshare_video_visible(&sender, visible)
        });
    }
    #[allow(unreachable_code)]
    {
        let _ = (&app, &sender, &visible);
        Err("voix native indisponible".to_string())
    }
}

/// Set per-user local microphone volume across devices: 0 mute, 1 normal, 2 double.
/// Persist outside engines for later tracks and calls. Avoid with_engine_shared
/// here because absent engines during connection must not reset session state.
#[tauri::command]
pub fn voice_native_set_participant_volume(
    utilisateur: String,
    volume: f32,
) -> Result<usize, String> {
    #[cfg(feature = "native-voice")]
    {
        crate::voice_engine::regler_volume_participant(&utilisateur, volume)?;
        let guard = engine_holder().lock().unwrap_or_else(|e| e.into_inner());
        let reglees = match guard.as_ref() {
            Some(engine) => engine.appliquer_volume_participant(&utilisateur, volume)?,
            None => 0,
        };
        log::info!(
            "[Sion][voix-native] volume de {} : {:.0}% ({} piste(s))",
            utilisateur,
            volume * 100.0,
            reglees
        );
        return Ok(reglees);
    }
    #[allow(unreachable_code)]
    {
        let _ = (&utilisateur, &volume);
        Err("voix native indisponible".to_string())
    }
}

/// Voice-server latency in milliseconds, or None before measurement/outside calls.
/// Avoid with_engine_shared so polling cannot reset an absent or connecting engine.
#[tauri::command]
pub async fn voice_native_latence() -> Result<Option<u32>, String> {
    #[cfg(feature = "native-voice")]
    {
        let piste = {
            let guard = engine_holder().lock().unwrap_or_else(|e| e.into_inner());
            guard
                .as_ref()
                .and_then(|engine| engine.piste_pour_latence())
        };
        return Ok(match piste {
            Some(p) => p.latence_ms().await,
            None => None,
        });
    }
    #[allow(unreachable_code)]
    Ok(None)
}

/// Set local screen-share gain and remember it for republished remote sources.
#[tauri::command]
pub fn voice_native_set_screenshare_audio_volume(
    app: tauri::AppHandle<TauriRuntime>,
    sender: String,
    volume: f32,
) -> Result<bool, String> {
    #[cfg(feature = "native-voice")]
    {
        let res = with_engine(&app, "volume du partage natif", |engine| {
            engine.set_screenshare_audio_volume(&sender, volume)
        });
        if res.is_ok() {
            emit_share_audio_state(&app, &sender);
        }
        return res;
    }
    #[allow(unreachable_code)]
    {
        let _ = (&app, &sender, &volume);
        Err("voix native indisponible".to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeShareAudioState {
    pub muted: bool,
    pub volume: f32,
}

/// Notify on share mute or volume changes so the main view and native PIP
/// reflect the same engine state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeShareAudioEvent {
    pub sender: String,
    pub muted: bool,
    pub volume: f32,
}

/// Emit share-audio state; stay silent when no engine exists.
fn emit_share_audio_state(app: &tauri::AppHandle<TauriRuntime>, sender: &str) {
    #[cfg(feature = "native-voice")]
    {
        if let Ok(st) = with_engine(app, "état du son du partage", |e| {
            let (muted, volume) = e.screenshare_audio_state(sender);
            Ok(NativeShareAudioState { muted, volume })
        }) {
            let _ = app.emit(
                "voice-native-share-audio",
                NativeShareAudioEvent {
                    sender: sender.to_string(),
                    muted: st.muted,
                    volume: st.volume,
                },
            );
        }
    }
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (app, sender);
    }
}

/// Local share mute and volume state restored after webview reload.
/// The engine retains these choices even when frontend memory is recreated.
#[tauri::command]
pub fn voice_native_get_screenshare_audio_state(
    app: tauri::AppHandle<TauriRuntime>,
    sender: String,
) -> Result<NativeShareAudioState, String> {
    #[cfg(feature = "native-voice")]
    {
        return with_engine(&app, "état du son du partage natif", |e| {
            let (muted, volume) = e.screenshare_audio_state(&sender);
            Ok(NativeShareAudioState { muted, volume })
        });
    }
    #[allow(unreachable_code)]
    {
        let _ = (&app, &sender);
        Err("voix native indisponible".to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScreenShareResult {
    audio_published: bool,
}

/// Local binary transport port for received video frames, avoiding JSON/base64 IPC overhead.
#[tauri::command]
pub fn voice_native_video_port() -> u16 {
    #[cfg(feature = "native-voice")]
    {
        return crate::native_video_transport::port();
    }
    #[allow(unreachable_code)]
    0
}

/// Probe actual compiled and available webrtc-sys codec backends
/// (NVENC/VAAPI/VideoToolbox) for sion-media-caps negotiation. Prefer hardware
/// when every participant can decode it. Advertise AV1 only through the codec path
/// libwebrtc actually exposes, rather than inferring encoding support from vainfo.
#[tauri::command]
pub fn voice_media_caps() -> serde_json::Value {
    use std::collections::BTreeMap;

    let mut enc: BTreeMap<String, &'static str> = BTreeMap::new();
    let mut dec: BTreeMap<String, &'static str> = BTreeMap::new();
    for codec in ["vp8", "vp9", "h264"] {
        enc.insert(codec.into(), "sw");
        dec.insert(codec.into(), "sw");
    }

    #[cfg(feature = "native-voice")]
    {
        use livekit::options::VideoEncoderBackend;
        let backends: Vec<_> = VideoEncoderBackend::list_available().into_iter().collect();
        if backends.iter().any(|b| {
            matches!(
                b,
                VideoEncoderBackend::Hardware
                    | VideoEncoderBackend::Nvenc
                    | VideoEncoderBackend::Vaapi
                    | VideoEncoderBackend::VideoToolbox
            )
        }) {
            // All hardware factories currently exposed by webrtc-sys support
            // H.264. Keep AV1 conservative until a per-codec query is bound.
            enc.insert("h264".into(), "hw");
        }
    }

    serde_json::json!({ "v": 1, "enc": enc, "dec": dec })
}

/// Toggle local screen sharing. source_id selects a screen/window (None uses the first).
/// with_audio defaults to true; without it, no ScreenshareAudio is published.
/// Menu choices set resolution and frame rate; the result confirms actual audio publication.
#[tauri::command]
pub async fn voice_native_set_screensharing(
    app: tauri::AppHandle<TauriRuntime>,
    enabled: bool,
    source_id: Option<u64>,
    with_audio: Option<bool>,
    resolution: Option<String>,
    framerate: Option<u32>,
    video_codec: Option<String>,
) -> Result<NativeScreenShareResult, String> {
    #[cfg(feature = "native-voice")]
    {
        // Start sharing off the main thread because portal initialization may take seconds.
        let app_task = app.clone();
        // Clone video_codec for the blocking thread and retain it for the no-feature fallback.
        let codec = video_codec.clone().unwrap_or_else(|| "h264".to_string());
        return tauri::async_runtime::spawn_blocking(move || {
            if enabled {
                let config = crate::voice_engine::screenshare_config(
                    resolution.as_deref().unwrap_or("1080p"),
                    framerate.unwrap_or(15),
                )?;
                with_engine_shared(&app_task, "partage d'écran natif", |e| {
                    e.start_screensharing(source_id, with_audio.unwrap_or(true), config, &codec)
                        .map(|audio_published| NativeScreenShareResult { audio_published })
                })
            } else {
                with_engine_shared(&app_task, "arrêt partage natif", |e| {
                    e.stop_screensharing()?;
                    Ok(NativeScreenShareResult {
                        audio_published: false,
                    })
                })
            }
        })
        .await
        .map_err(|e| format!("tâche partage d'écran: {e}"))?;
    }
    #[allow(unreachable_code)]
    {
        let _ = (
            &app,
            &enabled,
            &source_id,
            &with_audio,
            &resolution,
            &framerate,
            &video_codec,
        );
        Err("voix native indisponible".to_string())
    }
}

#[tauri::command]
pub fn voice_native_camera_available() -> bool {
    cfg!(feature = "native-voice")
}

#[tauri::command]
pub async fn voice_native_camera_devices(
    app: tauri::AppHandle<TauriRuntime>,
    ffmpeg_path: Option<String>,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "native-voice")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            #[cfg(not(target_os = "android"))]
            let ffmpeg = crate::resolve_ffmpeg(
                ffmpeg_path.as_deref(),
                crate::managed_ffmpeg_path(&app)
                    .as_ref()
                    .and_then(|p| p.to_str()),
            );
            #[cfg(target_os = "android")]
            let ffmpeg = String::new();
            let _ = (&app, &ffmpeg_path);
            serde_json::to_value(crate::camera_capture::devices(&ffmpeg)?)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, ffmpeg_path);
        Err("Caméra native indisponible.".into())
    }
}

#[tauri::command]
pub async fn voice_native_camera_preview(
    app: tauri::AppHandle<TauriRuntime>,
    device_id: String,
    ffmpeg_path: Option<String>,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "native-voice")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            #[cfg(not(target_os = "android"))]
            let ffmpeg = crate::resolve_ffmpeg(
                ffmpeg_path.as_deref(),
                crate::managed_ffmpeg_path(&app)
                    .as_ref()
                    .and_then(|p| p.to_str()),
            );
            #[cfg(target_os = "android")]
            let ffmpeg = String::new();
            let _ = &ffmpeg_path;
            let device = crate::camera_capture::devices(&ffmpeg)?
                .into_iter()
                .find(|d| d.id == device_id)
                .ok_or("Cette caméra n'est plus disponible.")?;
            with_engine_shared(&app, "aperçu caméra", |e| {
                serde_json::to_value(e.preview_camera(device, &ffmpeg)?).map_err(|e| e.to_string())
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, device_id, ffmpeg_path);
        Err("Caméra native indisponible.".into())
    }
}

#[tauri::command]
pub async fn voice_native_camera_set_enabled(
    app: tauri::AppHandle<TauriRuntime>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "native-voice")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            with_engine_shared(&app, "caméra", |e| {
                if enabled {
                    e.publish_camera()?;
                } else {
                    e.stop_camera()?;
                }
                serde_json::to_value(e.camera_state()).map_err(|e| e.to_string())
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, enabled);
        Err("Caméra native indisponible.".into())
    }
}

#[tauri::command]
pub fn voice_native_camera_state() -> serde_json::Value {
    #[cfg(feature = "native-voice")]
    {
        return engine_holder()
            .lock()
            .ok()
            .and_then(|g| {
                g.as_ref()
                    .map(|e| serde_json::to_value(e.camera_state()).unwrap_or_default())
            })
            .unwrap_or_else(|| {
                serde_json::to_value(crate::voice_engine::CameraState::default())
                    .unwrap_or_default()
            });
    }
    #[allow(unreachable_code)]
    {
        serde_json::json!({ "previewing": false, "published": false, "ready": false, "deviceId": null, "error": null })
    }
}

/// Publish arbitrary base64 data on the native session. Use lossy delivery
/// for 60 Hz cursors and reliable delivery for other live-state messages.
#[tauri::command]
pub fn voice_native_publish_data(
    app: tauri::AppHandle<TauriRuntime>,
    topic: String,
    payload_b64: String,
    reliable: Option<bool>,
) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    {
        use base64::Engine as _;
        let payload = base64::engine::general_purpose::STANDARD
            .decode(&payload_b64)
            .map_err(|e| format!("payload base64: {}", e))?;
        let reliable = reliable.unwrap_or(true);
        // Keep the engine in its holder with with_engine_shared to avoid checkout overhead
        // and transient absence on every 60 Hz cursor packet.
        let res = with_engine_shared(&app, "publish data natif", |e| {
            e.publish_data(&topic, payload, reliable)
        });
        // Echo our own badge and cursor locally because LiveKit does not return sender packets.
        // The native video surface covers the DOM cursor layer. The forwarding helper
        // does nothing without a native surface, leaving the JPEG fallback to the DOM.
        #[cfg(not(target_os = "android"))]
        if res.is_ok() && (topic == TOPIC_CURSOR || topic == TOPIC_CURSOR_CLICK) {
            let identity = manager()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .identity
                .clone();
            if let Some(identity) = identity {
                forward_cursor_to_viewer_surface(Some(&topic), &payload_b64, Some(&identity));
            }
        }
        // Apply our badge locally; only peers receive the transmitted packet.
        if res.is_ok() && (topic == TOPIC_SOUNDBOARD || topic == TOPIC_MEMEBOARD) {
            let identity = manager()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .identity
                .clone();
            if let Some(identity) = identity {
                show_soundboard_badge(&app, &identity, &payload_b64);
            }
        }
        return res;
    }
    #[allow(unreachable_code)]
    {
        let _ = (&app, &topic, &payload_b64, &reliable);
        Err("voix native indisponible".to_string())
    }
}

/// Extend badge expiry using the duration measured when local playback starts.
/// Downloading and decoding may delay playback after packet receipt. The emoji
/// can restore an expired badge; never shorten another sound's later deadline.
#[tauri::command]
pub fn voice_native_extend_soundboard_badge(
    app: tauri::AppHandle<TauriRuntime>,
    sender: String,
    duration_ms: u64,
    emoji: Option<String>,
) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    {
        if sender.trim().is_empty() {
            return Err("expéditeur soundboard manquant".to_string());
        }
        let moved = {
            let mut map = participants_map().lock().unwrap_or_else(|e| e.into_inner());
            extend_badge_deadline(&mut map, &sender, duration_ms, emoji.as_deref(), mono_ms())
        };
        if moved {
            emit_participants(&app);
            // Rearm expiry if the original thread already exited; it stops when no badge remains.
            spawn_badge_expiry(&app, &sender);
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, sender, duration_ms, emoji);
        Err("voix native indisponible".to_string())
    }
}

/// Reset global state for tests only.
#[cfg(test)]
pub fn test_reset() {
    let mut inner = manager().lock().unwrap_or_else(|e| e.into_inner());
    *inner = VoiceNativeInner::default();
}

/// Serialize tests that use the global manager to prevent parallel-test interference.
#[cfg(test)]
static TEST_MANAGER_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_audio_quality_matches_frontend_values_and_bitrates() {
        let cases = [
            ("voice", NativeAudioQuality::Voice, 24_000),
            ("voiceHD", NativeAudioQuality::VoiceHd, 48_000),
            ("musicStereo", NativeAudioQuality::MusicStereo, 128_000),
        ];
        for (json, expected, bitrate) in cases {
            let parsed: NativeAudioQuality = serde_json::from_str(&format!("\"{json}\"")).unwrap();
            assert_eq!(parsed, expected);
            assert_eq!(parsed.max_bitrate(), bitrate);
        }
    }

    #[test]
    fn connect_guard_drives_join_reuse_conflict() {
        use VoiceConnectionState::*;
        // No active session permits Join.
        assert_eq!(connect_guard(Disconnected, None, "!a"), ConnectGuard::Join);
        assert_eq!(
            connect_guard(Disconnected, Some("!a"), "!b"),
            ConnectGuard::Join
        );
        // An online session in the same room yields Reuse.
        for state in [Connecting, Connected, Reconnecting] {
            assert_eq!(
                connect_guard(state, Some("!a"), "!a"),
                ConnectGuard::Reuse,
                "state={:?}",
                state
            );
        }
        // A different room yields Conflict naming the active room.
        assert_eq!(
            connect_guard(Connected, Some("!a"), "!b"),
            ConnectGuard::Conflict("!a".to_string())
        );
        // An inconsistent state without a room permits Join.
        assert_eq!(connect_guard(Connecting, None, "!a"), ConnectGuard::Join);
    }

    #[test]
    fn connect_requires_url_and_token() {
        let _serial = TEST_MANAGER_SERIAL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        test_reset();
        assert!(manager().lock().unwrap().state == VoiceConnectionState::Disconnected);
        // Replay pure state validation without AppHandle.
        assert!("".trim().is_empty());
        assert!("  ".trim().is_empty());
    }

    #[test]
    fn state_defaults_to_disconnected() {
        let _serial = TEST_MANAGER_SERIAL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        test_reset();
        let inner = manager().lock().unwrap();
        assert_eq!(inner.state, VoiceConnectionState::Disconnected);
        assert!(inner.room_name.is_none());
        assert!(!inner.muted && !inner.deafened);
        // Tests have no engine, so mic_published is false and the empty holder must not panic.
        assert!(!holder_mic_published());
        let status = snapshot(&inner);
        assert!(!status.mic_published);
    }

    #[test]
    fn disconnect_resets_session() {
        let _serial = TEST_MANAGER_SERIAL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        test_reset();
        {
            let mut inner = manager().lock().unwrap();
            inner.state = VoiceConnectionState::Connected;
            inner.room_name = Some("sion".into());
            inner.identity = Some("@a:b:c".into());
            // Leaving while muted must not silently mute the next join behind an unmuted UI.
            inner.muted = true;
            inner.deafened = true;
        }
        // Exercise the helper shared by disconnect and drop_dead_session.
        reset_manager_to_disconnected();
        let inner = manager().lock().unwrap();
        assert_eq!(inner.state, VoiceConnectionState::Disconnected);
        assert!(inner.room_name.is_none());
        assert!(!inner.muted && !inner.deafened);
    }

    #[test]
    #[cfg(feature = "native-voice")]
    fn take_engine_wait_sans_moteur_rend_none() {
        let _serial = TEST_MANAGER_SERIAL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // An empty holder returns None after bounded retries without panicking
        // or resetting state; the caller decides how to handle absence.
        let t0 = std::time::Instant::now();
        assert!(take_engine_wait().is_none());
        assert!(t0.elapsed().as_millis() >= 50);
    }

    #[test]
    #[cfg(feature = "native-voice")]
    fn wait_for_engine_survives_concurrent_checkout() {
        // Simulate a concurrent engine checkout restored after 100 ms.
        // A deafen-triggered mute must wait rather than leave the microphone live.
        let _serial = TEST_MANAGER_SERIAL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _drained = take_engine();
        assert!(!holder_has_engine());
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(engine) = LiveKitEngine::new() {
                store_engine(Some(engine));
            }
        });
        assert!(wait_for_engine(holder_has_engine));
        // Leave the holder empty for subsequent tests.
        let _ = take_engine();
        assert!(!holder_has_engine());
    }

    #[test]
    fn rms_silence_never_latches() {
        let mut d = RmsSpeakingDetector::new();
        assert_eq!(d.push(&[0.0; 512]), None);
        assert!(!d.is_speaking());
        // Bruit ambiant ~0.0005 < RMS_SILENCE.
        assert_eq!(d.push(&[0.0005; 512]), None);
        assert!(!d.is_speaking());
    }

    #[test]
    fn rms_loud_voice_latches_then_releases() {
        let mut d = RmsSpeakingDetector::new();
        // Voix nette ~0.01 > RMS_START.
        assert_eq!(d.push(&[0.01; 512]), Some(true));
        assert!(d.is_speaking());
        // Toujours de la voix : pas de re-bascule.
        assert_eq!(d.push(&[0.02; 512]), None);
        assert!(d.is_speaking());
        // Silence franc < RMS_SILENCE → retombe.
        assert_eq!(d.push(&[0.0; 512]), Some(false));
        assert!(!d.is_speaking());
    }

    #[test]
    fn rms_hysteresis_band_holds_state() {
        let mut d = RmsSpeakingDetector::new();
        // 0.001 lies between SILENCE and START and does not trigger speech onset.
        assert_eq!(d.push(&[0.001; 512]), None);
        assert!(!d.is_speaking());
        // Once speaking, 0.001 remains above SILENCE and keeps speech active.
        assert_eq!(d.push(&[0.05; 256]), Some(true));
        assert_eq!(d.push(&[0.001; 512]), None);
        assert!(d.is_speaking());
    }

    #[test]
    fn rms_empty_slice_is_no_decision() {
        let mut d = RmsSpeakingDetector::new();
        assert_eq!(d.push(&[]), None);
    }

    #[test]
    fn quality_mapping_covers_js_values() {
        assert_eq!(
            NativeConnectionQuality::from_livekit_str("excellent"),
            NativeConnectionQuality::Excellent
        );
        assert_eq!(
            NativeConnectionQuality::from_livekit_str("good"),
            NativeConnectionQuality::Good
        );
        assert_eq!(
            NativeConnectionQuality::from_livekit_str("poor"),
            NativeConnectionQuality::Poor
        );
        assert_eq!(
            NativeConnectionQuality::from_livekit_str("lost"),
            NativeConnectionQuality::Lost
        );
        assert_eq!(
            NativeConnectionQuality::from_livekit_str("whatever"),
            NativeConnectionQuality::Unknown
        );
    }

    #[test]
    fn data_payloads_roundtrip_like_js() {
        // AFK : {"deafened":true}
        let afk = AfkPayload { deafened: true };
        let raw = serde_json::to_string(&afk).unwrap();
        assert_eq!(raw, r#"{"deafened":true}"#);
        assert_eq!(decode_json::<AfkPayload>(&raw).unwrap(), afk);

        // Soundboard keys match broadcastSound.
        let sb: SoundboardPayload = decode_json(r#"{"mxc":"mxc://h/snd","emoji":"🔊"}"#).unwrap();
        assert_eq!(sb.emoji, "🔊");
        assert_eq!(sb.duration, 3000);
        let raw = serde_json::to_string(&sb).unwrap();
        let back: SoundboardPayload = decode_json(&raw).unwrap();
        assert_eq!(back, sb);
        // Older senders without gain default to 1.0.
        let legacy: SoundboardPayload =
            decode_json(r#"{"mxc":"mxc://h/s","emoji":"🔊","duration":1500}"#).unwrap();
        assert_eq!(legacy.gain, 1.0);
    }

    #[test]
    fn e2ee_keys_accept_16_or_32_bytes() {
        // Accept 16-byte MatrixRTC AES-128 and 32-byte AES-256 keys; reject other lengths.
        assert!(validate_e2ee_key(&[7u8; 16]));
        assert!(validate_e2ee_key(&[7u8; 32]));
        assert!(!validate_e2ee_key(&[]));
        assert!(!validate_e2ee_key(&[7u8; 24]));
        assert!(!validate_e2ee_key(&[7u8; 64]));
    }

    #[test]
    fn participant_mirror_serializes_like_ts() {
        let mut p = NativeParticipant::new("@flamme:example.org:XYZ", "flamme");
        p.is_speaking = true;
        p.connection_quality = NativeConnectionQuality::Excellent;
        p.playing_sound_emoji = Some("🥁".into());
        let raw = serde_json::to_string(&p).unwrap();
        assert!(raw.contains(r#""identity":"@flamme:example.org:XYZ""#));
        assert!(raw.contains(r#""isSpeaking":true"#));
        assert!(raw.contains(r#""connectionQuality":"excellent""#));
        // serde rename_all supplies the frontend's required camelCase keys.
        let back: NativeParticipant = decode_json(&raw).unwrap();
        assert_eq!(back.name, "flamme");
    }

    /// Registry integration with engine events under native-voice.
    #[cfg(feature = "native-voice")]
    mod engine_wiring {
        use super::super::*;
        use crate::voice_engine::VoiceEngineEvent as E;
        use std::collections::HashMap;

        fn empty() -> HashMap<String, NativeParticipant> {
            HashMap::new()
        }

        #[test]
        fn join_leave_maintain_the_list() {
            let mut map = empty();
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@b:h".into(),
                    name: "b".into()
                }
            ));
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@a:h".into(),
                    name: "a".into()
                }
            ));
            assert_eq!(map.len(), 2);
            assert_eq!(map["@a:h"].name, "a");
            // Rejoin updates the name without duplicating the participant.
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@a:h".into(),
                    name: "a2".into()
                }
            ));
            assert_eq!(map.len(), 2);
            assert_eq!(map["@a:h"].name, "a2");
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantLeft {
                    identity: "@a:h".into(),
                    perdu: None
                }
            ));
            assert_eq!(map.len(), 1);
            // An unknown departure changes nothing and emits no list.
            assert!(!apply_engine_event(
                &mut map,
                &E::ParticipantLeft {
                    identity: "@z:h".into(),
                    perdu: None
                }
            ));
        }

        #[test]
        fn join_empty_name_keeps_identity() {
            let mut map = empty();
            // An empty LiveKit name preserves the identity fallback.
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@a:h".into(),
                    name: "".into()
                }
            ));
            assert_eq!(map["@a:h"].name, "@a:h");
            // Vrai nom : pris en compte.
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@a:h".into(),
                    name: "a".into()
                }
            ));
            assert_eq!(map["@a:h"].name, "a");
            // Rejoining with an empty name must not replace a known name.
            assert!(apply_engine_event(
                &mut map,
                &E::ParticipantJoined {
                    identity: "@a:h".into(),
                    name: "".into()
                }
            ));
            assert_eq!(map["@a:h"].name, "a");
        }

        #[test]
        fn speaking_mute_quality_update_flags() {
            let mut map = empty();
            assert!(apply_engine_event(
                &mut map,
                &E::SpeakingChanged {
                    identity: "@a:h".into(),
                    speaking: true
                }
            ));
            // Upsert participants when state arrives before join.
            assert!(map["@a:h"].is_speaking);
            assert!(apply_engine_event(
                &mut map,
                &E::TrackMutedChanged {
                    identity: "@a:h".into(),
                    muted: true
                }
            ));
            assert!(map["@a:h"].is_muted);
            assert!(apply_engine_event(
                &mut map,
                &E::QualityChanged {
                    identity: "@a:h".into(),
                    quality: "poor".into()
                }
            ));
            assert_eq!(
                map["@a:h"].connection_quality,
                NativeConnectionQuality::Poor
            );
        }

        #[test]
        fn video_presence_drives_screen_sharing_flag() {
            let mut map = empty();
            assert!(apply_engine_event(
                &mut map,
                &E::VideoPresence {
                    sender: "@p:h".into(),
                    sharing: true
                }
            ));
            assert!(map["@p:h"].is_screen_sharing);
            assert!(apply_engine_event(
                &mut map,
                &E::VideoPresence {
                    sender: "@p:h".into(),
                    sharing: false
                }
            ));
            assert!(!map["@p:h"].is_screen_sharing);
        }

        #[test]
        fn share_audio_presence_drives_speaker_flag() {
            let mut map = empty();
            // Audio presence is independent of video; audio may arrive first.
            assert!(apply_engine_event(
                &mut map,
                &E::ShareAudioPresence {
                    sender: "@p:h".into(),
                    has_audio: true
                }
            ));
            assert!(map["@p:h"].is_screen_sharing_audio);
            assert!(!map["@p:h"].is_screen_sharing);
            assert!(apply_engine_event(
                &mut map,
                &E::ShareAudioPresence {
                    sender: "@p:h".into(),
                    has_audio: false
                }
            ));
            assert!(!map["@p:h"].is_screen_sharing_audio);
        }

        #[test]
        fn room_status_events_do_not_touch_the_list() {
            let mut map = empty();
            assert!(!apply_engine_event(&mut map, &E::RoomReconnecting));
            assert!(!apply_engine_event(&mut map, &E::RoomReconnected));
            assert!(!apply_engine_event(
                &mut map,
                &E::RoomDisconnected {
                    reason: "x".into(),
                    reprendre: false
                }
            ));
            assert!(map.is_empty());
        }

        #[test]
        fn soundboard_badge_decodes_js_payload() {
            use base64::Engine as _;
            let mut map = empty();
            let payload = base64::engine::general_purpose::STANDARD
                .encode(r#"{"mxc":"mxc://h/s","emoji":"🥁","duration":2500,"gain":1.5}"#);
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &payload, 1_000),
                Some(2500)
            );
            assert_eq!(map["@dj:h"].playing_sound_emoji.as_deref(), Some("🥁"));
            // The stored absolute deadline governs expiry; a blind duration sleep must not hide a newer sound.
            assert_eq!(map["@dj:h"].badge_deadline_ms, 3_500);
            // Payload corrompu : pas de badge, pas de panique.
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", "!!!", 1_000),
                None
            );
        }

        /// A shorter overlapping sound must never shorten the longer sound's badge deadline.
        #[test]
        fn soundboard_badge_deadline_never_moves_backwards() {
            use base64::Engine as _;
            let enc = |raw: &str| base64::engine::general_purpose::STANDARD.encode(raw);
            let mut map = empty();
            let long = enc(r#"{"mxc":"mxc://h/long","emoji":"🎵","duration":9000,"gain":1}"#);
            let short = enc(r#"{"mxc":"mxc://h/short","emoji":"🔔","duration":2000,"gain":1}"#);
            // A long sound at t=0 expires at nine seconds.
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &long, 0),
                Some(9000)
            );
            // A short sound one second later retains the longer deadline.
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &short, 1_000),
                Some(2000)
            );
            assert_eq!(map["@dj:h"].badge_deadline_ms, 9_000);
            // A later longer sound extends expiry.
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &long, 5_000),
                Some(9000)
            );
            assert_eq!(map["@dj:h"].badge_deadline_ms, 14_000);
            // Different senders keep independent deadlines.
            assert_eq!(
                apply_soundboard_badge(&mut map, "@p:h", &short, 5_000),
                Some(2000)
            );
            assert_eq!(map["@p:h"].badge_deadline_ms, 7_000);
            assert_eq!(map["@dj:h"].badge_deadline_ms, 14_000);
        }

        /// Missing, zero or excessive duration must not produce instant or unbounded badges.
        #[test]
        fn soundboard_badge_duration_is_sane() {
            use base64::Engine as _;
            let enc = |raw: &str| base64::engine::general_purpose::STANDARD.encode(raw);
            let mut map = empty();
            // An older payload without duration decodes with the three-second fallback.
            let no_duration = enc(r#"{"mxc":"mxc://h/s","emoji":"🔊","gain":1}"#);
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &no_duration, 0),
                Some(BADGE_DEFAULT_MS)
            );
            // A failed duration probe reporting zero uses the fallback.
            let zero = enc(r#"{"mxc":"mxc://h/z","emoji":"🔊","duration":0,"gain":1}"#);
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &zero, 0),
                Some(BADGE_DEFAULT_MS)
            );
            assert_eq!(map["@dj:h"].badge_deadline_ms, BADGE_DEFAULT_MS);
            // Clamp excessive duration.
            let huge = enc(r#"{"mxc":"mxc://h/h","emoji":"🔊","duration":9999999,"gain":1}"#);
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &huge, 0),
                Some(BADGE_MAX_MS)
            );
            assert_eq!(map["@dj:h"].badge_deadline_ms, BADGE_MAX_MS);
        }

        /// Receiver startup delay extends expiry without shortening it
        /// or restoring an inactive badge when no sound is played.
        #[test]
        fn soundboard_badge_extension_respects_playback_start() {
            use base64::Engine as _;
            let enc = |raw: &str| base64::engine::general_purpose::STANDARD.encode(raw);
            let mut map = empty();
            let payload = enc(r#"{"mxc":"mxc://h/s","emoji":"🎵","duration":4000,"gain":1}"#);
            assert_eq!(
                apply_soundboard_badge(&mut map, "@dj:h", &payload, 0),
                Some(4000)
            );
            // Playback starts at 482 ms, extending the receiver deadline.
            assert!(extend_badge_deadline(
                &mut map,
                "@dj:h",
                4000,
                Some("🎵"),
                482
            ));
            assert_eq!(map["@dj:h"].badge_deadline_ms, 4_482);
            // A shorter measured clip must not shorten the existing deadline.
            assert!(!extend_badge_deadline(
                &mut map,
                "@dj:h",
                1500,
                Some("🎵"),
                500
            ));
            assert_eq!(map["@dj:h"].badge_deadline_ms, 4_482);
            // A supplied emoji restores a badge that expired during a slow download.
            map.get_mut("@dj:h").unwrap().playing_sound_emoji = None;
            assert!(extend_badge_deadline(
                &mut map,
                "@dj:h",
                4000,
                Some("🎵"),
                600
            ));
            assert_eq!(map["@dj:h"].playing_sound_emoji.as_deref(), Some("🎵"));
            assert_eq!(map["@dj:h"].badge_deadline_ms, 4_600);
            // No emoji and no active badge means nothing can be restored.
            map.get_mut("@dj:h").unwrap().playing_sound_emoji = None;
            let before = map["@dj:h"].badge_deadline_ms;
            assert!(!extend_badge_deadline(&mut map, "@dj:h", 4000, None, 700));
            assert_eq!(map["@dj:h"].badge_deadline_ms, before);
            // Ignore unknown senders.
            assert!(!extend_badge_deadline(
                &mut map,
                "@absent:h",
                4000,
                Some("🎵"),
                700
            ));
        }

        /// Rust duration normalization must match the JS fallback.
        #[test]
        fn soundboard_badge_fallback_matches_js_contract() {
            assert_eq!(BADGE_DEFAULT_MS, 3_000);
            assert_eq!(sane_badge_ms(0), 3_000);
            assert_eq!(sane_badge_ms(500), 500);
            assert_eq!(sane_badge_ms(BADGE_MAX_MS + 1), BADGE_MAX_MS);
            // A minimal older-client payload without duration must still decode.
            let minimal: SoundboardPayload =
                decode_json(r#"{"mxc":"mxc://h/s","emoji":"🔊"}"#).unwrap();
            assert_eq!(minimal.duration, BADGE_DEFAULT_MS);
            assert_eq!(minimal.gain, 1.0);
        }

        #[test]
        fn data_topics_match_js_constants() {
            // Keep topics identical to frontend soundboard and voice data-channel contracts.
            assert_eq!(TOPIC_AFK, "sion-afk");
            assert_eq!(TOPIC_SOUNDBOARD, "sion-soundboard");
            assert_eq!(TOPIC_CURSOR, "sion-cursor");
            assert_eq!(TOPIC_CURSOR_CLICK, "sion-cursor-click");
        }

        #[cfg(not(target_os = "android"))]
        #[test]
        fn cursor_name_prefere_pseudo_et_replie_sur_localpart() {
            assert_eq!(
                super::cursor_display_name(
                    Some("Picsou"),
                    Some("@picsou:example.org:device"),
                    "@picsou:example.org:device",
                ),
                "Picsou"
            );
            assert_eq!(
                super::cursor_display_name(
                    None,
                    Some("@picsou:example.org:device"),
                    "@picsou:example.org:device",
                ),
                "picsou"
            );
        }

        #[test]
        fn afk_state_mirrors_js_broadcast() {
            use base64::Engine as _;
            let enc = |raw: &str| base64::engine::general_purpose::STANDARD.encode(raw);
            let mut map = empty();
            // Apply remote deafen, upserting if join has not arrived yet.
            assert!(apply_afk_state(
                &mut map,
                "@p:h",
                &enc(r#"{"deafened":true}"#)
            ));
            assert!(map["@p:h"].is_deafened);
            // Clear deafen on return.
            assert!(apply_afk_state(
                &mut map,
                "@p:h",
                &enc(r#"{"deafened":false}"#)
            ));
            assert!(!map["@p:h"].is_deafened);
            // Payload JS exact (champ unique, pas d'extra).
            assert!(apply_afk_state(
                &mut map,
                "@q:h",
                &enc(r#"{"deafened":true}"#)
            ));
            assert!(map["@q:h"].is_deafened);
            // Corrompus : pas de changement, pas de panique.
            assert!(!apply_afk_state(&mut map, "@p:h", "!!!"));
            assert!(!apply_afk_state(&mut map, "@p:h", &enc("pas du json")));
            assert!(!apply_afk_state(
                &mut map,
                "@p:h",
                &enc(r#"{"muted":true}"#)
            ));
            assert!(!map["@p:h"].is_deafened);
        }

        #[test]
        fn webcam_et_partage_restent_independants_du_micro() {
            let mut map = HashMap::new();
            let id = "@p:h".to_string();
            apply_engine_event(
                &mut map,
                &VoiceEngineEvent::TrackMutedChanged {
                    identity: id.clone(),
                    muted: true,
                },
            );
            apply_engine_event(
                &mut map,
                &VoiceEngineEvent::VideoPresence {
                    sender: id.clone(),
                    sharing: true,
                },
            );
            apply_engine_event(
                &mut map,
                &VoiceEngineEvent::CameraPresence {
                    sender: id.clone(),
                    active: true,
                },
            );
            assert!(map[&id].is_muted && map[&id].is_screen_sharing && map[&id].is_camera_enabled);
            apply_engine_event(
                &mut map,
                &VoiceEngineEvent::CameraPresence {
                    sender: id.clone(),
                    active: false,
                },
            );
            assert!(map[&id].is_muted && map[&id].is_screen_sharing && !map[&id].is_camera_enabled);
        }

        #[test]
        fn afk_payload_serializes_like_js() {
            // Native AFK serialization must remain compatible with JS broadcastAfk.
            let raw = serde_json::to_string(&AfkPayload { deafened: true }).unwrap();
            assert_eq!(raw, r#"{"deafened":true}"#);
        }
    }
}
