//! Local playback with bounded PCM, pause/stop and consumed position.
//! Active WebRTC mixes the same source into its AEC render; outside a call
//! or while deafened, native output takes over without using the webview.
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    position_ms: u64,
    buffered_ms: u64,
    done: bool,
    error: Option<String>,
}

#[cfg(feature = "native-voice")]
mod runtime {
    use super::PlaybackStatus;
    use base64::Engine;
    use sion_native_audio::playback::{self, RenderSource, Stream, LOCAL, SILENT, VOCAL};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::{Duration, Instant};

    struct Player {
        stream: Arc<Stream>,
        closed: Arc<AtomicBool>,
        error: Arc<Mutex<Option<String>>>,
        pushed: Arc<Mutex<Instant>>,
        worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    }
    impl Drop for Player {
        fn drop(&mut self) {
            self.stream.stopped.store(true, Ordering::Release);
            if let Some(worker) = self
                .worker
                .get_mut()
                .unwrap_or_else(|e| e.into_inner())
                .take()
            {
                let _ = worker.join();
            }
        }
    }
    static PLAYERS: LazyLock<Mutex<HashMap<u64, Arc<Player>>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    fn decode(pcm: &str, channels: u8) -> Result<Vec<i16>, String> {
        decode_bounded(pcm, channels, playback::CAPACITY)
    }
    fn decode_bounded(pcm: &str, channels: u8, max_frames: usize) -> Result<Vec<i16>, String> {
        if !(1..=2).contains(&channels) || pcm.len() > max_frames * channels as usize * 8 / 3 + 8 {
            return Err("tranche PCM trop grande ou format invalide".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(pcm)
            .map_err(|e| e.to_string())?;
        if bytes.len() % (channels as usize * 2) != 0 {
            return Err("PCM incomplet".into());
        }
        Ok(bytes
            .chunks_exact(2)
            .map(|v| i16::from_le_bytes([v[0], v[1]]))
            .collect())
    }

    pub fn open(
        pcm: String,
        channels: u8,
        gain: f32,
        finished: bool,
        allow_deafened: bool,
        output_device: Option<String>,
    ) -> Result<u64, String> {
        let interrupt_generation = sion_native_audio::device_interrupt_generation();
        if finished && sion_native_audio::device_interrupted() { return Err("audio suspendu par Android".into()); }
        if !gain.is_finite() || !(0.0..=3.0).contains(&gain) {
            return Err("volume audio invalide".into());
        }
        let samples = decode_bounded(
            &pcm,
            channels,
            if finished {
                48_000 * 20
            } else {
                playback::CAPACITY
            },
        )?;
        // Drop finished players outside the lock because Drop joins their workers.
        let finished_players = {
            let mut players = PLAYERS.lock().unwrap_or_else(|e| e.into_inner());
            let ids: Vec<_> = players
                .iter()
                .filter(|(_, p)| p.closed.load(Ordering::Acquire))
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter()
                .filter_map(|id| players.remove(&id))
                .collect::<Vec<_>>()
        };
        drop(finished_players);
        let mut players = PLAYERS.lock().unwrap_or_else(|e| e.into_inner());
        if players.len() >= 32 {
            return Err("trop de lectures audio simultanées".into());
        }
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let stream = Stream::new(gain);
        stream.discard_on_interrupt.store(finished, Ordering::Release);
        let feeder = if finished {
            let feeder = playback::ClipFeeder::new(samples, channels as usize);
            feeder.feed(&stream).map_err(str::to_string)?;
            Some(feeder)
        } else {
            stream
                .push(&samples, channels as usize, false)
                .map_err(str::to_string)?;
            None
        };
        let closed = Arc::new(AtomicBool::new(false));
        let error = Arc::new(Mutex::new(None));
        let pushed = Arc::new(Mutex::new(Instant::now()));
        let player = Arc::new(Player {
            stream: stream.clone(),
            closed: closed.clone(),
            error: error.clone(),
            pushed: pushed.clone(),
            worker: Mutex::new(None),
        });
        let source: Arc<dyn RenderSource> = stream.clone();
        playback::register(&source);
        if finished && (sion_native_audio::device_interrupted() || sion_native_audio::device_interrupt_generation() != interrupt_generation) {
            source.interrupt();
        }
        let worker = std::thread::Builder::new()
            .name(format!("sion-audio-{id}"))
            .spawn(move || {
                let result = run_output(&stream, allow_deafened, output_device, || {
                    if let Some(feeder) = &feeder {
                        if let Err(message) = feeder.feed(&stream) {
                            if !stream.stopped.load(Ordering::Acquire) {
                                log::warn!("[Sion][audio] {message}");
                            }
                            return false;
                        }
                    }
                    pushed.lock().unwrap_or_else(|e| e.into_inner()).elapsed()
                        < Duration::from_secs(30)
                });
                if let Err(message) = result {
                    *error.lock().unwrap_or_else(|e| e.into_inner()) = Some(message);
                }
                closed.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;
        *player.worker.lock().unwrap_or_else(|e| e.into_inner()) = Some(worker);
        players.insert(id, player);
        Ok(id)
    }

    fn get(id: u64) -> Result<Arc<Player>, String> {
        PLAYERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .ok_or_else(|| "lecture audio arrêtée".into())
    }
    pub fn push(id: u64, pcm: String, channels: u8, finished: bool) -> Result<(), String> {
        let player = get(id)?;
        player
            .stream
            .push(&decode(&pcm, channels)?, channels as usize, finished)
            .map_err(str::to_string)?;
        *player.pushed.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        Ok(())
    }
    pub fn pause(id: u64, paused: bool) -> Result<(), String> {
        let player = get(id)?;
        player.stream.paused.store(paused, Ordering::Release);
        *player.pushed.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        Ok(())
    }
    pub fn volume(id: u64, gain: f32) -> Result<(), String> {
        get(id)?.stream.set_gain(gain).map_err(str::to_string)
    }
    pub fn status(id: u64) -> Result<PlaybackStatus, String> {
        let player = get(id)?;
        *player.pushed.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        let (position_ms, queued, _) = player.stream.status();
        let done = player.closed.load(Ordering::Acquire);
        let error = player
            .error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let status = PlaybackStatus {
            position_ms,
            buffered_ms: queued as u64 * 1000 / 48_000,
            done,
            error,
        };
        if done {
            stop(id);
        }
        Ok(status)
    }
    pub fn stop(id: u64) {
        let player = PLAYERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        if let Some(player) = player {
            player.stream.stopped.store(true, Ordering::Release);
        }
    }
    pub fn shutdown() {
        let players = std::mem::take(&mut *PLAYERS.lock().unwrap_or_else(|e| e.into_inner()));
        for player in players.values() {
            player.stream.stopped.store(true, Ordering::Release);
        }
        drop(players);
    }
    fn route(stream: &Stream, allow_deafened: bool) -> u8 {
        let muted = sion_native_audio::device_interrupted()
            || (crate::voice_native::en_sourdine() && !allow_deafened);
        let output = if muted {
            SILENT
        } else if crate::voice_native::rendu_local_dans_vocal() {
            VOCAL
        } else {
            LOCAL
        };
        stream.route.store(output, Ordering::Release);
        output
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn audio_playback_joins_owned_workers_on_success_failure_and_cancellation() {
            for mode in 0..30 {
                let stream = Stream::new(1.0);
                let weak = Arc::downgrade(&stream);
                let closed = Arc::new(AtomicBool::new(false));
                let player = Player {
                    stream: stream.clone(),
                    closed: closed.clone(),
                    error: Arc::new(Mutex::new(None)),
                    pushed: Arc::new(Mutex::new(Instant::now())),
                    worker: Mutex::new(None),
                };
                let worker = std::thread::spawn(move || {
                    if mode % 3 == 0 {
                        while !stream.stopped.load(Ordering::Acquire) {
                            std::thread::yield_now();
                        }
                    } else if mode % 3 == 1 {
                        stream.push(&[1000], 1, true).unwrap();
                        stream.output(&mut [0.0], 48_000, 1);
                    }
                    closed.store(true, Ordering::Release);
                });
                *player.worker.lock().unwrap() = Some(worker);
                drop(player);
                assert!(
                    weak.upgrade().is_none(),
                    "fil et file encore vivants après Drop"
                );
            }
        }

        #[test]
        fn audio_playback_rejects_partial_frames_and_unbounded_ipc() {
            assert!(decode("AAAA", 2).is_err());
            assert!(decode("AAAA", 0).is_err());
            assert!(decode(&"A".repeat(playback::CAPACITY * 8), 1).is_err());
        }
    }

    #[cfg(not(target_os = "android"))]
    fn run_output(
        stream: &Arc<Stream>,
        allow_deafened: bool,
        output_device: Option<String>,
        alive: impl Fn() -> bool,
    ) -> Result<(), String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let mut local = None;
        while !stream.stopped.load(Ordering::Acquire) && !stream.status().2 && alive() {
            if route(stream, allow_deafened) == VOCAL {
                local.take();
            } else if local.is_none() {
                let host = cpal::default_host();
                let device = output_device
                    .as_deref()
                    .filter(|name| !name.is_empty())
                    .and_then(|name| {
                        host.output_devices().ok()?.find(|d| {
                            d.description()
                                .is_ok_and(|description| description.name() == name)
                        })
                    })
                    .or_else(|| host.default_output_device())
                    .ok_or("aucune sortie audio native")?;
                let config = device.default_output_config().map_err(|e| e.to_string())?;
                let rate = config.sample_rate();
                let channels = config.channels() as usize;
                let source = stream.clone();
                let output = match config.sample_format() {
                    cpal::SampleFormat::F32 => device.build_output_stream(
                        config.into(),
                        move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            source.output(out, rate, channels)
                        },
                        |e| log::warn!("[Sion][audio] {e}"),
                        None,
                    ),
                    _ => return Err("format de sortie audio native non géré".into()),
                }
                .map_err(|e| e.to_string())?;
                output.play().map_err(|e| e.to_string())?;
                local = Some(output);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !stream.stopped.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(120));
        }
        Ok(())
    }

    #[cfg(target_os = "android")]
    fn run_output(
        stream: &Arc<Stream>,
        allow_deafened: bool,
        _output_device: Option<String>,
        alive: impl Fn() -> bool,
    ) -> Result<(), String> {
        use jni::objects::{JObject, JValue};
        let vm = crate::android_natif::audio_vm().ok_or("JavaVM audio indisponible")?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let mut stream_type = if crate::voice_native::android_voice_token() != 0 { 0 } else { 3 };
        let make_track = |env: &mut jni::JNIEnv<'_>, stream_type: i32| {
            env.new_object("android/media/AudioTrack", "(IIIIII)V", &[
                JValue::Int(stream_type), JValue::Int(48_000), JValue::Int(12),
                JValue::Int(2), JValue::Int(7680), JValue::Int(1),
            ]).and_then(|track| {
                let result = env.new_global_ref(&track);
                let _ = env.delete_local_ref(track);
                result
            }).map_err(|e| e.to_string())
        };
        let mut track = make_track(&mut env, stream_type)?;
        let result = (|| -> Result<(), String> {
            let state = env
                .call_method(&track, "getState", "()I", &[])
                .and_then(|v| v.i())
                .map_err(|e| e.to_string())?;
            if state != 1 {
                return Err("AudioTrack non initialisé".into());
            }
            let array = env.new_short_array(960).map_err(|e| e.to_string())?;
            let mut playing = false;
            while !stream.stopped.load(Ordering::Acquire) && !stream.status().2 && alive() {
                // Communication streams follow the call route; media streams resume
                // normal Android routing when the call ends, including Bluetooth A2DP.
                let wanted = if crate::voice_native::android_voice_token() != 0 { 0 } else { 3 };
                if wanted != stream_type {
                    let replacement = make_track(&mut env, wanted)?;
                    let _ = env.call_method(&track, "stop", "()V", &[]);
                    let _ = env.call_method(&track, "release", "()V", &[]);
                    track = replacement;
                    stream_type = wanted;
                    playing = false;
                }
                let local = route(stream, allow_deafened) != VOCAL;
                if local != playing {
                    env.call_method(&track, if local { "play" } else { "pause" }, "()V", &[])
                        .map_err(|e| e.to_string())?;
                    playing = local;
                }
                if local {
                    let mut pcm = [0.0; 960];
                    stream.output(&mut pcm, 48_000, 2);
                    let pcm: Vec<i16> = pcm
                        .into_iter()
                        .map(|v| (v.clamp(-1.0, 1.0) * 32767.0).round() as i16)
                        .collect();
                    env.set_short_array_region(&array, 0, &pcm)
                        .map_err(|e| e.to_string())?;
                    let written = env
                        .call_method(
                            &track,
                            "write",
                            "([SII)I",
                            &[
                                JValue::Object(<&JObject>::from(&array)),
                                JValue::Int(0),
                                JValue::Int(960),
                            ],
                        )
                        .and_then(|v| v.i())
                        .map_err(|e| e.to_string())?;
                    if written < 0 {
                        return Err(format!("AudioTrack write : {written}"));
                    }
                } else {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            if !stream.stopped.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(120));
            }
            Ok(())
        })();
        if result.is_err() { let _ = env.exception_clear(); }
        let _ = env.call_method(&track, "stop", "()V", &[]);
        let _ = env.call_method(&track, "release", "()V", &[]);
        result
    }
}

#[tauri::command]
pub fn audio_native_open(
    pcm_b64: String,
    channels: u8,
    gain: f32,
    finished: bool,
    allow_deafened: bool,
    output_device: Option<String>,
) -> Result<u64, String> {
    #[cfg(feature = "native-voice")]
    return runtime::open(
        pcm_b64,
        channels,
        gain,
        finished,
        allow_deafened,
        output_device,
    );
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (
            pcm_b64,
            channels,
            gain,
            finished,
            allow_deafened,
            output_device,
        );
        Err("audio natif non compilé".into())
    }
}
#[tauri::command]
pub fn audio_native_push(
    id: u64,
    pcm_b64: String,
    channels: u8,
    finished: bool,
) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    return runtime::push(id, pcm_b64, channels, finished);
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (id, pcm_b64, channels, finished);
        Err("audio natif non compilé".into())
    }
}
#[tauri::command]
pub fn audio_native_pause(id: u64, paused: bool) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    return runtime::pause(id, paused);
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (id, paused);
        Err("audio natif non compilé".into())
    }
}
#[tauri::command]
pub fn audio_native_volume(id: u64, gain: f32) -> Result<(), String> {
    #[cfg(feature = "native-voice")]
    return runtime::volume(id, gain);
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = (id, gain);
        Err("audio natif non compilé".into())
    }
}

#[tauri::command]
pub fn audio_native_status(id: u64) -> Result<PlaybackStatus, String> {
    #[cfg(feature = "native-voice")]
    return runtime::status(id);
    #[cfg(not(feature = "native-voice"))]
    {
        let _ = id;
        Err("audio natif non compilé".into())
    }
}
#[tauri::command]
pub fn audio_native_stop(id: u64) {
    #[cfg(feature = "native-voice")]
    runtime::stop(id);
    #[cfg(not(feature = "native-voice"))]
    let _ = id;
}
pub fn shutdown() {
    #[cfg(feature = "native-voice")]
    runtime::shutdown();
}
