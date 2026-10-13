use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

// Platform hosts: Wayland layer-shell with X11 fallback on Linux, Win32 on Windows.
// The PIP owns winit's single EventLoop, so overlays need separate native hosts.
#[cfg(target_os = "linux")]
#[path = "cursor_overlay_layershell.rs"]
mod layershell_host;
#[cfg(target_os = "windows")]
#[path = "cursor_overlay_win32.rs"]
pub(crate) mod win32_host;
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[path = "cursor_overlay_winit.rs"]
mod winit_host;
#[cfg(target_os = "linux")]
#[path = "cursor_overlay_x11.rs"]
pub(crate) mod x11_host;

/// Embedded DejaVu Sans Bold font (Bitstream Vera derivative, free license).
/// Loaded once on first redraw.
const FONT_BYTES: &[u8] = include_bytes!("../assets/DejaVuSans-Bold.ttf");
static FONT: OnceLock<Option<FontRef<'static>>> = OnceLock::new();
pub(crate) fn font() -> Option<&'static FontRef<'static>> {
    FONT.get_or_init(|| FontRef::try_from_slice(FONT_BYTES).ok())
        .as_ref()
}

/// One remote viewer's cursor, kept between updates until `expires_at`.
/// The last network position is painted directly: smoothing here would add
/// latency before the overlay is captured and encoded into the share.
#[derive(Clone, Debug)]
struct CursorEntry {
    identity: String,
    /// Display name to render in the pill below the cursor.
    name: String,
    /// Latest broadcast position (normalised [0, 1]).
    x: f32,
    y: f32,
    expires_at: Instant,
}

/// One one-shot click ripple. Animates for ~600 ms then is swept.
#[derive(Clone, Debug)]
struct ClickEntry {
    identity: String,
    x: f32,
    y: f32,
    born_at: Instant,
    expires_at: Instant,
}

#[derive(Default)]
struct OverlayState {
    cursors: HashMap<String, CursorEntry>,
    clicks: Vec<ClickEntry>,
}

/// Messages the Tauri commands send to the event loop thread via
/// `EventLoopProxy::send_event`.
#[derive(Debug)]
enum UserEvent {
    Show,
    Hide,
}

/// Platform-independent sender to the window thread. Each host supplies its
/// own callback, keeping mpsc and winit types out of shared code.
struct HostSender {
    send: Box<dyn Fn(UserEvent) + Send + Sync>,
}

impl HostSender {
    fn new(send: impl Fn(UserEvent) + Send + Sync + 'static) -> Self {
        Self {
            send: Box::new(send),
        }
    }

    fn send(&self, event: UserEvent) {
        (self.send)(event);
    }
}

struct OverlayHandle {
    state: Arc<Mutex<OverlayState>>,
    proxy: HostSender,
    thread_alive: Arc<AtomicBool>,
}

static HANDLE: OnceLock<OverlayHandle> = OnceLock::new();
static OVERLAY_OPEN: AtomicBool = AtomicBool::new(false);

pub fn cursor_overlay_is_open() -> bool {
    OVERLAY_OPEN.load(Ordering::Acquire)
}

/// Start the host thread on first use. Idempotent — subsequent calls return
/// the existing handle.
fn get_or_start_handle() -> Option<&'static OverlayHandle> {
    if let Some(h) = HANDLE.get() {
        return Some(h);
    }

    let state = Arc::new(Mutex::new(OverlayState::default()));
    let thread_alive = Arc::new(AtomicBool::new(true));
    let proxy = start_host_thread(state.clone(), thread_alive.clone())?;

    let handle = OverlayHandle {
        state,
        proxy,
        thread_alive,
    };
    let _ = HANDLE.set(handle);
    HANDLE.get()
}

/// Start the platform window thread. Linux uses layer-shell or X11; Windows
/// uses Win32. Only the remaining desktop platforms use winit.
fn start_host_thread(
    state: Arc<Mutex<OverlayState>>,
    thread_alive: Arc<AtomicBool>,
) -> Option<HostSender> {
    #[cfg(target_os = "linux")]
    {
        // Prefer layer-shell: KDE manages virtual desktops outside XWayland,
        // so X11 sticky hints cannot keep an overlay visible on every desktop.
        if let Some(tx) = layershell_host::start(Arc::clone(&state), Arc::clone(&thread_alive)) {
            return Some(HostSender::new(move |event| {
                let _ = tx.send(event);
            }));
        }
        // Fall back to X11 when layer-shell is unavailable. The failed Wayland
        // host clears thread_alive, so restore it before starting the X11 host.
        thread_alive.store(true, Ordering::Release);
        x11_host::start(state, thread_alive).map(|tx| {
            HostSender::new(move |event| {
                let _ = tx.send(event);
            })
        })
    }
    #[cfg(target_os = "windows")]
    {
        win32_host::start(state, thread_alive).map(|tx| {
            HostSender::new(move |event| {
                let _ = tx.send(event);
            })
        })
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        winit_host::start(state, thread_alive).map(|proxy| {
            HostSender::new(move |event| {
                let _ = proxy.send_event(event);
            })
        })
    }
}

// ── drawing ─────────────────────────────────────────────────────────────

pub(crate) mod draw {
    use super::*;

    pub(super) fn draw(pixmap: &mut Pixmap, w: f32, h: f32, state: &OverlayState, now: Instant) {
        for click in &state.clicks {
            draw_ripple(pixmap, w, h, click, now);
        }
        for cursor in state.cursors.values() {
            draw_cursor(pixmap, w, h, cursor);
        }
    }

    /// Stable identity-based color shared by the captured overlay and viewer
    /// surface, so each viewer keeps the same color everywhere.
    pub(crate) fn identity_color_rgba8(identity: &str) -> (u8, u8, u8) {
        let mut h: i32 = 0;
        for c in identity.chars() {
            h = ((h.wrapping_shl(5)).wrapping_sub(h)).wrapping_add(c as i32);
        }
        let hue = (h.unsigned_abs() % 360) as f32;
        hsl_to_rgb(hue, 0.75, 0.55)
    }

    fn color_for_identity(identity: &str) -> Color {
        let (r, g, b) = identity_color_rgba8(identity);
        Color::from_rgba8(r, g, b, 255)
    }

    fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (u8, u8, u8) {
        let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = l - c / 2.0;
        let (r, g, b) = match h as u32 {
            0..=59 => (c, x, 0.0),
            60..=119 => (x, c, 0.0),
            120..=179 => (0.0, c, x),
            180..=239 => (0.0, x, c),
            240..=299 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        (
            ((r + m) * 255.0) as u8,
            ((g + m) * 255.0) as u8,
            ((b + m) * 255.0) as u8,
        )
    }

    fn draw_cursor(pixmap: &mut Pixmap, w: f32, h: f32, cursor: &CursorEntry) {
        let x = (cursor.x.clamp(0.0, 1.0)) * w;
        let y = (cursor.y.clamp(0.0, 1.0)) * h;
        let color = color_for_identity(&cursor.identity);

        // Compact arrow path (~14×17 units) modelled on the macOS / GNOME
        // cursor shape — tip at (0,0), short tail down-right, no overhang.
        let scale = 1.4_f32;
        let mut pb = PathBuilder::new();
        pb.move_to(x + 0.0 * scale, y + 0.0 * scale); // tip
        pb.line_to(x + 0.0 * scale, y + 14.0 * scale); // left side down
        pb.line_to(x + 3.5 * scale, y + 11.0 * scale); // notch
        pb.line_to(x + 6.0 * scale, y + 16.0 * scale); // tail tip
        pb.line_to(x + 7.5 * scale, y + 15.0 * scale); // tail base
        pb.line_to(x + 5.0 * scale, y + 10.0 * scale); // notch up
        pb.line_to(x + 10.0 * scale, y + 10.0 * scale); // right side
        pb.close();
        let path = match pb.finish() {
            Some(p) => p,
            None => return,
        };

        // White stroke first (wider) for contrast against any background.
        let mut stroke_paint = Paint::default();
        stroke_paint.set_color(Color::from_rgba8(255, 255, 255, 255));
        stroke_paint.anti_alias = true;
        let stroke = Stroke {
            width: 2.0,
            line_join: tiny_skia::LineJoin::Round,
            ..Stroke::default()
        };
        pixmap.stroke_path(&path, &stroke_paint, &stroke, Transform::identity(), None);

        // Coloured fill.
        let mut fill_paint = Paint::default();
        fill_paint.set_color(color);
        fill_paint.anti_alias = true;
        pixmap.fill_path(
            &path,
            &fill_paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );

        // Name pill — drawn just below + right of the cursor tail so it
        // doesn't sit on top of the click target. Coloured background +
        // white text + soft shadow rectangle for legibility on busy
        // screens. The pill is anchored at (x, y + cursor_height).
        if !cursor.name.is_empty() {
            let pill_anchor_x = x + 4.0;
            let pill_anchor_y = y + (16.0 * scale) + 4.0;
            draw_name_pill(
                pixmap,
                w,
                h,
                pill_anchor_x,
                pill_anchor_y,
                &cursor.name,
                color,
            );
        }
    }

    /// Render a coloured pill containing the cursor owner's name. tiny-skia
    /// has no text support, so we lay out the glyphs with `ab_glyph` and
    /// blend each rasterised mask straight into the pixmap.
    fn draw_name_pill(
        pixmap: &mut Pixmap,
        w: f32,
        h: f32,
        anchor_x: f32,
        anchor_y: f32,
        name: &str,
        color: Color,
    ) {
        let Some(font) = font() else { return };

        // Cap displayed text to keep the pill from running off the screen
        // edge. 28 chars covers most Matrix display names without spilling.
        const MAX_CHARS: usize = 28;
        let display: String = if name.chars().count() > MAX_CHARS {
            name.chars().take(MAX_CHARS - 1).collect::<String>() + "…"
        } else {
            name.to_string()
        };

        let px = 18.0_f32;
        let scale_font = font.as_scaled(PxScale::from(px));
        let ascent = scale_font.ascent();
        let descent = scale_font.descent();
        let line_h = ascent - descent;

        // Layout: walk glyphs to compute total width.
        let mut text_w = 0.0_f32;
        let mut chars_iter = display.chars().peekable();
        while let Some(ch) = chars_iter.next() {
            let glyph_id = scale_font.glyph_id(ch);
            text_w += scale_font.h_advance(glyph_id);
            if let Some(&next) = chars_iter.peek() {
                text_w += scale_font.kern(glyph_id, scale_font.glyph_id(next));
            }
        }

        let pad_x = 8.0_f32;
        let pad_y = 4.0_f32;
        let pill_w = text_w + pad_x * 2.0;
        let pill_h = line_h + pad_y * 2.0;

        // Clamp the pill onto the screen so it never disappears past an edge.
        let pill_x = anchor_x.min(w - pill_w - 2.0).max(2.0);
        let pill_y = anchor_y.min(h - pill_h - 2.0).max(2.0);

        // Rounded-ish rectangle background. tiny-skia has no native rounded
        // rect, but a fill_rect with a 1-px border looks fine at this size.
        if let Some(rect) = Rect::from_xywh(pill_x, pill_y, pill_w, pill_h) {
            let mut bg_paint = Paint::default();
            bg_paint.set_color(color);
            bg_paint.anti_alias = false;
            pixmap.fill_rect(rect, &bg_paint, Transform::identity(), None);
        }

        // Draw each glyph in white with the same shadow trick (drop a
        // semi-transparent black silhouette one pixel down-right first).
        let baseline_y = pill_y + pad_y + ascent;
        let mut pen_x = pill_x + pad_x;
        let mut chars_iter = display.chars().peekable();
        while let Some(ch) = chars_iter.next() {
            let glyph_id = scale_font.glyph_id(ch);
            let glyph = glyph_id
                .with_scale_and_position(PxScale::from(px), ab_glyph::point(pen_x, baseline_y));
            if let Some(outlined) = font.outline_glyph(glyph) {
                let bb = outlined.px_bounds();
                outlined.draw(|gx, gy, alpha| {
                    let dx = bb.min.x as i32 + gx as i32;
                    let dy = bb.min.y as i32 + gy as i32;
                    if dx < 0 || dy < 0 {
                        return;
                    }
                    let (px_w, px_h) = (pixmap.width() as i32, pixmap.height() as i32);
                    if dx >= px_w || dy >= px_h {
                        return;
                    }
                    let idx = (dy as u32 * pixmap.width() + dx as u32) as usize * 4;
                    let data = pixmap.data_mut();
                    if idx + 3 >= data.len() {
                        return;
                    }
                    // Source over: white text with `alpha`, blend over the
                    // existing premultiplied background.
                    let src_a = (alpha * 255.0) as u32;
                    let inv = 255 - src_a;
                    data[idx] = ((255 * src_a + data[idx] as u32 * inv) / 255) as u8;
                    data[idx + 1] = ((255 * src_a + data[idx + 1] as u32 * inv) / 255) as u8;
                    data[idx + 2] = ((255 * src_a + data[idx + 2] as u32 * inv) / 255) as u8;
                    data[idx + 3] = ((255 * src_a + data[idx + 3] as u32 * inv) / 255) as u8;
                });
            }
            pen_x += scale_font.h_advance(glyph_id);
            if let Some(&next) = chars_iter.peek() {
                pen_x += scale_font.kern(glyph_id, scale_font.glyph_id(next));
            }
        }
    }

    fn draw_ripple(pixmap: &mut Pixmap, w: f32, h: f32, click: &ClickEntry, now: Instant) {
        let x = (click.x.clamp(0.0, 1.0)) * w;
        let y = (click.y.clamp(0.0, 1.0)) * h;
        let color = color_for_identity(&click.identity);

        // 3 concentric rings, each with a stagger, animating from 0.4 to
        // 3.0 scale and opacity 0.85 → 0 over 600 ms. Mirrors the SVG
        // `sion-ripple` keyframe animation in the old Tauri overlay.
        let base_radius = 18.0_f32;
        let total_ms = 600.0_f32;
        for (i, stagger_ms) in [0.0, 120.0, 240.0].iter().enumerate() {
            let elapsed =
                (now.saturating_duration_since(click.born_at).as_millis() as f32) - stagger_ms;
            if elapsed <= 0.0 || elapsed >= total_ms {
                continue;
            }
            let t = elapsed / total_ms; // 0..1
            let scale = 0.4 + (3.0 - 0.4) * t;
            let alpha_f = 0.85 * (1.0 - t);
            let alpha = (alpha_f.clamp(0.0, 1.0) * 255.0) as u8;
            let radius = base_radius * scale;
            if radius < 1.0 {
                continue;
            }
            let mut pb = PathBuilder::new();
            pb.push_circle(x, y, radius);
            let path = match pb.finish() {
                Some(p) => p,
                None => continue,
            };
            let mut paint = Paint::default();
            // Use the identity colour with per-ring alpha.
            paint.set_color(Color::from_rgba8(
                (color.red() * 255.0) as u8,
                (color.green() * 255.0) as u8,
                (color.blue() * 255.0) as u8,
                alpha,
            ));
            paint.anti_alias = true;
            let _ = i;
            let stroke = Stroke {
                width: 3.0,
                line_join: tiny_skia::LineJoin::Round,
                ..Stroke::default()
            };
            pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
        }
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Shared monitor index, or -1 when unknown. Cursor coordinates cover
/// this monitor only; using the whole virtual desktop would offset them.
static ECRAN_PARTAGE: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(-1);

/// Set the shared monitor before opening the overlay.
pub fn cursor_overlay_set_shared_screen(index: Option<u64>) {
    let valeur = index.map(|v| v as i64).unwrap_or(-1);
    ECRAN_PARTAGE.store(valeur, Ordering::Release);
    log::info!("[Sion][CursorOverlay] écran partagé déclaré : {valeur}");
}

/// Captured monitor position and physical size. The Wayland portal selects
/// the monitor; use capture geometry to place layer-shell on the same output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeometrieEcran {
    pub x: i32,
    pub y: i32,
    pub largeur: i32,
    pub hauteur: i32,
}

static GEOMETRIE_PARTAGEE: Mutex<Option<GeometrieEcran>> = Mutex::new(None);

/// Update capture geometry on the first frame or a resolution change.
pub fn cursor_overlay_set_shared_geometry(geometrie: Option<GeometrieEcran>) {
    let mut g = match GEOMETRIE_PARTAGEE.lock() {
        Ok(g) => g,
        Err(poison) => poison.into_inner(),
    };
    if *g != geometrie {
        log::info!("[Sion][CursorOverlay] géométrie de l'écran partagé : {geometrie:?}");
        *g = geometrie;
    }
}

/// Return capture geometry when available.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn cursor_overlay_shared_geometry() -> Option<GeometrieEcran> {
    match GEOMETRIE_PARTAGEE.lock() {
        Ok(g) => *g,
        Err(poison) => *poison.into_inner(),
    }
}

/// Return the shared monitor index when known.
// Win32 needs this index to select the shared monitor. Linux layer-shell
// uses capture geometry instead, hence the platform-specific lint exemption.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cursor_overlay_shared_screen() -> Option<u64> {
    let v = ECRAN_PARTAGE.load(Ordering::Acquire);
    (v >= 0).then_some(v as u64)
}

#[tauri::command]
pub fn cursor_overlay_open() -> bool {
    let Some(handle) = get_or_start_handle() else {
        // Log host initialization failure instead of silently hiding the overlay.
        log::warn!("[Sion][CursorOverlay] hôte indisponible — overlay non ouvert");
        return false;
    };
    if !handle.thread_alive.load(Ordering::Acquire) {
        log::warn!("[Sion][CursorOverlay] thread is not alive anymore, open skipped");
        return false;
    }
    OVERLAY_OPEN.store(true, Ordering::Release);
    let _ = handle.proxy.send(UserEvent::Show);
    true
}

#[tauri::command]
pub fn cursor_overlay_close() {
    OVERLAY_OPEN.store(false, Ordering::Release);
    // The next share will select its monitor again.
    cursor_overlay_set_shared_geometry(None);
    let Some(handle) = HANDLE.get() else {
        return;
    };
    let _ = handle.proxy.send(UserEvent::Hide);
    if let Ok(mut state) = handle.state.lock() {
        state.cursors.clear();
        state.clicks.clear();
    }
}

pub fn cursor_overlay_push(identity: String, name: String, x: f32, y: f32, expires_at_ms: u64) {
    if !cursor_overlay_is_open() {
        return;
    }
    let Some(handle) = HANDLE.get() else {
        return;
    };
    if let Ok(mut state) = handle.state.lock() {
        let ttl = Duration::from_millis(expires_at_ms.saturating_sub(now_ms()));
        state
            .cursors
            .entry(identity.clone())
            .and_modify(|c| {
                c.x = x;
                c.y = y;
                c.name = name.clone();
                c.expires_at = Instant::now() + ttl;
            })
            .or_insert_with(|| CursorEntry {
                identity,
                name,
                x,
                y,
                expires_at: Instant::now() + ttl,
            });
    }
    let _ = handle.proxy.send(UserEvent::Show); // kick redraw
}

pub fn cursor_overlay_clear(identity: String) {
    if !cursor_overlay_is_open() {
        return;
    }
    let Some(handle) = HANDLE.get() else {
        return;
    };
    if let Ok(mut state) = handle.state.lock() {
        state.cursors.remove(&identity);
    }
    // Request a redraw so removal is visible even while the event loop sleeps.
    let _ = handle.proxy.send(UserEvent::Show);
}

pub fn cursor_overlay_push_click(identity: String, x: f32, y: f32, expires_at_ms: u64) {
    if !cursor_overlay_is_open() {
        return;
    }
    let Some(handle) = HANDLE.get() else {
        return;
    };
    if let Ok(mut state) = handle.state.lock() {
        let now = Instant::now();
        let ttl = Duration::from_millis(expires_at_ms.saturating_sub(now_ms()));
        state.clicks.push(ClickEntry {
            identity,
            x,
            y,
            born_at: now,
            expires_at: now + ttl,
        });
    }
    let _ = handle.proxy.send(UserEvent::Show);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// SION_OVERLAY_OPEN=1 opens a diagnostic overlay with a synthetic cursor
/// and click, allowing window, SHM and rendering checks without a remote viewer.
pub fn maybe_autotest_open() {
    if std::env::var_os("SION_OVERLAY_OPEN").is_none() {
        return;
    }
    if !cursor_overlay_open() {
        log::warn!("[Sion][CursorOverlay] autotest : ouverture refusée");
        return;
    }
    let deadline = now_ms() + 120_000;
    cursor_overlay_push("autotest".into(), "autotest".into(), 0.35, 0.35, deadline);
    cursor_overlay_push_click("autotest".into(), 0.55, 0.55, deadline);
    log::info!("[Sion][CursorOverlay] autotest : overlay ouvert (curseur + clic factices)");
}

/// Convert premultiplied RGBA to BGRA in parallel. chunks_exact removes
/// bounds checks while preserving the scalar (a<<24)|(r<<16)|(g<<8)|b result.
fn repack_rgba_to_bgra_parallel(dst: &mut [u32], src: &[u8]) {
    let total = dst.len().min(src.len() / 4);
    if total == 0 {
        return;
    }
    let (dst, src) = (&mut dst[..total], &src[..total * 4]);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    if threads <= 1 || total < 4096 {
        repack_chunk(dst, src);
        return;
    }
    let chunk_px = total.div_ceil(threads);
    std::thread::scope(|s| {
        for (d, sc) in dst.chunks_mut(chunk_px).zip(src.chunks(chunk_px * 4)) {
            s.spawn(move || repack_chunk(d, sc));
        }
    });
}

fn repack_chunk(dst: &mut [u32], src: &[u8]) {
    for (d, s) in dst.iter_mut().zip(src.chunks_exact(4)) {
        let w = u32::from_le_bytes([s[0], s[1], s[2], s[3]]);
        *d = (w & 0xFF00FF00) | ((w & 0x00FF0000) >> 16) | ((w & 0x000000FF) << 16);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repack_parallel_identique_au_scalaire() {
        // Include dimensions that are not divisible by the thread count.
        let mut src = vec![0u8; 10007 * 4];
        for (i, b) in src.iter_mut().enumerate() {
            *b = (i.wrapping_mul(2654435761).wrapping_add(11) % 251) as u8;
        }
        let mut par = vec![0u32; 10007];
        repack_rgba_to_bgra_parallel(&mut par, &src);
        // Scalar reference implementation.
        for (i, d) in par.iter().enumerate() {
            let off = i * 4;
            let expected = ((src[off + 3] as u32) << 24)
                | ((src[off] as u32) << 16)
                | ((src[off + 1] as u32) << 8)
                | (src[off + 2] as u32);
            assert_eq!(*d, expected, "pixel {}", i);
        }
        // Empty input must be a no-op.
        let mut empty: Vec<u32> = Vec::new();
        repack_rgba_to_bgra_parallel(&mut empty, &[]);
        repack_rgba_to_bgra_parallel(&mut vec![0u32; 4], &[1, 2, 3]);
    }
}
