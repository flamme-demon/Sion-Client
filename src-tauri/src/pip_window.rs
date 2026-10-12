//! Fenêtre PIP native des vidéos (partages et webcams), au-dessus des applis.
//!
//! Complète le PIP *interne* (carte flottante dans la webview) : ici la
//! fenêtre est une vraie fenêtre OS, `AlwaysOnTop`, sans décoration, pilotée
//! par winit + softbuffer — même pile que l'overlay de curseurs, et pour la
//! même raison : les images du partage sont **déjà côté Rust** quand elles
//! sortent de libwebrtc. Elles sont converties une fois d'I420 vers BGRA puis
//! blitées ici, sans recompression JPEG ni passage par la webview.
//!
//! Architecture (calquée sur `cursor_overlay.rs`) :
//!   - un thread hôte porte l'event loop winit (X11 forcé sous Linux, sinon
//!     Wayland ignore `WindowLevel::AlwaysOnTop`) ;
//!   - `on_bgra_frame()` dépose la dernière image dans un état partagé puis
//!     réveille la boucle par un `UserEvent` ;
//!   - la boucle blitte à ~30 fps maximum (latest-wins, letterbox noir) ;
//!   - glisser au clic gauche déplace la fenêtre, clic droit ou Échap la
//!     ferme — pas de décoration, donc pas de bouton système.
//!
//! La position est mémorisée en mémoire (par session) ; le partage terminé
//! ferme la fenêtre automatiquement.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowAttributes, WindowId, WindowLevel};

const DEFAULT_W: u32 = 480;
const DEFAULT_H: u32 = 270;
const LARGE_W: u32 = 768;
const LARGE_H: u32 = 432;
const MARGIN: i32 = 24;
/// Peinture bornée à ~30 fps : une vignette n'a pas besoin de suivre une
/// source 60 fps et l'état latest-wins remplace les frames intermédiaires.
const MIN_PAINT_INTERVAL: Duration = Duration::from_millis(33);

#[derive(Clone)]
struct PipFrame {
    width: u32,
    height: u32,
    bgra: Arc<[u8]>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct PipSource {
    sender: String,
    name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileRect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

// Même disposition que la fenêtre interne : partage en grand, rail des
// autres flux ; sans partage, mosaïque. Les pixels restent bornés à la fenêtre.
fn tile_rects(count: usize, focus: Option<usize>, size: (u32, u32)) -> Vec<TileRect> {
    if count == 0 {
        return vec![];
    }
    let (w, h) = size;
    let whole = TileRect { x: 0, y: 0, w, h };
    let grid = |count: usize, area: TileRect| {
        let cols = ((count as f64 * area.w as f64 / area.h.max(1) as f64 * 9.0 / 16.0)
            .sqrt()
            .ceil() as usize)
            .clamp(1, count);
        let rows = count.div_ceil(cols);
        (0..count)
            .map(|i| {
                let x = area.x + area.w * (i % cols) as u32 / cols as u32;
                let y = area.y + area.h * (i / cols) as u32 / rows as u32;
                let right = area.x + area.w * ((i % cols) + 1) as u32 / cols as u32;
                let bottom = area.y + area.h * ((i / cols) + 1) as u32 / rows as u32;
                TileRect {
                    x,
                    y,
                    w: right - x,
                    h: bottom - y,
                }
            })
            .collect::<Vec<_>>()
    };
    let Some(focus) = focus.filter(|&i| i < count && count > 1) else {
        return grid(count, whole);
    };
    let (main, rail) = if w >= h {
        let rail = w * 28 / 100;
        (
            TileRect {
                w: w - rail,
                ..whole
            },
            TileRect {
                x: w - rail,
                w: rail,
                ..whole
            },
        )
    } else {
        let rail = h * 35 / 100;
        (
            TileRect {
                h: h - rail,
                ..whole
            },
            TileRect {
                y: h - rail,
                h: rail,
                ..whole
            },
        )
    };
    let mut others = grid(count - 1, rail).into_iter();
    (0..count)
        .map(|i| {
            if i == focus {
                main
            } else {
                others.next().unwrap()
            }
        })
        .collect()
}

#[derive(Default)]
struct PipState {
    /// Partage affiché (identité de l'expéditeur). `None` = fenêtre fermée.
    sender: Option<String>,
    /// Dernière image reçue pour ce partage (gardée : une source en pause
    /// laisse l'écran rempli au lieu de noircir, et une réouverture repart de
    /// la dernière image au lieu d'un écran noir).
    frames: HashMap<String, PipFrame>,
    streams: Vec<PipSource>,
    focus: Option<String>,
    generation: u64,
    /// Dernière génération peinte par la boucle d'événements.
    painted: u64,
    /// Position mémorisée de la fenêtre (retrouvée à la réouverture).
    last_pos: Option<(i32, i32)>,
    /// Grande taille (double-clic) — mémorisée aussi.
    large: bool,
    /// Taille libre choisie par l'utilisateur (en pixels physiques).
    size: Option<(u32, u32)>,
    /// Taille à restaurer après le double-clic d'agrandissement.
    normal_size: Option<(u32, u32)>,
    /// Son du partage coupé ? Renseigné par `pip_native_open` (hors du fil de
    /// l'event loop : interroger le moteur depuis ce fil retardait l'affichage
    /// — le moteur peut être tenu par le décodage vidéo).
    share_audio_muted: bool,
    cursor_enabled: bool,
}

impl PipState {
    fn configure(&mut self, streams: Vec<PipSource>, focus: Option<String>) {
        let focus = match focus.as_deref() {
            Some("") => None,
            Some(key) if streams.iter().any(|s| s.sender == key) => focus,
            _ => streams
                .iter()
                .find(|s| !s.sender.starts_with("camera:"))
                .map(|s| s.sender.clone()),
        };
        let sender = focus
            .clone()
            .or_else(|| streams.first().map(|s| s.sender.clone()));
        if self.sender != sender {
            self.cursor_enabled = false;
            self.share_audio_muted = false;
        }
        self.sender = sender;
        self.focus = focus;
        self.frames
            .retain(|key, _| streams.iter().any(|s| &s.sender == key));
        self.streams = streams;
        self.generation = self.generation.wrapping_add(1);
        self.painted = 0;
    }
    fn rects(&self, size: (u32, u32)) -> Vec<TileRect> {
        tile_rects(
            self.streams.len(),
            self.focus
                .as_ref()
                .and_then(|key| self.streams.iter().position(|s| &s.sender == key)),
            size,
        )
    }
}

#[derive(Debug)]
enum UserEvent {
    /// Affiche la fenêtre. Le canal optionnel confirme que la surface native
    /// existe réellement avant que le front coupe son propre lecteur.
    Show(Option<std::sync::mpsc::SyncSender<bool>>),
    Hide,
    /// Une nouvelle image est disponible (réveille la boucle).
    Frame,
}

struct PipHandle {
    state: Arc<Mutex<PipState>>,
    proxy: EventLoopProxy<UserEvent>,
    thread_alive: Arc<AtomicBool>,
}

static HANDLE: OnceLock<PipHandle> = OnceLock::new();
static OPEN: AtomicBool = AtomicBool::new(false);
/// Handle Tauri de l'application, posé au démarrage (`set_app_handle`) : il
/// sert aux actions des boutons du PIP — revenir sur Sion, couper le son du
/// partage — sans repasser par le front.
static APP: OnceLock<tauri::AppHandle<crate::TauriRuntime>> = OnceLock::new();

/// Posé par `lib.rs` (setup). Sans lui les boutons restent inertes (la
/// fenêtre, elle, s'affiche quand même).
pub fn set_app_handle(app: tauri::AppHandle<crate::TauriRuntime>) {
    let _ = APP.set(app);
}

/// Préchauffe la boucle du PIP au démarrage. L'appel est volontairement
/// synchrone : la création d'EventLoop (jusqu'à 5 s sur certains backends)
/// doit être payée au lancement, jamais au premier clic utilisateur.
pub fn prewarm() {
    let _ = get_or_start_handle();
}

/// Boutons dessinés dans le coin haut-droit (24 px, 4 px d'écart, marge 8).
const BTN: u32 = 24;
const BTN_GAP: u32 = 4;
const BTN_MARGIN: u32 = 8;

// ── Persistance de la vignette (position + taille, entre sessions) ─────────
//
// Les états en mémoire ne survivent pas à un redémarrage : on écrit un petit
// JSON dans le dossier de données de l'app. Les coordonnées sont `Option`
// pour qu'un fichier absent ou partiel ne se confonde pas avec « 0,0 ».

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct PipSaved {
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    #[serde(default)]
    large: bool,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

#[cfg(not(target_os = "android"))]
fn saved_path() -> Option<std::path::PathBuf> {
    let app = APP.get()?;
    use tauri::Manager;
    Some(app.path().app_data_dir().ok()?.join("pip-state.json"))
}

fn load_saved() -> PipSaved {
    #[cfg(not(target_os = "android"))]
    {
        if let Some(path) = saved_path() {
            if let Ok(text) = std::fs::read_to_string(path) {
                if let Ok(saved) = serde_json::from_str::<PipSaved>(&text) {
                    return saved;
                }
            }
        }
    }
    PipSaved::default()
}

fn save_saved(pos: Option<(i32, i32)>, large: bool, size: Option<(u32, u32)>) {
    #[cfg(not(target_os = "android"))]
    {
        let Some(path) = saved_path() else {
            return;
        };
        let mut current = load_saved();
        if let Some((x, y)) = pos {
            current.x = Some(x);
            current.y = Some(y);
        }
        current.large = large;
        current.width = size.map(|s| s.0);
        current.height = size.map(|s| s.1);
        if let Ok(text) = serde_json::to_string(&current) {
            let _ = std::fs::write(path, text);
        }
    }
    #[cfg(target_os = "android")]
    {
        let _ = (pos, large);
    }
}

/// Colle la position au coin le plus proche du moniteur si elle en est à
/// moins de 48 px : une position restaurée retrouve son coin exact. Le glissé
/// en cours de geste reste géré par le compositeur (KWin) — pas de bagarre.
fn snap_pos_to_corner(
    pos: (i32, i32),
    size: (u32, u32),
    event_loop: &ActiveEventLoop,
) -> (i32, i32) {
    const CORNER_NEAR: i32 = 48;
    let Some(mon) = event_loop
        .primary_monitor()
        .or_else(|| event_loop.available_monitors().next())
    else {
        return pos;
    };
    let ms = mon.size();
    let mp = mon.position();
    let right = mp.x + ms.width as i32 - size.0 as i32;
    let bottom = mp.y + ms.height as i32 - size.1 as i32;
    let near_x = if (pos.0 - mp.x).abs() <= CORNER_NEAR {
        mp.x
    } else if (pos.0 - right).abs() <= CORNER_NEAR {
        right
    } else {
        pos.0
    };
    let near_y = if (pos.1 - mp.y).abs() <= CORNER_NEAR {
        mp.y
    } else if (pos.1 - bottom).abs() <= CORNER_NEAR {
        bottom
    } else {
        pos.1
    };
    (near_x, near_y)
}

/// Coins haut-gauche des trois boutons (retour, son, pointeur).
fn button_rects(w: u32, _h: u32, share_controls: bool) -> ((u32, u32), (u32, u32), (u32, u32)) {
    let mute_x = w.saturating_sub(BTN_MARGIN + BTN);
    let cursor_x = mute_x.saturating_sub(BTN_GAP + BTN);
    let back_x = if share_controls {
        cursor_x.saturating_sub(BTN_GAP + BTN)
    } else {
        mute_x
    };
    (
        (back_x, BTN_MARGIN),
        (mute_x, BTN_MARGIN),
        (cursor_x, BTN_MARGIN),
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PipButton {
    BackToApp,
    ToggleShareAudio,
    ToggleCursor,
}

/// Bouton sous le curseur (position en pixels physiques, comme la fenêtre).
fn hit_button(pos: (f64, f64), w: u32, h: u32, share_controls: bool) -> Option<PipButton> {
    let (back, mute, cursor) = button_rects(w, h, share_controls);
    let inside = |(x, y): (u32, u32)| {
        pos.0 >= x as f64
            && pos.0 < (x + BTN) as f64
            && pos.1 >= y as f64
            && pos.1 < (y + BTN) as f64
    };
    if inside(back) {
        Some(PipButton::BackToApp)
    } else if share_controls && inside(mute) {
        Some(PipButton::ToggleShareAudio)
    } else if share_controls && inside(cursor) {
        Some(PipButton::ToggleCursor)
    } else {
        None
    }
}

/// La fenêtre PIP native est-elle ouverte ? (lue par le front pour l'état
/// des boutons — l'ouverture est pilotée par `pip_native_open`.)
pub fn is_open() -> bool {
    // Un thread mort = plus de fenêtre : l'état ne doit pas mentir après un
    // échec de la boucle winit.
    OPEN.load(Ordering::Acquire)
        && HANDLE
            .get()
            .map(|h| h.thread_alive.load(Ordering::Acquire))
            .unwrap_or(false)
}

fn supports_share_controls(sender: Option<&str>) -> bool {
    !sender.is_some_and(|key| key.starts_with("camera:"))
}

/// La clé du flux distingue la webcam du partage du même participant.
pub fn source() -> Option<String> {
    if !is_open() {
        return None;
    }
    HANDLE.get()?.state.lock().ok()?.sender.clone()
}

/// Démarre le thread de l'event loop au premier usage (idempotent).
fn get_or_start_handle() -> Option<&'static PipHandle> {
    if let Some(h) = HANDLE.get() {
        return Some(h);
    }

    let saved = load_saved();
    let state = Arc::new(Mutex::new(PipState {
        last_pos: saved.x.zip(saved.y),
        // `large` is a runtime preset flag only. A persisted custom size must
        // never be interpreted as the preset after a restart.
        large: false,
        size: saved.width.zip(saved.height),
        normal_size: None,
        ..PipState::default()
    }));
    let thread_alive = Arc::new(AtomicBool::new(true));
    let (proxy_tx, proxy_rx) = std::sync::mpsc::channel::<Option<EventLoopProxy<UserEvent>>>();

    let state_clone = state.clone();
    let alive_clone = thread_alive.clone();
    thread::Builder::new()
        .name("sion-native-pip".into())
        .spawn(move || {
            // `with_any_thread(true)` : l'event loop doit pouvoir vivre hors
            // du thread principal (l'app Tauri l'occupe déjà).
            #[cfg(target_os = "linux")]
            use winit::platform::wayland::EventLoopBuilderExtWayland;
            #[cfg(target_os = "windows")]
            use winit::platform::windows::EventLoopBuilderExtWindows;
            #[cfg(target_os = "linux")]
            use winit::platform::x11::EventLoopBuilderExtX11;

            let mut builder = EventLoop::<UserEvent>::with_user_event();
            #[cfg(target_os = "linux")]
            {
                EventLoopBuilderExtWayland::with_any_thread(&mut builder, true);
                EventLoopBuilderExtX11::with_any_thread(&mut builder, true);
                // X11 (XWayland) forcé : le backend Wayland natif de winit
                // n'honore pas `WindowLevel::AlwaysOnTop` (pas de couche
                // « au-dessus » pour un toplevel ordinaire). Sous XWayland,
                // KWin/Mutter mappent ça sur `_NET_WM_STATE_ABOVE`.
                EventLoopBuilderExtX11::with_x11(&mut builder);
            }
            #[cfg(target_os = "windows")]
            {
                EventLoopBuilderExtWindows::with_any_thread(&mut builder, true);
            }

            let event_loop = match builder.build() {
                Ok(el) => el,
                Err(err) => {
                    log::warn!("[Sion][PIP] winit EventLoop build failed: {err:?}");
                    let _ = proxy_tx.send(None);
                    alive_clone.store(false, Ordering::Release);
                    return;
                }
            };
            let _ = proxy_tx.send(Some(event_loop.create_proxy()));

            let mut app = PipApp::new(state_clone);
            if let Err(err) = event_loop.run_app(&mut app) {
                log::warn!("[Sion][PIP] event loop exited with error: {err:?}");
            }
            alive_clone.store(false, Ordering::Release);
            OPEN.store(false, Ordering::Release);
            log::info!("[Sion][PIP] event loop thread stopped");
        })
        .ok()?;

    let proxy = match proxy_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Some(p)) => p,
        Ok(None) => {
            log::warn!("[Sion][PIP] event loop thread failed to initialise");
            return None;
        }
        Err(err) => {
            log::warn!("[Sion][PIP] timed out waiting for event-loop proxy: {err:?}");
            return None;
        }
    };

    let _ = HANDLE.set(PipHandle {
        state,
        proxy,
        thread_alive,
    });
    HANDLE.get()
}

/// Ouvre (ou bascule vers) la fenêtre PIP pour le partage `sender`.
pub fn open(sender: &str) -> bool {
    open_streams(
        vec![PipSource {
            sender: sender.into(),
            name: String::new(),
        }],
        Some(sender.into()),
    )
}

fn open_streams(streams: Vec<PipSource>, focus: Option<String>) -> bool {
    let Some(handle) = get_or_start_handle() else {
        return false;
    };
    {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        state.configure(streams, focus);
    }
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let sent = handle
        .proxy
        .send_event(UserEvent::Show(Some(ready_tx)))
        .is_ok();
    let ready = sent
        && ready_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or(false);
    if !ready {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        state.configure(vec![], None);
        OPEN.store(false, Ordering::Release);
        let _ = handle.proxy.send_event(UserEvent::Hide);
        log::warn!("[Sion][PIP] ouverture de la surface native échouée");
        return false;
    }
    OPEN.store(true, Ordering::Release);
    emit_pip_state(true);
    log::info!("[Sion][PIP] fenêtre de diffusion native ouverte");
    true
}

/// État du PIP vers le front : la fenêtre peut se fermer elle-même (bouton
/// maison, clic droit, Échap) — le bouton de la vue doit suivre.
fn emit_pip_state(open: bool) {
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit(
            "voice-native-pip",
            serde_json::json!({ "open": open, "sender": source(), "sources": sources() }),
        );
    }
}

/// Relève la fenêtre principale côté X11 : `_NET_ACTIVE_WINDOW` en provenance
/// « pager » (source = 2) — la méthode que le compositeur honore même sans
/// focus — puis un relevé direct dans la pile. Retourne faux si l'app tourne
/// en Wayland natif (opt-out `SION_KEEP_WAYLAND`) ou fenêtre introuvable.
#[cfg(target_os = "linux")]
fn x11_activate_main_window(title_hint: &str) -> bool {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        ClientMessageEvent, ConfigureWindowAux, ConnectionExt, EventMask, StackMode,
    };

    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        return false;
    };
    let root = conn.setup().roots[screen_num].root;

    let net_wm_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom)
        .unwrap_or(0);
    let utf8 = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom)
        .unwrap_or(0);
    if net_wm_name == 0 || utf8 == 0 {
        return false;
    }

    // Parcours de l'arbre : la fenêtre principale est la seule de l'app dont
    // le titre contient « Sion Client » (la vignette PIP a le sien).
    let mut target = None;
    let mut stack = vec![root];
    while let Some(win) = stack.pop() {
        if let Ok(prop) = conn.get_property(false, win, net_wm_name, utf8, 0, 256) {
            if let Ok(reply) = prop.reply() {
                let name = String::from_utf8_lossy(&reply.value);
                if name.contains(title_hint) {
                    target = Some(win);
                    break;
                }
            }
        }
        if let Ok(cookie) = conn.query_tree(win) {
            if let Ok(tree) = cookie.reply() {
                stack.extend(tree.children);
            }
        }
    }

    let Some(win) = target else {
        return false;
    };
    if let Ok(cookie) = conn.intern_atom(false, b"_NET_ACTIVE_WINDOW") {
        if let Ok(reply) = cookie.reply() {
            let event = ClientMessageEvent::new(32, win, reply.atom, [2, 0, 0, 0, 0]);
            let _ = conn.send_event(
                false,
                root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            );
        }
    }
    let _ = conn.configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE));
    let _ = conn.flush();
    true
}

/// Ferme la fenêtre (le thread reste vivant pour une réouverture rapide).
pub fn close() {
    let Some(handle) = HANDLE.get() else {
        return;
    };
    {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        state.configure(vec![], None);
    }
    OPEN.store(false, Ordering::Release);
    let _ = handle.proxy.send_event(UserEvent::Hide);
    emit_pip_state(false);
}

/// Ce partage est-il actuellement affiché dans le PIP ? Le PIP blitte du BGRA
/// en GDI/softbuffer : quand il est ouvert sur ce partage, la pompe doit
/// produire du BGRA pour tout le monde au lieu des plans I420 du renderer EGL.
pub fn wants_frames(sender: &str) -> bool {
    if !is_open() {
        return false;
    }
    HANDLE
        .get()
        .and_then(|handle| handle.state.lock().ok())
        .is_some_and(|state| state.streams.iter().any(|s| s.sender == sender))
}

/// Taille de rendu utile au PIP actuellement visible. Le moteur vidéo combine
/// cette borne avec celles des surfaces intégrées avant de convertir l'I420.
pub fn preferred_frame_bounds(sender: &str) -> Option<(u32, u32)> {
    if !is_open() {
        return None;
    }
    let handle = HANDLE.get()?;
    let state = handle.state.lock().ok()?;
    let index = state.streams.iter().position(|s| s.sender == sender)?;
    let size = state.size.unwrap_or(if state.large {
        (LARGE_W, LARGE_H)
    } else {
        (DEFAULT_W, DEFAULT_H)
    });
    let rect = state.rects(size)[index];
    Some((rect.w.max(1), rect.h.max(1)))
}

/// Une image BGRA de partage vient d'arriver directement du moteur vocal.
pub fn on_bgra_frame(sender: &str, width: u32, height: u32, bgra: &[u8]) {
    let Some(handle) = HANDLE.get() else {
        return;
    };
    let Some(expected) = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
    else {
        return;
    };
    if width == 0 || height == 0 || expected > 4096 * 4096 * 4 || bgra.len() != expected {
        return;
    }
    // Pendant l'ouverture, seule la dernière image est gardée et `paint` ne
    // blitte que si une nouvelle génération est arrivée.
    {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.streams.iter().any(|s| s.sender == sender) {
            return;
        }
        state.generation = state.generation.wrapping_add(1);
        state.frames.insert(
            sender.into(),
            PipFrame {
                width,
                height,
                bgra: Arc::from(bgra),
            },
        );
    }
    let _ = handle.proxy.send_event(UserEvent::Frame);
}

/// Retire seulement le flux terminé ; le dernier ferme la fenêtre.
pub fn on_share_removed(sender: &str) {
    let Some(handle) = HANDLE.get() else {
        return;
    };
    let remaining = {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.streams.iter().any(|s| s.sender == sender) {
            return;
        }
        let streams = state
            .streams
            .iter()
            .filter(|s| s.sender != sender)
            .cloned()
            .collect();
        let focus = Some(state.focus.clone().unwrap_or_default());
        state.configure(streams, focus);
        state.streams.len()
    };
    if remaining == 0 {
        close();
    } else {
        emit_pip_state(true);
        let _ = handle.proxy.send_event(UserEvent::Show(None));
    }
}

pub fn sources() -> Vec<String> {
    if !is_open() {
        return vec![];
    }
    HANDLE
        .get()
        .and_then(|h| h.state.lock().ok())
        .map(|s| s.streams.iter().map(|v| v.sender.clone()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn pip_native_sources() -> Vec<String> {
    sources()
}

#[tauri::command]
pub fn pip_native_open_streams(
    app: tauri::AppHandle<crate::TauriRuntime>,
    streams: Vec<PipSource>,
    focus: Option<String>,
) -> Result<(), String> {
    if streams.is_empty()
        || streams.len() > 128
        || streams
            .iter()
            .any(|s| s.sender.is_empty() || s.sender.len() > 1024 || s.name.chars().count() > 256)
    {
        return Err("sélection de flux invalide".into());
    }
    let mut unique = Vec::with_capacity(streams.len());
    for stream in streams {
        if !unique.iter().any(|s: &PipSource| s.sender == stream.sender) {
            unique.push(stream);
        }
    }
    if !open_streams(unique, focus) {
        return Err("impossible d'ouvrir la diffusion native".into());
    }
    if let Some(sender) = source().filter(|s| supports_share_controls(Some(s))) {
        sync_audio_state(app, sender);
    }
    Ok(())
}

fn sync_audio_state(app: tauri::AppHandle<crate::TauriRuntime>, sender_state: String) {
    #[cfg(feature = "native-voice")]
    let _ = thread::Builder::new()
        .name("sion-pip-audio-state".into())
        .spawn(move || {
            let muted = crate::voice_native::voice_native_get_screenshare_audio_state(
                app,
                sender_state.clone(),
            )
            .map(|s| s.muted)
            .unwrap_or(false);
            if let Some(handle) = HANDLE.get() {
                if let Ok(mut state) = handle.state.lock() {
                    if state.sender.as_deref() == Some(sender_state.as_str()) {
                        state.share_audio_muted = muted;
                        state.generation = state.generation.wrapping_add(1);
                    }
                }
                let _ = handle.proxy.send_event(UserEvent::Show(None));
            }
        });
    #[cfg(not(feature = "native-voice"))]
    let _ = (app, sender_state);
}

// ── Commandes Tauri ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn pip_native_open(
    app: tauri::AppHandle<crate::TauriRuntime>,
    sender: String,
) -> Result<(), String> {
    if sender.is_empty() {
        return Err("identité du partage manquante".into());
    }
    if let Some(handle) = get_or_start_handle() {
        let mut state = handle.state.lock().unwrap_or_else(|e| e.into_inner());
        // Do not query the voice engine before showing the window: its mutex
        // can be held by a video decode/publish operation for seconds. The
        // exact mute state is resynchronised below, asynchronously.
        state.share_audio_muted = false;
    }
    if open(&sender) {
        if supports_share_controls(Some(&sender)) {
            sync_audio_state(app, sender);
        }
        Ok(())
    } else {
        Err("impossible d'ouvrir la fenêtre PIP native".into())
    }
}

#[tauri::command]
pub fn pip_native_close() -> Result<(), String> {
    close();
    Ok(())
}

#[tauri::command]
pub fn pip_native_status() -> bool {
    is_open()
}

#[tauri::command]
pub fn pip_native_source() -> Option<String> {
    source()
}

// ── Rendu ───────────────────────────────────────────────────────────────────

/// Ajuste l'image dans la surface (letterbox noir), écrit en 0x00RRGGBB
/// (XRGB8888, ce qu'attend softbuffer — même convention que le repack de
/// l'overlay de curseurs).
#[cfg(test)]
fn blit_fit(dst: &mut [u32], ww: u32, wh: u32, img: &image::RgbImage) {
    let (iw, ih) = img.dimensions();
    if iw == 0 || ih == 0 || ww == 0 || wh == 0 {
        return;
    }
    let scale = f64::min(ww as f64 / iw as f64, wh as f64 / ih as f64);
    let dw = ((iw as f64 * scale).round() as u32).clamp(1, ww);
    let dh = ((ih as f64 * scale).round() as u32).clamp(1, wh);
    let x0 = (ww - dw) / 2;
    let y0 = (wh - dh) / 2;

    dst.fill(0);
    for dy in 0..dh {
        let sy = ((dy as u64 * ih as u64) / dh as u64) as u32;
        let row = (y0 + dy) as usize * ww as usize;
        for dx in 0..dw {
            let sx = ((dx as u64 * iw as u64) / dw as u64) as u32;
            let p = img.get_pixel(sx, sy);
            let index = row + (x0 + dx) as usize;
            // A resize event can arrive between `inner_size()` and
            // `surface.buffer_mut()`, leaving one frame with the old buffer
            // length. Skip that pixel rather than killing the PIP thread.
            if index < dst.len() {
                dst[index] = ((p[0] as u32) << 16) | ((p[1] as u32) << 8) | p[2] as u32;
            }
        }
    }
}

/// Même ajustement, directement depuis les octets BGRA produits par libyuv.
/// softbuffer attend 0x00RRGGBB : aucun décodeur ni allocation intermédiaire.
#[cfg(test)]
fn blit_fit_bgra(dst: &mut [u32], ww: u32, wh: u32, bgra: &[u8], iw: u32, ih: u32) {
    dst.fill(0);
    blit_tile_bgra(
        dst,
        ww,
        TileRect {
            x: 0,
            y: 0,
            w: ww,
            h: wh,
        },
        bgra,
        iw,
        ih,
    );
}

fn blit_tile_bgra(dst: &mut [u32], stride: u32, rect: TileRect, bgra: &[u8], iw: u32, ih: u32) {
    let (ww, wh) = (rect.w, rect.h);
    if iw == 0 || ih == 0 || ww == 0 || wh == 0 || bgra.len() != iw as usize * ih as usize * 4 {
        return;
    }
    let scale = f64::min(ww as f64 / iw as f64, wh as f64 / ih as f64);
    let dw = ((iw as f64 * scale).round() as u32).clamp(1, ww);
    let dh = ((ih as f64 * scale).round() as u32).clamp(1, wh);
    let x0 = rect.x + (ww - dw) / 2;
    let y0 = rect.y + (wh - dh) / 2;

    for dy in 0..dh {
        let sy = ((dy as u64 * ih as u64) / dh as u64) as usize;
        let row = (y0 + dy) as usize * stride as usize;
        for dx in 0..dw {
            let sx = ((dx as u64 * iw as u64) / dw as u64) as usize;
            let source = (sy * iw as usize + sx) * 4;
            let index = row + (x0 + dx) as usize;
            if index < dst.len() {
                let b = bgra[source] as u32;
                let g = bgra[source + 1] as u32;
                let r = bgra[source + 2] as u32;
                dst[index] = (r << 16) | (g << 8) | b;
            }
        }
    }
}

/// Convertit un point de la fenêtre vers les coordonnées normalisées de
/// l'image réellement visible. Les bandes de letterbox ne font pas partie du
/// partage et ne doivent jamais produire un faux pointeur distant.
fn normalise_content_point(
    point: (f64, f64),
    window: (u32, u32),
    frame: (u32, u32),
) -> Option<(f32, f32)> {
    let (ww, wh) = window;
    let (fw, fh) = frame;
    if ww == 0 || wh == 0 || fw == 0 || fh == 0 {
        return None;
    }
    let scale = f64::min(ww as f64 / fw as f64, wh as f64 / fh as f64);
    let width = fw as f64 * scale;
    let height = fh as f64 * scale;
    let left = (ww as f64 - width) / 2.0;
    let top = (wh as f64 - height) / 2.0;
    if point.0 < left || point.0 >= left + width || point.1 < top || point.1 >= top + height {
        return None;
    }
    Some((
        ((point.0 - left) / width).clamp(0.0, 1.0) as f32,
        ((point.1 - top) / height).clamp(0.0, 1.0) as f32,
    ))
}

struct PipApp {
    state: Arc<Mutex<PipState>>,
    window: Option<Arc<Window>>,
    surface: Option<softbuffer::Surface<Arc<Window>, Arc<Window>>>,
    /// Dernier décodage effectif (throttle).
    last_paint: Instant,
    /// Une image est en attente mais le throttle interdit encore de peindre.
    pending_redraw_at: Option<Instant>,
    /// Nombre de frames peintes (diagnostic).
    painted_count: u64,
    /// Dernière position du curseur (pixels physiques) — cible du clic.
    cursor: (f64, f64),
    /// Son du partage coupé ? (état local, initialisé depuis le moteur à
    /// l'ouverture, basculé par le bouton 🔊/🔇).
    muted: bool,
    /// Horodatage du dernier clic (détection du double-clic → agrandir).
    last_click: Instant,
    last_cursor_tx: Instant,
    last_cursor_activity: Instant,
    cursor_hidden: bool,
}

impl PipApp {
    fn new(state: Arc<Mutex<PipState>>) -> Self {
        Self {
            state,
            window: None,
            surface: None,
            last_paint: Instant::now() - MIN_PAINT_INTERVAL,
            pending_redraw_at: None,
            painted_count: 0,
            cursor: (0.0, 0.0),
            muted: false,
            last_click: Instant::now() - Duration::from_secs(1),
            last_cursor_tx: Instant::now() - Duration::from_secs(1),
            last_cursor_activity: Instant::now(),
            cursor_hidden: true,
        }
    }

    /// Double-clic sur l'image : agrandit / réduit la vignette. La taille est
    /// mémorisée avec la position (fichier d'état) ; si la vignette était
    /// collée au coin bas-droit, elle y reste après le changement de taille.
    fn toggle_large(&mut self) {
        let Some(window) = self.window.as_ref() else {
            return;
        };
        let current = window.inner_size();
        let (large, restore_size) = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let currently_large = state.large;
            let next = !currently_large;
            let restore = state.normal_size;
            state.large = next;
            (next, restore)
        };
        let (w, h) = if large {
            if let Ok(mut state) = self.state.lock() {
                state.normal_size = Some((current.width, current.height));
            }
            (LARGE_W, LARGE_H)
        } else {
            restore_size.unwrap_or((DEFAULT_W, DEFAULT_H))
        };
        if let Ok(mut state) = self.state.lock() {
            state.size = Some((w, h));
            state.painted = 0;
        }
        let _ = window.request_inner_size(PhysicalSize::new(w, h));
        // Keep the current top-left position. Resizing a frameless window
        // must not unexpectedly snap it to a monitor corner.
        let pos = window.outer_position().ok().map(|p| (p.x, p.y));
        let size = window.inner_size();
        save_saved(pos, large, Some((size.width, size.height)));
    }

    fn resize_direction(&self) -> Option<winit::window::ResizeDirection> {
        let size = self.window.as_ref()?.inner_size();
        const EDGE: f64 = 10.0;
        let left = self.cursor.0 <= EDGE;
        let right = self.cursor.0 >= size.width.saturating_sub(EDGE as u32) as f64;
        let top = self.cursor.1 <= EDGE;
        let bottom = self.cursor.1 >= size.height.saturating_sub(EDGE as u32) as f64;
        use winit::window::ResizeDirection as D;
        match (left, right, top, bottom) {
            (true, false, true, false) => Some(D::NorthWest),
            (false, true, true, false) => Some(D::NorthEast),
            (true, false, false, true) => Some(D::SouthWest),
            (false, true, false, true) => Some(D::SouthEast),
            (true, false, false, false) => Some(D::West),
            (false, true, false, false) => Some(D::East),
            (false, false, true, false) => Some(D::North),
            (false, false, false, true) => Some(D::South),
            _ => None,
        }
    }

    fn cursor_enabled(&self) -> bool {
        self.state.lock().map(|s| s.cursor_enabled).unwrap_or(false)
    }

    fn publish_cursor(&mut self) {
        if !self.cursor_enabled() || self.last_cursor_tx.elapsed() < Duration::from_millis(33) {
            return;
        }
        let Some(app) = APP.get().cloned() else {
            return;
        };
        let (sender, width, height, rect) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let Some(sender) = state.sender.clone() else {
                return;
            };
            let (w, h) = state
                .frames
                .get(&sender)
                .map(|f| (f.width, f.height))
                .unwrap_or((1, 1));
            let Some(index) = state.streams.iter().position(|s| s.sender == sender) else {
                return;
            };
            let size = self
                .window
                .as_ref()
                .map(|w| w.inner_size())
                .map(|s| (s.width, s.height))
                .unwrap_or((0, 0));
            (sender, w, h, state.rects(size)[index])
        };
        let Some(status) = Some(crate::voice_native::voice_native_status()) else {
            return;
        };
        let Some(identity) = status.identity else {
            return;
        };
        self.last_cursor_tx = Instant::now();
        self.last_cursor_activity = Instant::now();
        self.cursor_hidden = false;
        let local_point = (self.cursor.0 - rect.x as f64, self.cursor.1 - rect.y as f64);
        let Some((x, y)) = normalise_content_point(local_point, (rect.w, rect.h), (width, height))
        else {
            self.publish_cursor_hide();
            return;
        };
        let _ = thread::Builder::new()
            .name("sion-pip-cursor".into())
            .spawn(move || {
                use base64::Engine as _;
                static INFLIGHT: AtomicBool = AtomicBool::new(false);
                if INFLIGHT.swap(true, Ordering::AcqRel) {
                    return;
                }
                let payload = serde_json::json!({ "x": x, "y": y, "t": sender, "n": identity });
                if let Ok(raw) = serde_json::to_vec(&payload) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
                    let _ = crate::voice_native::voice_native_publish_data(
                        app,
                        crate::voice_native::TOPIC_CURSOR.into(),
                        b64,
                        Some(false),
                    );
                }
                INFLIGHT.store(false, Ordering::Release);
            });
    }

    fn publish_cursor_hide(&mut self) {
        if self.cursor_hidden {
            return;
        }
        self.cursor_hidden = true;
        let Some(app) = APP.get().cloned() else {
            return;
        };
        let Some(target) = self.state.lock().ok().and_then(|s| s.sender.clone()) else {
            return;
        };
        let _ = thread::Builder::new()
            .name("sion-pip-cursor-hide".into())
            .spawn(move || {
                use base64::Engine as _;
                let payload = serde_json::json!({ "expire": true, "t": target });
                if let Ok(raw) = serde_json::to_vec(&payload) {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
                    let _ = crate::voice_native::voice_native_publish_data(
                        app,
                        crate::voice_native::TOPIC_CURSOR.into(),
                        b64,
                        Some(true),
                    );
                }
            });
    }

    fn toggle_cursor(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.cursor_enabled = !state.cursor_enabled;
            state.generation = state.generation.wrapping_add(1);
            if state.cursor_enabled {
                self.last_cursor_activity = Instant::now();
            }
        }
        if !self.cursor_enabled() {
            self.publish_cursor_hide();
        }
        if let Some(window) = self.window.as_ref() {
            window.request_redraw();
        }
    }

    /// Revient sur la fenêtre principale (dé-minimise, montre, focus) et la
    /// relève côté X11 quand l'app y tourne (`SION_FORCE_X11=1`). En Wayland
    /// natif (défaut), la relève inter-processus est refusée par le
    /// compositeur : il ne reste que sa demande d'attention (l'entrée clignote)
    /// — le PIP reste un client X11, il ne peut pas fournir le jeton
    /// d'activation Wayland attendu. Sortie propre : xx-pip-v1, cf. `main.rs`.
    fn focus_main_window(&self) {
        let Some(app) = APP.get() else {
            return;
        };
        use tauri::Manager;
        match app.get_webview_window("main") {
            Some(win) => {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
                #[cfg(target_os = "linux")]
                {
                    let x11_ok = x11_activate_main_window("Sion Client");
                    log::info!(
                        "[Sion][PIP] retour sur la fenêtre principale (relève X11={x11_ok})"
                    );
                }
                #[cfg(not(target_os = "linux"))]
                log::info!("[Sion][PIP] retour sur la fenêtre principale");
            }
            None => log::warn!("[Sion][PIP] fenêtre principale introuvable"),
        }
    }

    /// Bascule le son du partage affiché (même chemin que le bouton 🔊 de la
    /// vue : le moteur reste l'unique propriétaire de l'état). Réponse
    /// visuelle immédiate, appel moteur en tâche de fond — la boucle
    /// d'événements ne doit jamais attendre le moteur (décodage vidéo).
    fn toggle_share_audio(&mut self) {
        let Some(app) = APP.get() else {
            return;
        };
        let sender = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.sender.clone()
        };
        let Some(sender) = sender else { return };
        let wanted = !self.muted;
        self.muted = wanted;
        if let Ok(mut state) = self.state.lock() {
            state.share_audio_muted = wanted;
            state.generation = state.generation.wrapping_add(1);
        }
        if let Some(window) = self.window.as_ref() {
            window.request_redraw();
        }
        let app = app.clone();
        let _ = thread::Builder::new()
            .name("sion-pip-audio-toggle".into())
            .spawn(move || {
                match crate::voice_native::voice_native_set_screenshare_audio_muted(
                    app, sender, wanted,
                ) {
                    Ok(_) => log::info!(
                        "[Sion][PIP] son du partage {}",
                        if wanted { "coupé" } else { "rétabli" }
                    ),
                    Err(err) => log::warn!("[Sion][PIP] bascule du son refusée: {err}"),
                }
            });
    }

    fn build_window(&self, event_loop: &ActiveEventLoop) -> Option<Arc<Window>> {
        let (mut w, mut h, pos_default) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((saved_w, saved_h)) = state.size {
                (saved_w, saved_h, state.last_pos)
            } else if state.large {
                (LARGE_W, LARGE_H, state.last_pos)
            } else {
                (DEFAULT_W, DEFAULT_H, state.last_pos)
            }
        };
        let _ = &mut w;
        let _ = &mut h;

        // Position : dernière position mémorisée, sinon bas-droite du moniteur
        // principal (convention des lecteurs PIP du système).
        let raw_pos = pos_default.unwrap_or_else(|| {
            let mon = event_loop
                .primary_monitor()
                .or_else(|| event_loop.available_monitors().next());
            match mon {
                Some(m) => {
                    let ms = m.size();
                    let mp = m.position();
                    (
                        mp.x + ms.width as i32 - w as i32 - MARGIN,
                        mp.y + ms.height as i32 - h as i32 - MARGIN,
                    )
                }
                None => (100, 100),
            }
        });
        // Coin d'ancrage : une position restaurée proche d'un coin s'y colle.
        let pos = snap_pos_to_corner(raw_pos, (w, h), event_loop);

        let attrs = WindowAttributes::default()
            .with_title("Sion — PIP partage")
            .with_decorations(false)
            .with_resizable(true)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_inner_size(PhysicalSize::new(w, h))
            .with_position(PhysicalPosition::new(pos.0, pos.1));

        let window = match event_loop.create_window(attrs) {
            Ok(win) => Arc::new(win),
            Err(err) => {
                log::warn!("[Sion][PIP] create_window failed: {err:?}");
                return None;
            }
        };
        // Keep manual resizing useful without allowing a 4K software blit to
        // monopolise the PIP thread and make the video appear to stutter.
        window.set_min_inner_size(Some(PhysicalSize::new(240, 135)));
        window.set_max_inner_size(Some(PhysicalSize::new(1920, 1080)));
        Some(window)
    }

    /// Décode la dernière image non peinte et blitte. Silencieux si rien de
    /// neuf (le throttle comme la source en pause arrivent ici).
    fn paint(&mut self) {
        let (Some(window), Some(surface)) = (self.window.as_ref(), self.surface.as_mut()) else {
            return;
        };
        self.last_paint = Instant::now();
        self.pending_redraw_at = None;
        let size = window.inner_size();
        let (generation, streams, rects, frames, muted, cursor, share_controls) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.generation == state.painted {
                return;
            }
            (
                state.generation,
                state.streams.clone(),
                state.rects((size.width, size.height)),
                state.frames.clone(),
                state.share_audio_muted,
                state.cursor_enabled,
                supports_share_controls(state.sender.as_deref()),
            )
        };
        let Ok(mut buffer) = surface.buffer_mut() else {
            return;
        };
        buffer.fill(0x0015191F);
        for (stream, rect) in streams.iter().zip(rects) {
            if let Some(frame) = frames.get(&stream.sender) {
                blit_tile_bgra(
                    &mut buffer,
                    size.width,
                    rect,
                    &frame.bgra,
                    frame.width,
                    frame.height,
                );
            }
            draw_stream_label(&mut buffer, size.width, size.height, rect, &stream.name);
        }
        draw_controls(
            &mut buffer,
            size.width,
            size.height,
            muted,
            cursor,
            share_controls,
        );
        let _ = buffer.present();
        if let Ok(mut state) = self.state.lock() {
            state.painted = generation;
        }
        self.painted_count = self.painted_count.wrapping_add(1);
    }

    fn hide(&mut self) {
        if let Some(window) = self.window.as_ref() {
            if let Ok(pos) = window.outer_position() {
                let (large, pos) = {
                    let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                    state.last_pos = Some((pos.x, pos.y));
                    (state.large, (pos.x, pos.y))
                };
                // Persistée sur disque : la vignette retrouve sa place et sa
                // taille au prochain lancement de l'app.
                let size = window.inner_size();
                save_saved(Some(pos), large, Some((size.width, size.height)));
            }
            window.set_visible(false);
        }
    }
}

impl ApplicationHandler<UserEvent> for PipApp {
    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Show(reply) => {
                let ready = (|| {
                    if self.window.is_none() {
                        let Some(window) = self.build_window(event_loop) else {
                            return false;
                        };
                        let context = match softbuffer::Context::new(window.clone()) {
                            Ok(c) => c,
                            Err(err) => {
                                log::warn!("[Sion][PIP] softbuffer context failed: {err:?}");
                                return false;
                            }
                        };
                        let mut surface = match softbuffer::Surface::new(&context, window.clone()) {
                            Ok(s) => s,
                            Err(err) => {
                                log::warn!("[Sion][PIP] softbuffer surface failed: {err:?}");
                                return false;
                            }
                        };
                        let size = window.inner_size();
                        if let (Ok(w), Ok(h)) = (
                            std::num::NonZeroU32::try_from(size.width),
                            std::num::NonZeroU32::try_from(size.height),
                        ) {
                            let _ = surface.resize(w, h);
                        }
                        self.window = Some(window.clone());
                        self.surface = Some(surface);
                    }
                    let Some(window) = self.window.as_ref() else {
                        return false;
                    };
                    // État du bouton 🔊 : renseigné par `pip_native_open` —
                    // aucun appel moteur sur ce fil (il attendait le verrou du
                    // moteur et retardait l'affichage de la fenêtre).
                    self.muted = {
                        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                        state.share_audio_muted
                    };
                    window.set_title("Sion — Diffusion");
                    window.set_visible(true);
                    window.request_redraw();
                    true
                })();
                if let Some(reply) = reply {
                    let _ = reply.send(ready);
                }
                if !ready {
                    OPEN.store(false, Ordering::Release);
                    emit_pip_state(false);
                }
            }
            UserEvent::Hide => self.hide(),
            UserEvent::Frame => {
                let Some(window) = self.window.as_ref() else {
                    return;
                };
                if self.last_paint.elapsed() >= MIN_PAINT_INTERVAL {
                    window.request_redraw();
                } else {
                    // Trop tôt : on repassera au prochain tour — la dernière
                    // image sera peinte, pas une vieille.
                    self.pending_redraw_at = Some(self.last_paint + MIN_PAINT_INTERVAL);
                    event_loop.set_control_flow(ControlFlow::WaitUntil(
                        self.last_paint + MIN_PAINT_INTERVAL,
                    ));
                }
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::RedrawRequested => self.paint(),
            WindowEvent::Resized(size) => {
                // A new surface buffer starts blank even if the last frame's
                // generation is unchanged. Force one repaint after every
                // resize (double-click preset or edge drag).
                if let Ok(mut state) = self.state.lock() {
                    state.painted = 0;
                    state.size = Some((size.width, size.height));
                    if state.large && (size.width, size.height) != (LARGE_W, LARGE_H) {
                        // A user drag leaves preset mode and becomes the new
                        // normal size for the next double-click restore.
                        state.large = false;
                        state.normal_size = Some((size.width, size.height));
                    }
                }
                if let Some(surface) = self.surface.as_mut() {
                    if let (Ok(w), Ok(h)) = (
                        std::num::NonZeroU32::try_from(size.width),
                        std::num::NonZeroU32::try_from(size.height),
                    ) {
                        let _ = surface.resize(w, h);
                    }
                }
                if let Some(window) = self.window.as_ref() {
                    window.request_redraw();
                }
            }
            WindowEvent::CloseRequested => {
                close();
                event_loop.set_control_flow(ControlFlow::Wait);
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = (position.x, position.y);
                let icon = self
                    .resize_direction()
                    .map(winit::window::CursorIcon::from)
                    .unwrap_or(winit::window::CursorIcon::Default);
                if let Some(window) = self.window.as_ref() {
                    window.set_cursor(icon);
                }
                self.publish_cursor();
                if self.cursor_enabled()
                    && self.last_cursor_activity.elapsed() >= Duration::from_secs(5)
                {
                    self.publish_cursor_hide();
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => {
                // Boutons dessinés (haut-droite) : le clic agit — maison =
                // revenir sur Sion, haut-parleur = son du partage. Ailleurs,
                // fenêtre sans décoration → on déplace en glissant.
                if let Some(size) = self.window.as_ref().map(|w| w.inner_size()) {
                    let share_controls = self
                        .state
                        .lock()
                        .map(|s| supports_share_controls(s.sender.as_deref()))
                        .unwrap_or(false);
                    match hit_button(self.cursor, size.width, size.height, share_controls) {
                        Some(PipButton::BackToApp) => {
                            // Comme le PIP de Firefox : on rend la main à
                            // l'application et la vignette se referme.
                            self.focus_main_window();
                            close();
                            return;
                        }
                        Some(PipButton::ToggleShareAudio) => {
                            self.toggle_share_audio();
                            return;
                        }
                        Some(PipButton::ToggleCursor) => {
                            self.toggle_cursor();
                            return;
                        }
                        None => {
                            if let Some(direction) = self.resize_direction() {
                                if let Some(window) = self.window.as_ref() {
                                    if let Err(err) = window.drag_resize_window(direction) {
                                        log::debug!(
                                            "[Sion][PIP] drag_resize_window indisponible: {err:?}"
                                        );
                                    }
                                }
                                return;
                            }
                            // Double-clic sur l'image : agrandir / réduire
                            // (comme les lecteurs PIP du système).
                            let now = Instant::now();
                            if now.duration_since(self.last_click) < Duration::from_millis(400) {
                                self.last_click = now - Duration::from_secs(1);
                                self.publish_cursor_hide();
                                let changed = {
                                    let mut state =
                                        self.state.lock().unwrap_or_else(|e| e.into_inner());
                                    let rects = state.rects((size.width, size.height));
                                    let hit = rects.iter().position(|r| {
                                        self.cursor.0 >= r.x as f64
                                            && self.cursor.0 < (r.x + r.w) as f64
                                            && self.cursor.1 >= r.y as f64
                                            && self.cursor.1 < (r.y + r.h) as f64
                                    });
                                    if let Some(index) = hit {
                                        let key = state.streams[index].sender.clone();
                                        if state.focus.as_deref() != Some(&key)
                                            && state.streams.len() > 1
                                        {
                                            let streams = state.streams.clone();
                                            state.configure(streams, Some(key));
                                            true
                                        } else {
                                            false
                                        }
                                    } else {
                                        false
                                    }
                                };
                                if changed {
                                    emit_pip_state(true);
                                    if let (Some(app), Some(sender)) = (
                                        APP.get(),
                                        source().filter(|s| supports_share_controls(Some(s))),
                                    ) {
                                        sync_audio_state(app.clone(), sender);
                                    }
                                    if let Some(window) = self.window.as_ref() {
                                        window.request_redraw();
                                    }
                                } else {
                                    self.toggle_large();
                                }
                                return;
                            }
                            self.last_click = now;
                        }
                    }
                }
                if let Some(window) = self.window.as_ref() {
                    if let Err(err) = window.drag_window() {
                        log::debug!("[Sion][PIP] drag_window indisponible: {err:?}");
                    }
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Right,
                ..
            } => {
                close();
            }
            WindowEvent::CursorLeft { .. } => self.publish_cursor_hide(),
            WindowEvent::KeyboardInput { event: key, .. } => {
                use winit::keyboard::{Key, NamedKey};
                let is_escape = key.state == ElementState::Pressed
                    && matches!(key.logical_key, Key::Named(NamedKey::Escape));
                if is_escape {
                    close();
                }
            }
            WindowEvent::Destroyed => {
                self.window = None;
                self.surface = None;
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        // CursorMoved is not emitted while the pointer is still. Wake
        // periodically so the five-second inactivity timeout can fire even
        // when the PIP remains focused and unchanged.
        if self.cursor_enabled() && self.last_cursor_activity.elapsed() >= Duration::from_secs(5) {
            self.publish_cursor_hide();
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(250),
        ));
        if let Some(at) = self.pending_redraw_at.take() {
            let now = Instant::now();
            if now >= at {
                if let Some(window) = self.window.as_ref() {
                    window.request_redraw();
                }
            } else {
                self.pending_redraw_at = Some(at);
            }
        }
    }
}

fn draw_stream_label(buf: &mut [u32], w: u32, h: u32, rect: TileRect, name: &str) {
    if name.is_empty() || rect.h < 24 || rect.w < 40 {
        return;
    }
    static FONT: OnceLock<Option<FontRef<'static>>> = OnceLock::new();
    let Some(font) = FONT.get_or_init(|| {
        FontRef::try_from_slice(include_bytes!("../assets/DejaVuSans-Bold.ttf")).ok()
    }) else {
        return;
    };
    let scaled = font.as_scaled(PxScale::from(16.0));
    let mut pen = rect.x as f32 + 6.0;
    let baseline = (rect.y + rect.h - 7) as f32;
    for y in rect.y + rect.h - 22..rect.y + rect.h {
        for x in rect.x..rect.x + rect.w {
            darken(buf, w, h, x, y);
        }
    }
    for ch in name.chars().take(64) {
        let id = scaled.glyph_id(ch);
        let advance = scaled.h_advance(id);
        if pen + advance > (rect.x + rect.w - 5) as f32 {
            break;
        }
        let glyph = id.with_scale_and_position(PxScale::from(16.0), ab_glyph::point(pen, baseline));
        if let Some(outline) = font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|x, y, alpha| {
                let x = bounds.min.x as i32 + x as i32;
                let y = bounds.min.y as i32 + y as i32;
                if x < rect.x as i32
                    || y < rect.y as i32
                    || x >= (rect.x + rect.w) as i32
                    || y >= (rect.y + rect.h) as i32
                {
                    return;
                }
                let index = y as usize * w as usize + x as usize;
                if let Some(pixel) = buf.get_mut(index) {
                    let a = (alpha * 255.0) as u32;
                    let channel = |shift: u32| {
                        let old = (*pixel >> shift) & 255u32;
                        (255 * a + old * (255 - a)) / 255
                    };
                    *pixel = (channel(16) << 16) | (channel(8) << 8) | channel(0);
                }
            });
        }
        pen += advance;
    }
}

// ── Boutons dessinés (retour à Sion, son du partage) ───────────────────────
//
// La fenêtre n'embarque pas de fonte : les affordances sont dessinées en
// rectangles (fond assombri + glyphes blancs). Même géométrie que
// `hit_button` — une seule source de vérité pour le dessin et le clic.

fn put(buf: &mut [u32], w: u32, h: u32, x: u32, y: u32, color: u32) {
    if x < w && y < h {
        if let Some(pixel) = buf.get_mut((y * w + x) as usize) {
            *pixel = color;
        }
    }
}

fn darken(buf: &mut [u32], w: u32, h: u32, x: u32, y: u32) {
    if x < w && y < h {
        if let Some(pixel) = buf.get_mut((y * w + x) as usize) {
            *pixel = (*pixel >> 1) & 0x007F7F7F;
        }
    }
}

fn draw_button(
    buf: &mut [u32],
    w: u32,
    h: u32,
    (bx, by): (u32, u32),
    glyph: impl Fn(&mut [u32], u32, u32, u32, u32),
) {
    for y in by..by + BTN {
        for x in bx..bx + BTN {
            darken(buf, w, h, x, y);
        }
    }
    let border = 0x00D0D0D0;
    for x in bx..bx + BTN {
        put(buf, w, h, x, by, border);
        put(buf, w, h, x, by + BTN - 1, border);
    }
    for y in by..by + BTN {
        put(buf, w, h, bx, y, border);
        put(buf, w, h, bx + BTN - 1, y, border);
    }
    glyph(buf, w, h, bx, by);
}

/// Maison — revenir sur Sion (le bouton gauche).
fn house_glyph(buf: &mut [u32], w: u32, h: u32, bx: u32, by: u32) {
    let white = 0x00FFFFFF;
    for i in 0..6u32 {
        for x in (11 - i)..=(12 + i) {
            put(buf, w, h, bx + x, by + 5 + i, white);
        }
    }
    for y in 10..19u32 {
        for x in 7..17u32 {
            put(buf, w, h, bx + x, by + y, white);
        }
    }
    // Porte : réassombrie (le fond du bouton réapparaît).
    for y in 13..19u32 {
        for x in 10..14u32 {
            darken(buf, w, h, bx + x, by + y);
        }
    }
}

/// Haut-parleur — son du partage (barre oblique quand il est coupé).
fn speaker_glyph(buf: &mut [u32], w: u32, h: u32, bx: u32, by: u32, muted: bool) {
    let white = 0x00FFFFFF;
    for y in 9..15u32 {
        for x in 6..10u32 {
            put(buf, w, h, bx + x, by + y, white);
        }
    }
    for i in 0..5u32 {
        for y in (9 - i)..(15 + i) {
            put(buf, w, h, bx + 10 + i, by + y, white);
        }
    }
    if muted {
        for i in 0..15u32 {
            put(buf, w, h, bx + 5 + i, by + 4 + i, white);
            put(buf, w, h, bx + 5 + i, by + 5 + i, white);
        }
    } else {
        for y in 9..15u32 {
            put(buf, w, h, bx + 16, by + y, white);
        }
        for y in 7..17u32 {
            put(buf, w, h, bx + 18, by + y, white);
        }
    }
}

/// Peint les deux boutons par-dessus l'image déjà blittée.
fn draw_controls(
    buf: &mut [u32],
    w: u32,
    h: u32,
    muted: bool,
    cursor_enabled: bool,
    share_controls: bool,
) {
    let (back, mute, cursor) = button_rects(w, h, share_controls);
    draw_button(buf, w, h, back, house_glyph);
    if !share_controls {
        return;
    }
    draw_button(buf, w, h, mute, |b, ww, hh, x, y| {
        speaker_glyph(b, ww, hh, x, y, muted)
    });
    draw_button(buf, w, h, cursor, |b, ww, hh, x, y| {
        cursor_glyph(b, ww, hh, x, y, cursor_enabled)
    });
}

fn cursor_glyph(buf: &mut [u32], w: u32, h: u32, bx: u32, by: u32, enabled: bool) {
    let white = if enabled { 0x00FFFFFF } else { 0x00808080 };
    for i in 0..12u32 {
        put(buf, w, h, bx + 6 + i.min(7), by + 5 + i, white);
        if i < 8 {
            put(buf, w, h, bx + 6 + i, by + 5 + i, white);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Géométrie des boutons : le dessin et le clic doivent tomber sur les
    /// mêmes zones (source de vérité unique).
    #[test]
    fn boutons_du_pip_dans_le_coin() {
        let (back, mute, cursor) = button_rects(480, 270, true);
        assert_eq!(mute, (480 - BTN_MARGIN - BTN, BTN_MARGIN));
        assert_eq!(back, (cursor.0 - BTN_GAP - BTN, BTN_MARGIN));
        // Centres des boutons → la bonne action ; le milieu de l'image → rien.
        let center =
            |(x, y): (u32, u32)| (x as f64 + BTN as f64 / 2.0, y as f64 + BTN as f64 / 2.0);
        assert_eq!(
            hit_button(center(back), 480, 270, true),
            Some(PipButton::BackToApp)
        );
        assert_eq!(
            hit_button(center(mute), 480, 270, true),
            Some(PipButton::ToggleShareAudio)
        );
        assert_eq!(
            hit_button(center(cursor), 480, 270, true),
            Some(PipButton::ToggleCursor)
        );
        assert_eq!(hit_button((240.0, 135.0), 480, 270, true), None);
        // Hors zone (coin opposé) → aucun bouton.
        assert_eq!(hit_button((5.0, 5.0), 480, 270, true), None);
    }

    #[test]
    fn webcam_sans_commandes_de_son_du_partage_ni_pointeur() {
        assert!(!supports_share_controls(Some(
            "camera:@alice:example.org:PC"
        )));
        assert!(!supports_share_controls(Some("camera:local-preview")));
        assert!(supports_share_controls(Some("@alice:example.org:PC")));
        let (back, _, cursor) = button_rects(480, 270, false);
        assert_eq!(back.0, 480 - BTN_MARGIN - BTN);
        assert_eq!(
            hit_button(
                (back.0 as f64 + 12.0, back.1 as f64 + 12.0),
                480,
                270,
                false
            ),
            Some(PipButton::BackToApp)
        );
        assert_eq!(
            hit_button(
                (cursor.0 as f64 + 12.0, cursor.1 as f64 + 12.0),
                480,
                270,
                false
            ),
            None
        );
    }

    /// Test fenêtré (opt-in) : vérifie que l'event loop winit se construit
    /// réellement dans son thread — c'est le point de panne silencieux du
    /// PIP natif (échec = `open` renvoie false, aucune fenêtre). Lancer avec
    /// `SION_PIP_WINDOW_TEST=1` : une fenêtre PIP apparaît ~1,5 s.
    #[test]
    fn fenetre_native_souvre_et_se_ferme() {
        if std::env::var("SION_PIP_WINDOW_TEST").is_err() {
            eprintln!("ignoré (fenêtré) : SION_PIP_WINDOW_TEST=1 pour l'exécuter");
            return;
        }
        assert!(
            open("@test:sion"),
            "open() a échoué — event loop winit en thread ?"
        );
        assert!(is_open(), "la fenêtre devrait être marquée ouverte");
        let red_bgra = [0u8, 0, 255, 255].repeat(320 * 180);
        on_bgra_frame("@test:sion", 320, 180, &red_bgra);
        std::thread::sleep(std::time::Duration::from_millis(1500));
        close();
        assert!(!is_open(), "la fenêtre devrait être fermée");
        assert!(source().is_none());
        assert!(open("camera:@test:sion"));
        assert_eq!(source().as_deref(), Some("camera:@test:sion"));
        assert!(wants_frames("camera:@test:sion"));
        assert!(!wants_frames("@test:sion"));
        on_bgra_frame("camera:@test:sion", 320, 180, &red_bgra);
        std::thread::sleep(std::time::Duration::from_millis(500));
        on_share_removed("@test:sion");
        assert!(is_open(), "la fin du partage ne ferme pas la webcam");
        on_share_removed("camera:@test:sion");
        assert!(!is_open(), "la fin de la webcam ferme son PIP");
        assert!(open_streams(
            vec![
                PipSource {
                    sender: "@test:sion".into(),
                    name: "Partage".into()
                },
                PipSource {
                    sender: "camera:@test:sion".into(),
                    name: "Alice".into()
                },
                PipSource {
                    sender: "camera:@bob:sion".into(),
                    name: "Bob".into()
                },
            ],
            None
        ));
        on_bgra_frame("@test:sion", 320, 180, &red_bgra);
        let blue = [255u8, 0, 0, 255].repeat(320 * 180);
        on_bgra_frame("camera:@test:sion", 320, 180, &blue);
        on_bgra_frame("camera:@bob:sion", 320, 180, &blue);
        std::thread::sleep(Duration::from_millis(700));
        assert_eq!(sources().len(), 3);
        assert!(wants_frames("@test:sion") && wants_frames("camera:@test:sion"));
        on_share_removed("@test:sion");
        assert!(is_open());
        assert_eq!(sources().len(), 2);
        on_share_removed("camera:@test:sion");
        assert!(is_open());
        on_share_removed("camera:@bob:sion");
        assert!(!is_open());
    }

    #[test]
    fn selection_conserve_seulement_les_frames_utiles_et_separe_camera_et_partage() {
        let camera = PipSource {
            sender: "camera:@alice:sion".into(),
            name: "Alice".into(),
        };
        let screen = PipSource {
            sender: "@alice:sion".into(),
            name: "Écran".into(),
        };
        let mut state = PipState::default();
        state.configure(vec![camera.clone(), screen.clone()], None);
        assert_eq!(state.focus, Some(screen.sender.clone()));
        let frame = PipFrame {
            width: 1,
            height: 1,
            bgra: Arc::from([0u8, 0, 255, 255]),
        };
        state.frames.insert(camera.sender.clone(), frame.clone());
        state.frames.insert(screen.sender.clone(), frame);
        let before = state.frames[&camera.sender].bgra.clone();
        state.configure(vec![camera.clone()], None);
        assert_eq!(state.frames.len(), 1);
        assert!(Arc::ptr_eq(&before, &state.frames[&camera.sender].bgra));
        state.configure(vec![], None);
        assert!(state.frames.is_empty());
        assert!(state.sender.is_none());
    }

    #[test]
    fn disposition_groupee_reste_dans_la_fenetre_sans_chevauchement() {
        for size in [(480, 270), (270, 480), (1920, 1080)] {
            for count in [1, 2, 3, 9, 32, 128] {
                for focus in [None, Some(0), Some(count - 1)] {
                    let rects = tile_rects(count, focus, size);
                    assert_eq!(rects.len(), count);
                    for (i, a) in rects.iter().enumerate() {
                        assert!(a.w > 0 && a.h > 0);
                        assert!(a.x + a.w <= size.0 && a.y + a.h <= size.1);
                        for b in &rects[i + 1..] {
                            assert!(
                                a.x + a.w <= b.x
                                    || b.x + b.w <= a.x
                                    || a.y + a.h <= b.y
                                    || b.y + b.h <= a.y
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn compositor_deux_flux_ne_peint_pas_sur_la_tuile_voisine() {
        let mut dst = vec![0x0015191F; 8];
        blit_tile_bgra(
            &mut dst,
            4,
            TileRect {
                x: 0,
                y: 0,
                w: 2,
                h: 2,
            },
            &[0, 0, 255, 255],
            1,
            1,
        );
        blit_tile_bgra(
            &mut dst,
            4,
            TileRect {
                x: 2,
                y: 0,
                w: 2,
                h: 2,
            },
            &[255, 0, 0, 255],
            1,
            1,
        );
        assert_eq!(
            dst,
            vec![
                0x00FF0000, 0x00FF0000, 0x000000FF, 0x000000FF, 0x00FF0000, 0x00FF0000, 0x000000FF,
                0x000000FF
            ]
        );
    }

    #[test]
    fn blit_ajuste_en_conservant_le_ratio() {
        // Source 4:2 dans une surface 2:2 → bandes noires à gauche/droite.
        let img = image::RgbImage::from_pixel(4, 2, image::Rgb([255, 0, 0]));
        let mut dst = vec![0xFFFFFFFFu32; 2 * 2];
        blit_fit(&mut dst, 2, 2, &img);
        // 2x2 rendu centré : deux colonnes rouges, rien de blanc.
        assert_eq!(dst[0], 0x00FF0000);
        assert_eq!(dst[1], 0x00FF0000);
        assert!(dst.iter().all(|&p| p != 0x00FFFFFF));
    }

    #[test]
    fn blit_remplit_toute_la_surface_quand_les_ratios_correspondent() {
        let img = image::RgbImage::from_pixel(2, 1, image::Rgb([0, 255, 0]));
        let mut dst = vec![0u32; 4 * 2];
        blit_fit(&mut dst, 4, 2, &img);
        assert!(dst.iter().all(|&p| p == 0x0000FF00));
    }

    #[test]
    fn blit_bgra_direct_conserve_les_canaux() {
        // Deux pixels BGRA : rouge puis bleu, agrandis sans conversion JPEG.
        let bgra = [0, 0, 255, 255, 255, 0, 0, 255];
        let mut dst = vec![0u32; 8];
        blit_fit_bgra(&mut dst, 4, 2, &bgra, 2, 1);
        let row = [0x00FF0000, 0x00FF0000, 0x000000FF, 0x000000FF];
        assert_eq!(&dst[..4], &row);
        assert_eq!(&dst[4..], &row);
    }

    #[test]
    fn pointeur_pip_ignore_les_bandes_de_letterbox() {
        // Source 2:1 dans une fenêtre carrée : image entre y=50 et y=150.
        assert_eq!(
            normalise_content_point((100.0, 100.0), (200, 200), (400, 200)),
            Some((0.5, 0.5))
        );
        assert_eq!(
            normalise_content_point((100.0, 25.0), (200, 200), (400, 200)),
            None
        );
    }
}
