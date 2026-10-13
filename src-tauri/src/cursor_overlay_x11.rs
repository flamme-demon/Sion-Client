//! Native X11 cursor overlay using x11rb and MIT-SHM.
//!
//! The PIP already owns winit's only EventLoop, so the overlay uses a separate
//! X11 connection. It creates a transparent, undecorated ARGB window with
//! above/sticky hints and an empty SHAPE input region.
//!
//! MIT-SHM lets X read shared pixels without copying through the socket;
//! put_image is the fallback. Shared drawing comes from the parent module.
//! Animate clicks around 30 Hz and otherwise sleep until cursor expiry.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tiny_skia::Pixmap;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::randr::{self, ConnectionExt as _};
use x11rb::protocol::shape::{self, ConnectionExt as _};
use x11rb::protocol::shm::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{
    self, AtomEnum, ClientMessageEvent, ColormapAlloc, ConnectionExt as _, CreateGCAux,
    CreateWindowAux, EventMask, ImageFormat, PropMode, VisualClass, Window, WindowClass,
};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

use super::{OverlayState, UserEvent};

/// Click animation interval.
const ANIMATE_STEP: Duration = Duration::from_millis(33);
/// Maximum sleep before polling X events such as Expose and ConfigureNotify.
const POLL_CAP: Duration = Duration::from_millis(100);

/// Start the X11 thread; the returned channel accepts Show and Hide.
pub(super) fn start(
    state: Arc<Mutex<OverlayState>>,
    thread_alive: Arc<AtomicBool>,
) -> Option<Sender<UserEvent>> {
    let (tx, rx) = std::sync::mpsc::channel::<UserEvent>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();

    thread::Builder::new()
        .name("sion-cursor-overlay".into())
        .spawn(move || {
            let mut host = match Host::connect() {
                Ok(h) => h,
                Err(err) => {
                    log::warn!("[Sion][CursorOverlay] X11 connect failed: {err:?}");
                    let _ = ready_tx.send(false);
                    thread_alive.store(false, Ordering::Release);
                    return;
                }
            };
            let _ = ready_tx.send(true);
            host.run(&state, rx);
            thread_alive.store(false, Ordering::Release);
            log::info!("[Sion][CursorOverlay] event loop thread stopped");
        })
        .ok()?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(true) => Some(tx),
        Ok(false) => None,
        Err(err) => {
            log::warn!("[Sion][CursorOverlay] timed out waiting for the X11 thread: {err:?}");
            None
        }
    }
}

/// Attached shared-memory segments read by the X server.
struct Shm {
    seg: shm::Seg,
    size: usize,
    ptr: *mut u8,
}

struct Win {
    id: Window,
    gc: u32,
    cmap: u32,
    w: u16,
    h: u16,
}

struct Atoms {
    utf8_string: u32,
    net_wm_name: u32,
    net_wm_state: u32,
    net_wm_state_above: u32,
    net_wm_state_sticky: u32,
    net_wm_desktop: u32,
    net_wm_window_type: u32,
    net_wm_window_type_utility: u32,
    motif_wm_hints: u32,
    /// Private property used to acknowledge SHM consumption.
    overlay_sync: u32,
}

struct Host {
    conn: RustConnection,
    root: Window,
    depth: u8,
    visual: u32,
    atoms: Atoms,
    /// Primary monitor geometry (x, y, width, height).
    mon: (i16, i16, u16, u16),
    win: Option<Win>,
    shm: Option<Shm>,
    pixmap: Option<Pixmap>,
    /// Fallback buffer when MIT-SHM is unavailable.
    wire: Vec<u32>,
    /// Reuse SHM only after a PropertyNotify acknowledges consumption of the
    /// previous frame. This event-driven fence avoids blocking on GetInputFocus.
    sync_pending: bool,
    sync_done: bool,
    sync_counter: u32,
    /// Check the first blit for asynchronous X errors; avoid a round trip on
    /// every subsequent frame.
    first_present_checked: bool,
    /// Log the first frame containing drawn pixels once.
    logged_content: bool,
    /// Log the first frame containing a cursor or ripple once.
    logged_cursor_frame: bool,
    frame_counter: u64,
    redraw_ms_total: u64,
    redraw_count: u64,
    need_redraw: bool,
    redraw_at: Option<Instant>,
    /// Number of consecutive batches of 64 drained X events.
    floods: usize,
    /// Fallback X screen dimensions and a geometry-change flag. Disabled
    /// outputs can report 0x0, so window creation must wait for valid geometry.
    screen_wh: (u16, u16),
    geometry_dirty: bool,
    /// Remember a Show request so the window can be recreated when the display returns.
    open_requested: bool,
}

impl Host {
    fn connect() -> Result<Self, Box<dyn std::error::Error>> {
        let (conn, screen_num) = x11rb::connect(None)?;
        let screen = conn.setup().roots[screen_num].clone();
        let root = screen.root;

        // Select a 32-bit ARGB visual for a transparent background.
        let (visual, depth) = screen
            .allowed_depths
            .iter()
            .filter(|d| d.depth == 32)
            .find_map(|d| {
                d.visuals
                    .iter()
                    .find(|v| v.class == VisualClass::TRUE_COLOR)
                    .map(|v| (v.visual_id, d.depth))
            })
            .ok_or("aucun visual 32 bits ARGB sur cet écran")?;

        let mon = primary_monitor(&conn, root).unwrap_or((
            0,
            0,
            screen.width_in_pixels,
            screen.height_in_pixels,
        ));

        let atoms = Atoms {
            utf8_string: intern(&conn, b"UTF8_STRING")?,
            net_wm_name: intern(&conn, b"_NET_WM_NAME")?,
            net_wm_state: intern(&conn, b"_NET_WM_STATE")?,
            net_wm_state_above: intern(&conn, b"_NET_WM_STATE_ABOVE")?,
            net_wm_state_sticky: intern(&conn, b"_NET_WM_STATE_STICKY")?,
            net_wm_desktop: intern(&conn, b"_NET_WM_DESKTOP")?,
            net_wm_window_type: intern(&conn, b"_NET_WM_WINDOW_TYPE")?,
            net_wm_window_type_utility: intern(&conn, b"_NET_WM_WINDOW_TYPE_UTILITY")?,
            motif_wm_hints: intern(&conn, b"_MOTIF_WM_HINTS")?,
            overlay_sync: intern(&conn, b"_SION_OVERLAY_SYNC")?,
        };

        log::info!(
            "[Sion][CursorOverlay] X11 prêt : visual 0x{:x} (depth {}), moniteur {}x{}+{}+{}",
            visual,
            depth,
            mon.2,
            mon.3,
            mon.0,
            mon.1
        );

        // Subscribe to output and resolution changes so a failed 0x0 opening
        // can resume when an active output becomes available.
        if let Err(err) = conn.randr_select_input(
            root,
            randr::NotifyMask::SCREEN_CHANGE
                | randr::NotifyMask::CRTC_CHANGE
                | randr::NotifyMask::OUTPUT_CHANGE,
        ) {
            log::warn!("[Sion][CursorOverlay] randr_select_input indisponible : {err:?}");
        }

        Ok(Self {
            conn,
            root,
            depth,
            visual,
            atoms,
            mon,
            win: None,
            shm: None,
            pixmap: None,
            wire: Vec::new(),
            sync_pending: false,
            sync_done: true,
            sync_counter: 0,
            first_present_checked: false,
            logged_content: false,
            logged_cursor_frame: false,
            frame_counter: 0,
            redraw_ms_total: 0,
            redraw_count: 0,
            need_redraw: false,
            redraw_at: None,
            floods: 0,
            screen_wh: (screen.width_in_pixels, screen.height_in_pixels),
            geometry_dirty: false,
            open_requested: false,
        })
    }

    /// Main loop: X events, commands and scheduled redraws.
    fn run(&mut self, state: &Arc<Mutex<OverlayState>>, rx: Receiver<UserEvent>) {
        loop {
            // 1) Bound event draining so continuous resize/hint feedback cannot
            // starve redraws or commands.
            let mut drained = 0usize;
            loop {
                match self.conn.poll_for_event() {
                    Ok(Some(ev)) => {
                        self.on_x_event(ev);
                        drained += 1;
                        if drained >= 64 {
                            self.floods += 1;
                            if self.floods % 50 == 1 {
                                log::info!(
                                    "[Sion][CursorOverlay] flux d'évènements X soutenu ({} lots de 64) — drainage borné",
                                    self.floods
                                );
                            }
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        log::warn!("[Sion][CursorOverlay] X11 connection lost: {err:?}");
                        return;
                    }
                }
            }

            // 2) Refresh geometry after a RANDR event or an opening without an active output.
            if self.geometry_dirty {
                self.geometry_dirty = false;
                self.refresh_geometry();
                if self.win.is_none() && self.open_requested {
                    match self.show() {
                        Ok(()) => self.need_redraw = true,
                        Err(err) => log::debug!("[Sion][CursorOverlay] ouverture reportée : {err}"),
                    }
                }
            }

            // 3) Process a scheduled redraw.
            let due = self.need_redraw || self.redraw_at.is_some_and(|t| Instant::now() >= t);
            if due {
                self.redraw(state);
                continue;
            }

            // 4) Wait for a command or the next redraw deadline.
            let timeout = self
                .redraw_at
                .map(|t| t.saturating_duration_since(Instant::now()))
                .unwrap_or(POLL_CAP)
                .min(POLL_CAP);
            match rx.recv_timeout(timeout) {
                Ok(UserEvent::Show) => {
                    if let Err(err) = self.show() {
                        // No active output yet; retry after RANDR updates geometry.
                        log::debug!("[Sion][CursorOverlay] ouverture différée : {err}");
                        continue;
                    }
                    self.need_redraw = true;
                }
                Ok(UserEvent::Hide) => self.hide(),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.cleanup();
                    return;
                }
            }
        }
    }

    fn on_x_event(&mut self, event: XEvent) {
        match event {
            XEvent::Expose(_) | XEvent::VisibilityNotify(_) => {
                self.need_redraw = true;
            }
            XEvent::MapNotify(_) => {
                // The window manager can accept state changes only after managing the window.
                self.reassert_above();
            }
            XEvent::ConfigureNotify(ev) => {
                // KWin rewrites window state while positioning or maximizing; reassert
                // the hints without waiting for a response.
                self.reassert_above();
                if let Some(win) = self.win.as_mut() {
                    if ev.width != win.w || ev.height != win.h {
                        log::info!(
                            "[Sion][CursorOverlay] resize {}x{} → {}x{}",
                            win.w,
                            win.h,
                            ev.width,
                            ev.height
                        );
                        win.w = ev.width;
                        win.h = ev.height;
                        self.pixmap = Pixmap::new(ev.width as u32, ev.height as u32);
                        self.need_redraw = true;
                    }
                }
            }
            XEvent::RandrScreenChangeNotify(_) | XEvent::RandrNotify(_) => {
                // Refresh geometry after display power or resolution changes.
                self.geometry_dirty = true;
                self.need_redraw = true;
            }
            XEvent::PropertyNotify(ev) => {
                // PropertyNotify confirms consumption of the previous SHM frame.
                // Release the buffer without requesting another redraw, which would create
                // a busy render loop. Cursor updates and ripple timers drive rendering.
                if ev.atom == self.atoms.overlay_sync {
                    self.sync_done = true;
                }
            }
            XEvent::ClientMessage(ev) => {
                // Treat a window-manager close, such as Alt+F4, as Hide.
                if ev.data.as_data32()[0] == self.atoms.net_wm_state {
                    log::info!("[Sion][CursorOverlay] WM state change");
                }
            }
            _ => {}
        }
    }

    /// Create and map the window on its first Show request; safe to repeat.
    fn show(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.open_requested = true;
        if self.mon.2 == 0 || self.mon.3 == 0 {
            self.refresh_geometry();
        }
        if self.mon.2 == 0 || self.mon.3 == 0 {
            // Do not create a 0x0 window when outputs are disabled or the session
            // is locked; retry when RANDR reports valid geometry.
            return Err("écran sans sortie active — overlay reporté".into());
        }
        if self.win.is_none() {
            self.create_window()?;
        } else if let Some(win) = &self.win {
            self.conn.map_window(win.id)?;
            self.conn.flush()?;
        }
        // Hide releases the pixmap; restore it on reopening even if the native
        // window already exists.
        if self.pixmap.is_none() {
            if let Some(win) = self.win.as_ref() {
                self.pixmap = Pixmap::new(win.w as u32, win.h as u32);
                self.ensure_shm(win.w, win.h);
            }
        }
        Ok(())
    }

    fn hide(&mut self) {
        self.open_requested = false;
        if let Some(win) = &self.win {
            let _ = self.conn.unmap_window(win.id);
            let _ = self.conn.flush();
        }
        self.pixmap = None;
        self.need_redraw = false;
        self.redraw_at = None;
        log::info!("[Sion][CursorOverlay] window hidden");
    }

    fn create_window(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let (x, y, w, h) = self.mon;
        let win_id = self.conn.generate_id()?;
        let gc = self.conn.generate_id()?;
        let cmap = self.conn.generate_id()?;

        self.conn
            .create_colormap(ColormapAlloc::NONE, cmap, self.root, self.visual)?;
        self.conn.create_window(
            self.depth,
            win_id,
            self.root,
            x,
            y,
            w,
            h,
            0,
            WindowClass::INPUT_OUTPUT,
            self.visual,
            &CreateWindowAux::new()
                .background_pixel(0)
                .border_pixel(0)
                .colormap(cmap)
                .event_mask(
                    EventMask::EXPOSURE
                        | EventMask::STRUCTURE_NOTIFY
                        | EventMask::VISIBILITY_CHANGE
                        | EventMask::PROPERTY_CHANGE,
                ),
        )?;

        // Diagnostic title visible in wmctrl and xwininfo.
        self.conn.change_property8(
            PropMode::REPLACE,
            win_id,
            AtomEnum::WM_NAME,
            AtomEnum::STRING,
            b"Sion cursor overlay",
        )?;
        self.conn.change_property8(
            PropMode::REPLACE,
            win_id,
            self.atoms.net_wm_name,
            self.atoms.utf8_string,
            b"Sion cursor overlay",
        )?;
        // Use a utility window type to avoid decoration.
        self.conn.change_property32(
            PropMode::REPLACE,
            win_id,
            self.atoms.net_wm_window_type,
            AtomEnum::ATOM,
            &[self.atoms.net_wm_window_type_utility],
        )?;
        // Disable decoration with Motif hints; KWin and Mutter honor these flags.
        self.conn.change_property32(
            PropMode::REPLACE,
            win_id,
            self.atoms.motif_wm_hints,
            self.atoms.motif_wm_hints,
            &[2, 0, 0, 0, 0],
        )?;
        // Keep the overlay visible in the taskbar and pager, matching the original
        // window behavior, while requesting above/sticky placement.
        self.conn.change_property32(
            PropMode::REPLACE,
            win_id,
            self.atoms.net_wm_state,
            AtomEnum::ATOM,
            &[
                self.atoms.net_wm_state_above,
                self.atoms.net_wm_state_sticky,
            ],
        )?;
        // 0xFFFFFFFF selects every virtual desktop in EWMH.
        self.conn.change_property32(
            PropMode::REPLACE,
            win_id,
            self.atoms.net_wm_desktop,
            AtomEnum::CARDINAL,
            &[0xFFFF_FFFF_u32],
        )?;

        // Leave size unconstrained. Fixed min/max hints can create a resize
        // feedback loop with KWin; adapt pixmap and SHM through ConfigureNotify.
        self.conn.change_property8(
            PropMode::REPLACE,
            win_id,
            AtomEnum::WM_CLASS,
            AtomEnum::STRING,
            b"sion-client\0Sion-client\0",
        )?;

        // An empty SHAPE input region passes clicks through.
        match self.conn.extension_information(shape::X11_EXTENSION_NAME) {
            Ok(Some(_)) => {
                self.conn.shape_rectangles(
                    shape::SO::SET,
                    shape::SK::INPUT,
                    xproto::ClipOrdering::UNSORTED,
                    win_id,
                    0,
                    0,
                    &[],
                )?;
            }
            Ok(None) => log::warn!(
                "[Sion][CursorOverlay] extension SHAPE absente — le clic ne traversera pas l'overlay"
            ),
            Err(err) => log::warn!("[Sion][CursorOverlay] SHAPE indisponible: {err:?}"),
        }

        self.conn
            .create_gc(gc, win_id, &CreateGCAux::new().graphics_exposures(0))?;
        self.conn.map_window(win_id)?;
        self.conn.flush()?;

        // Reassert window state after mapping; some managers replace the initial property.
        self.send_state_message(win_id)?;

        self.pixmap = Pixmap::new(w as u32, h as u32);
        self.win = Some(Win {
            id: win_id,
            gc,
            cmap,
            w,
            h,
        });
        self.ensure_shm(w, h);
        log::info!(
            "[Sion][CursorOverlay] window created size={}x{} pos=({},{}) shm={}",
            w,
            h,
            x,
            y,
            if self.shm.is_some() {
                "oui"
            } else {
                "non (repli put_image)"
            }
        );
        Ok(())
    }

    /// Retry above/sticky hints without failing rendering when the manager refuses them.
    fn reassert_above(&self) {
        let Some(win) = self.win.as_ref() else {
            return;
        };
        if let Err(err) = self.send_state_message(win.id) {
            log::warn!("[Sion][CursorOverlay] réaffirmation « au-dessus » refusée: {err:?}");
        }
    }

    /// Request ABOVE and STICKY with a ClientMessage (source 1, action ADD).
    /// KWin can replace the initial property when it manages the window, so replay
    /// the request on MapNotify and ConfigureNotify after management begins.
    fn send_state_message(&self, win: Window) -> Result<(), Box<dyn std::error::Error>> {
        let event = ClientMessageEvent::new(
            32,
            win,
            self.atoms.net_wm_state,
            [
                1,
                self.atoms.net_wm_state_above,
                self.atoms.net_wm_state_sticky,
                1,
                0,
            ],
        );
        self.conn.send_event(
            false,
            self.root,
            EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT,
            event,
        )?;
        self.conn.flush()?;
        Ok(())
    }

    /// Attach SHM when available; put_image remains the functional fallback.
    fn ensure_shm(&mut self, w: u16, h: u16) {
        let needed = w as usize * h as usize * 4;
        if self.shm.as_ref().is_some_and(|s| s.size >= needed) {
            return;
        }
        match self.conn.extension_information(shm::X11_EXTENSION_NAME) {
            Ok(Some(_)) => {}
            other => {
                log::warn!(
                    "[Sion][CursorOverlay] MIT-SHM indisponible ({other:?}) — repli put_image"
                );
                return;
            }
        }
        match attach_shm(&self.conn, needed) {
            Ok(shm) => {
                if let Some(old) = self.shm.take() {
                    let _ = self.conn.shm_detach(old.seg);
                    unsafe { rustix::mm::munmap(old.ptr as *mut _, old.size) }.ok();
                }
                log::info!("[Sion][CursorOverlay] segment SHM de {} Mo", shm.size >> 20);
                self.shm = Some(shm);
            }
            Err(err) => log::warn!("[Sion][CursorOverlay] SHM refusé : {err:?}"),
        }
    }

    /// Render a frame: expire state, draw through the parent module, then blit.
    fn redraw(&mut self, state: &Arc<Mutex<OverlayState>>) {
        let now = Instant::now();
        self.need_redraw = false;

        let (cursor_count, click_count) = {
            let mut s = match state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            s.cursors.retain(|_, c| c.expires_at > now);
            s.clicks.retain(|c| c.expires_at > now);
            (s.cursors.len(), s.clicks.len())
        };

        self.frame_counter = self.frame_counter.wrapping_add(1);
        // Log drawn content to distinguish filtered cursor packets from failed painting.
        if !self.logged_cursor_frame && (cursor_count > 0 || click_count > 0) {
            self.logged_cursor_frame = true;
            log::info!(
                "[Sion][CursorOverlay] première frame avec contenu : cursors={} clicks={}",
                cursor_count,
                click_count
            );
        }
        if (cursor_count > 0 || click_count > 0) && self.frame_counter % 60 == 0 {
            log::info!(
                "[Sion][CursorOverlay] frame #{} cursors={} clicks={}",
                self.frame_counter,
                cursor_count,
                click_count
            );
        }

        let t0 = Instant::now();
        // If X still reads the previous frame, retry soon instead of waiting for a new position.
        let mut retry_soon = false;
        // Temporarily take the pixmap to allow present to borrow self mutably,
        // then restore it after rendering.
        if let Some(mut pixmap) = self.pixmap.take() {
            if let Some((win_id, gc, w, h)) = self.win.as_ref().map(|w| (w.id, w.gc, w.w, w.h)) {
                pixmap.fill(tiny_skia::Color::TRANSPARENT);
                {
                    let s = match state.lock() {
                        Ok(s) => s,
                        Err(poisoned) => poisoned.into_inner(),
                    };
                    super::draw::draw(&mut pixmap, w as f32, h as f32, &s, now);
                }
                if let Err(err) = self.present(win_id, gc, w, h, &pixmap) {
                    log::debug!("[Sion][CursorOverlay] frame sautée : {err}");
                    retry_soon = true;
                }
                // A nonempty frame confirms that drawing and pixel repacking produced pixels.
                if !self.logged_content {
                    let n = pixmap
                        .data()
                        .chunks_exact(4)
                        .filter(|px| px[3] != 0)
                        .count();
                    if n > 0 {
                        self.logged_content = true;
                        log::info!("[Sion][CursorOverlay] première frame non vide ({n} px peints)");
                    }
                }
            }
            self.pixmap = Some(pixmap);
        }
        self.redraw_ms_total += t0.elapsed().as_millis() as u64;
        self.redraw_count += 1;
        if self.redraw_count % 300 == 0 {
            log::info!(
                "[Sion][CursorOverlay] redraw {}ms en moyenne ({} frames)",
                self.redraw_ms_total / self.redraw_count.max(1),
                self.redraw_count
            );
            self.redraw_ms_total = 0;
            self.redraw_count = 0;
        }

        // Animate active click ripples, otherwise wake at the next expiry or sleep.
        let (animate, wake_at) = {
            let s = match state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            let mut wake: Option<Instant> = None;
            for c in s.cursors.values() {
                wake = Some(wake.map_or(c.expires_at, |t| t.min(c.expires_at)));
            }
            for c in &s.clicks {
                wake = Some(wake.map_or(c.expires_at, |t| t.min(c.expires_at)));
            }
            (!s.clicks.is_empty(), wake)
        };
        self.redraw_at = if retry_soon {
            Some(now + Duration::from_millis(8))
        } else if animate {
            Some(now + ANIMATE_STEP)
        } else {
            wake_at
        };
    }

    fn present(
        &mut self,
        win_id: Window,
        gc: u32,
        w: u16,
        h: u16,
        pixmap: &Pixmap,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let pixels = (w as usize) * (h as usize);
        if self.shm.is_some() {
            // Skip the frame until PropertyNotify releases the SHM buffer; never block.
            if self.sync_pending && !self.sync_done {
                return Err("le serveur X lit encore la frame précédente".into());
            }
            let shm = self.shm.as_mut().unwrap();
            let dst = unsafe { std::slice::from_raw_parts_mut(shm.ptr as *mut u32, pixels) };
            super::repack_rgba_to_bgra_parallel(dst, pixmap.data());
            let cookie = self.conn.shm_put_image(
                win_id,
                gc,
                w,
                h,
                0,
                0,
                w,
                h,
                0,
                0,
                self.depth,
                ImageFormat::Z_PIXMAP.into(),
                false,
                shm.seg,
                0,
            )?;
            // Check the first request to surface asynchronous BadMatch or BadDepth errors.
            if !self.first_present_checked {
                self.first_present_checked = true;
                if let Err(err) = cookie.check() {
                    log::warn!("[Sion][CursorOverlay] shm_put_image refusé : {err:?}");
                }
            }
            // X processes requests in order: the property change following shm_put_image
            // acknowledges frame consumption without a blocking GetInputFocus round trip.
            self.sync_counter = self.sync_counter.wrapping_add(1);
            self.conn.change_property32(
                PropMode::REPLACE,
                win_id,
                self.atoms.overlay_sync,
                AtomEnum::CARDINAL,
                &[self.sync_counter],
            )?;
            self.sync_pending = true;
            self.sync_done = false;
            self.conn.flush()?;
        } else {
            self.wire.resize(pixels, 0);
            super::repack_rgba_to_bgra_parallel(&mut self.wire, pixmap.data());
            let data: &[u8] =
                unsafe { std::slice::from_raw_parts(self.wire.as_ptr() as *const u8, pixels * 4) };
            self.conn.put_image(
                ImageFormat::Z_PIXMAP,
                win_id,
                gc,
                w,
                h,
                0,
                0,
                0,
                self.depth,
                data,
            )?;
            self.conn.flush()?;
        }
        Ok(())
    }

    /// Refresh monitor geometry and resize an existing window. Keep the last
    /// valid geometry if RANDR reports no active output, then retry on the next event.
    fn refresh_geometry(&mut self) {
        let mut geom = primary_monitor(&self.conn, self.root);
        if geom.is_none() {
            let (sw, sh) = self.screen_wh;
            if sw > 0 && sh > 0 {
                geom = Some((0, 0, sw, sh));
            }
        }
        let Some((x, y, w, h)) = geom else { return };
        if w == 0 || h == 0 {
            return;
        }
        self.mon = (x, y, w, h);
        let Some((win_id, ww, wh)) = self.win.as_ref().map(|win| (win.id, win.w, win.h)) else {
            return;
        };
        if ww == w && wh == h {
            return;
        }
        let _ = self.conn.configure_window(
            win_id,
            &xproto::ConfigureWindowAux::new()
                .x(x as i32)
                .y(y as i32)
                .width(w as u32)
                .height(h as u32),
        );
        if let Some(win) = self.win.as_mut() {
            win.w = w;
            win.h = h;
        }
        self.pixmap = Pixmap::new(w as u32, h as u32);
        self.ensure_shm(w, h);
        self.need_redraw = true;
        log::info!(
            "[Sion][CursorOverlay] géométrie mise à jour : {}x{}+{}+{}",
            w,
            h,
            x,
            y
        );
    }

    fn cleanup(&mut self) {
        if let Some(shm) = self.shm.take() {
            let _ = self.conn.shm_detach(shm.seg);
            unsafe { rustix::mm::munmap(shm.ptr as *mut _, shm.size) }.ok();
        }
        if let Some(win) = self.win.take() {
            let _ = self.conn.destroy_window(win.id);
            let _ = self.conn.free_colormap(win.cmap);
        }
        let _ = self.conn.flush();
        log::info!("[Sion][CursorOverlay] X11 window destroyed");
    }
}

/// Create POSIX shared memory and attach it to X.
fn attach_shm(conn: &RustConnection, needed: usize) -> Result<Shm, Box<dyn std::error::Error>> {
    // Round capacity up to a power of two to avoid reallocating for small size changes.
    let size = needed.next_power_of_two();
    let mut last_err = None;
    for i in 0..4 {
        let name = format!("/sion-overlay-{}-{}", std::process::id(), i);
        match rustix::shm::open(
            name.as_str(),
            rustix::shm::OFlags::RDWR | rustix::shm::OFlags::CREATE | rustix::shm::OFlags::EXCL,
            rustix::shm::Mode::RUSR | rustix::shm::Mode::WUSR,
        ) {
            Ok(fd) => {
                rustix::fs::ftruncate(&fd, size as u64)?;
                let ptr = unsafe {
                    rustix::mm::mmap(
                        std::ptr::null_mut(),
                        size,
                        rustix::mm::ProtFlags::READ | rustix::mm::ProtFlags::WRITE,
                        rustix::mm::MapFlags::SHARED,
                        &fd,
                        0,
                    )?
                } as *mut u8;
                // Unlink the name immediately; the file descriptor keeps the allocation alive.
                let _ = rustix::shm::unlink(name.as_str());
                let seg = conn.generate_id()?;
                conn.shm_attach_fd(seg, fd, true)?.check()?;
                return Ok(Shm { seg, size, ptr });
            }
            Err(err) => last_err = Some(err),
        }
    }
    Err(format!("shm_open: {last_err:?}").into())
}

fn intern(conn: &RustConnection, name: &[u8]) -> Result<u32, Box<dyn std::error::Error>> {
    Ok(conn.intern_atom(false, name)?.reply()?.atom)
}

/// Query the primary monitor through RANDR, falling back to the entire screen.
pub(crate) fn primary_monitor(conn: &RustConnection, root: Window) -> Option<(i16, i16, u16, u16)> {
    let primary = conn
        .randr_get_output_primary(root)
        .ok()?
        .reply()
        .ok()?
        .output;
    if primary == x11rb::NONE {
        return None;
    }
    let res = conn
        .randr_get_screen_resources_current(root)
        .ok()?
        .reply()
        .ok()?;
    let info = conn
        .randr_get_output_info(primary, res.config_timestamp)
        .ok()?
        .reply()
        .ok()?;
    if info.crtc == 0 || info.connection != randr::Connection::CONNECTED {
        return None;
    }
    let crtc = conn
        .randr_get_crtc_info(info.crtc, res.config_timestamp)
        .ok()?
        .reply()
        .ok()?;
    if crtc.width == 0 || crtc.height == 0 {
        return None;
    }
    Some((crtc.x, crtc.y, crtc.width, crtc.height))
}
