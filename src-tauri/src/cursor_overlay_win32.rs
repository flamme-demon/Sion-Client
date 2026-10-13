//! Native Win32 cursor overlay using a layered window and UpdateLayeredWindow.
//!
//! The PIP owns winit's only EventLoop, so this overlay creates its own Win32
//! window and message pump. Layered alpha preserves smooth cursor edges;
//! WS_EX_TRANSPARENT passes clicks through, while TOPMOST and NOACTIVATE
//! keep the overlay visible without stealing focus or creating a taskbar entry.
//!
//! The parent module draws the pixels. This host handles the window and blit,
//! redrawing around 30 Hz during click animation and sleeping until expiry otherwise.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use tiny_skia::Pixmap;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
    HBITMAP, HDC, HGDIOBJ,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetSystemMetrics,
    PeekMessageW, RegisterClassExW, ShowWindow, TranslateMessage, UpdateLayeredWindow, MSG,
    PM_REMOVE, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA, WNDCLASSEXW, WNDCLASS_STYLES, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};
use windows_core::{w, BOOL};

use super::{OverlayState, UserEvent};

/// Click animation interval, shared with the other hosts.
const ANIMATE_STEP: Duration = Duration::from_millis(33);
/// Maximum wait before pumping window messages.
const POLL_CAP: Duration = Duration::from_millis(100);

/// Start the Win32 thread; return None if window creation fails.
pub(super) fn start(
    state: Arc<Mutex<OverlayState>>,
    thread_alive: Arc<AtomicBool>,
) -> Option<Sender<UserEvent>> {
    let (tx, rx) = std::sync::mpsc::channel::<UserEvent>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();

    thread::Builder::new()
        .name("sion-cursor-overlay".into())
        .spawn(move || {
            // Create the window on this thread: its message pump services only
            // windows owned by the same thread.
            let mut host = match Host::new() {
                Ok(h) => h,
                Err(err) => {
                    log::warn!("[Sion][CursorOverlay] hôte Win32 indisponible: {err}");
                    let _ = ready_tx.send(false);
                    thread_alive.store(false, Ordering::Release);
                    return;
                }
            };
            let _ = ready_tx.send(true);
            host.run(&state, rx);
            thread_alive.store(false, Ordering::Release);
            log::info!("[Sion][CursorOverlay] fil Win32 arrêté");
        })
        .ok()?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(true) => Some(tx),
        _ => None,
    }
}

/// Delegate messages to the default procedure. The click-through window
/// draws through UpdateLayeredWindow instead of handling paint requests.
unsafe extern "system" fn overlay_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn register_class() -> Result<(), String> {
    static REGISTERED: OnceLock<Result<(), String>> = OnceLock::new();
    REGISTERED
        .get_or_init(|| {
            let module = unsafe { GetModuleHandleW(None) }.map_err(|err| err.to_string())?;
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: WNDCLASS_STYLES::default(),
                lpfnWndProc: Some(overlay_window_proc),
                hInstance: HINSTANCE(module.0),
                lpszClassName: w!("SION_CURSOR_OVERLAY"),
                ..Default::default()
            };
            if unsafe { RegisterClassExW(&class) } == 0 {
                Err(windows_core::Error::from_thread().to_string())
            } else {
                Ok(())
            }
        })
        .clone()
}

/// Use the shared monitor's geometry, falling back to the virtual desktop
/// when unknown. Coordinates are normalized within the shared monitor,
/// so spanning all monitors would place remote cursors incorrectly.
fn virtual_screen() -> (i32, i32, i32, i32) {
    if let Some(index) = crate::cursor_overlay::cursor_overlay_shared_screen() {
        if let Some(rect) = moniteur_par_index(index) {
            return rect;
        }
        log::warn!(
            "[Sion][CursorOverlay] écran partagé {index} introuvable — repli sur le bureau virtuel"
        );
    }
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1),
            GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1),
        )
    }
}

/// Return the nth monitor in Windows enumeration order, matching libwebrtc.
fn moniteur_par_index(index: u64) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };

    struct Collecte {
        vise: u64,
        vu: u64,
        trouve: Option<(i32, i32, i32, i32)>,
    }

    unsafe extern "system" fn visiter(
        moniteur: HMONITOR,
        _dc: HDC,
        _rect: *mut RECT,
        param: LPARAM,
    ) -> BOOL {
        let collecte = &mut *(param.0 as *mut Collecte);
        if collecte.vu == collecte.vise {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(moniteur, &mut info).as_bool() {
                let r = info.rcMonitor;
                collecte.trouve = Some((
                    r.left,
                    r.top,
                    (r.right - r.left).max(1),
                    (r.bottom - r.top).max(1),
                ));
            }
            return BOOL(0);
        }
        collecte.vu += 1;
        BOOL(1)
    }

    let mut collecte = Collecte {
        vise: index,
        vu: 0,
        trouve: None,
    };
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(visiter),
            LPARAM(&mut collecte as *mut _ as isize),
        );
    }
    collecte.trouve
}

pub(crate) struct Surface {
    pub(crate) dc: HDC,
    bitmap: HBITMAP,
    ancien: HGDIOBJ,
    pub(crate) pixels: *mut u8,
    pub(crate) largeur: i32,
    pub(crate) hauteur: i32,
}

impl Surface {
    /// Create a memory DC and top-down 32-bit DIB. Its stride is exactly width * 4.
    pub(crate) fn new(largeur: i32, hauteur: i32) -> Result<Self, String> {
        unsafe {
            let ecran = GetDC(None);
            let dc = CreateCompatibleDC(Some(ecran));
            ReleaseDC(None, ecran);
            if dc.is_invalid() {
                return Err("DC mémoire indisponible".into());
            }
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: largeur,
                    // Negative height selects top-down rows, matching tiny-skia.
                    biHeight: -hauteur,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels: *mut core::ffi::c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut pixels, None, 0)
                .map_err(|err| err.to_string())?;
            let ancien = SelectObject(dc, bitmap.into());
            Ok(Self {
                dc,
                bitmap,
                ancien,
                pixels: pixels.cast(),
                largeur,
                hauteur,
            })
        }
    }
}

impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.ancien);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

struct Host {
    hwnd: Option<HWND>,
    surface: Option<Surface>,
    pixmap: Option<Pixmap>,
    origine: (i32, i32),
    need_redraw: bool,
    redraw_at: Option<Instant>,
}

impl Host {
    fn new() -> Result<Self, String> {
        register_class()?;
        Ok(Self {
            hwnd: None,
            surface: None,
            pixmap: None,
            origine: (0, 0),
            need_redraw: false,
            redraw_at: None,
        })
    }

    fn show(&mut self) -> Result<(), String> {
        if let Some(hwnd) = self.hwnd {
            unsafe {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
            self.need_redraw = true;
            return Ok(());
        }
        let (x, y, largeur, hauteur) = virtual_screen();
        let module = unsafe { GetModuleHandleW(None) }.map_err(|err| err.to_string())?;
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_TOPMOST
                    | WS_EX_NOACTIVATE
                    | WS_EX_TOOLWINDOW,
                w!("SION_CURSOR_OVERLAY"),
                w!("Sion cursor overlay"),
                WS_POPUP,
                x,
                y,
                largeur,
                hauteur,
                None,
                None,
                Some(HINSTANCE(module.0)),
                None,
            )
        }
        .map_err(|err| err.to_string())?;

        self.surface = Some(Surface::new(largeur, hauteur)?);
        self.pixmap = Pixmap::new(largeur as u32, hauteur as u32);
        self.origine = (x, y);
        self.hwnd = Some(hwnd);
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        self.need_redraw = true;
        log::info!(
            "[Sion][CursorOverlay] fenêtre Win32 créée {}x{} à ({},{})",
            largeur,
            hauteur,
            x,
            y
        );
        Ok(())
    }

    fn hide(&mut self) {
        if let Some(hwnd) = self.hwnd.take() {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
                let _ = DestroyWindow(hwnd);
            }
        }
        // Release the GDI bitmap with the window to avoid accumulating handles
        // across repeated share/stop cycles.
        self.surface = None;
        self.pixmap = None;
        self.redraw_at = None;
        log::info!("[Sion][CursorOverlay] fenêtre Win32 détruite");
    }

    fn redraw(&mut self, state: &Arc<Mutex<OverlayState>>) {
        let (Some(hwnd), Some(surface), Some(pixmap)) =
            (self.hwnd, self.surface.as_ref(), self.pixmap.as_mut())
        else {
            return;
        };
        pixmap.fill(tiny_skia::Color::TRANSPARENT);

        let now = Instant::now();
        let (anime, prochain) = {
            let mut s = match state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            s.cursors.retain(|_, c| c.expires_at > now);
            s.clicks.retain(|c| c.expires_at > now);
            super::draw::draw(
                pixmap,
                surface.largeur as f32,
                surface.hauteur as f32,
                &s,
                now,
            );
            let mut prochain: Option<Instant> = None;
            for c in s.cursors.values() {
                prochain = Some(prochain.map_or(c.expires_at, |t: Instant| t.min(c.expires_at)));
            }
            for c in &s.clicks {
                prochain = Some(prochain.map_or(c.expires_at, |t: Instant| t.min(c.expires_at)));
            }
            (!s.clicks.is_empty(), prochain)
        };

        // Swap red and blue between tiny-skia RGBA and GDI BGRA; both are premultiplied.
        let octets = (surface.largeur as usize) * (surface.hauteur as usize) * 4;
        unsafe {
            let dst = std::slice::from_raw_parts_mut(surface.pixels, octets);
            for (i, px) in pixmap.data().chunks_exact(4).enumerate() {
                let o = i * 4;
                dst[o] = px[2];
                dst[o + 1] = px[1];
                dst[o + 2] = px[0];
                dst[o + 3] = px[3];
            }
        }

        let position = POINT {
            x: self.origine.0,
            y: self.origine.1,
        };
        let taille = SIZE {
            cx: surface.largeur,
            cy: surface.hauteur,
        };
        let source = POINT { x: 0, y: 0 };
        let melange = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        if let Err(err) = unsafe {
            UpdateLayeredWindow(
                hwnd,
                None,
                Some(&position),
                Some(&taille),
                Some(surface.dc),
                Some(&source),
                COLORREF(0),
                Some(&melange),
                ULW_ALPHA,
            )
        } {
            log::warn!("[Sion][CursorOverlay] présentation refusée: {err}");
        }

        self.need_redraw = false;
        self.redraw_at = if anime {
            Some(now + ANIMATE_STEP)
        } else {
            prochain
        };
    }

    /// Drain this thread's message queue so Windows keeps the window responsive.
    fn pomper_messages(&self) {
        let mut msg = MSG::default();
        unsafe {
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    fn run(&mut self, state: &Arc<Mutex<OverlayState>>, rx: Receiver<UserEvent>) {
        loop {
            self.pomper_messages();

            let du = self.need_redraw || self.redraw_at.is_some_and(|t| Instant::now() >= t);
            if du && self.hwnd.is_some() {
                self.redraw(state);
            }

            let attente = self
                .redraw_at
                .map(|t| t.saturating_duration_since(Instant::now()).min(POLL_CAP))
                .unwrap_or(POLL_CAP);
            match rx.recv_timeout(attente) {
                Ok(UserEvent::Show) => {
                    if let Err(err) = self.show() {
                        log::warn!("[Sion][CursorOverlay] ouverture impossible: {err}");
                    }
                }
                Ok(UserEvent::Hide) => self.hide(),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    self.hide();
                    return;
                }
            }
        }
    }
}
