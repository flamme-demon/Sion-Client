//! Effets locaux avant publication : aucune dépendance à la webview.
mod accessories;
pub mod latest;
#[cfg(target_os = "linux")]
pub mod linux_camera;
#[cfg(test)]
mod tests;
mod vision;
pub use image::RgbaImage;
use image::{
    imageops::{self, FilterType},
    AnimationDecoder, ImageDecoder,
};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};
use vision::{Analysis, Face, PersonSegmenter, Worker, PERSON_SIZE};

#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundMode {
    #[default]
    None,
    Blur,
    Image,
    Aurora,
    Sion,
}
#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Filter {
    #[default]
    None,
    Mono,
    Cinema,
    Vhs,
    Pixel,
}
#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Accessory {
    #[default]
    None,
    Glasses,
    Moustache,
    Laugh,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub background: BackgroundMode,
    pub background_path: String,
    pub background_name: String,
    pub blur: u8,
    pub filter: Filter,
    pub light: bool,
    pub auto_frame: bool,
    pub outline: bool,
    pub accent: String,
    pub accessory: Accessory,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            background: BackgroundMode::None,
            background_path: String::new(),
            background_name: String::new(),
            blur: 12,
            filter: Filter::None,
            light: false,
            auto_frame: false,
            outline: false,
            accent: "#78c8b0".into(),
            accessory: Accessory::None,
        }
    }
}
impl Settings {
    pub fn enabled(&self) -> bool {
        self.background != BackgroundMode::None
            || self.filter != Filter::None
            || self.light
            || self.auto_frame
            || self.outline
            || self.accessory != Accessory::None
    }
    fn person(&self) -> bool {
        self.background != BackgroundMode::None || self.outline
    }
    fn face(&self) -> bool {
        self.auto_frame || self.accessory != Accessory::None
    }
}
struct Background {
    frames: Vec<(RgbaImage, u32)>,
    duration: u64,
}
impl Background {
    fn load(path: &str) -> Result<Self, String> {
        let data = std::fs::read(path).map_err(|e| format!("Fond webcam : {e}"))?;
        if data.len() > 40 * 1024 * 1024 {
            return Err("Le fond doit peser moins de 40 Mo.".into());
        }
        let mut frames = Vec::new();
        if image::guess_format(&data).ok() == Some(image::ImageFormat::Gif) {
            let mut decoder = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(data))
                .map_err(|e| e.to_string())?;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(4096);
            limits.max_image_height = Some(4096);
            limits.max_alloc = Some(96 * 1024 * 1024);
            decoder.set_limits(limits).map_err(|e| e.to_string())?;
            for frame in decoder.into_frames().take(80) {
                let frame = frame.map_err(|e| e.to_string())?;
                let (n, d) = frame.delay().numer_denom_ms();
                frames.push((
                    imageops::thumbnail(frame.buffer(), 320, 320),
                    (n / d.max(1)).clamp(40, 1000),
                ));
            }
        } else {
            let mut reader = image::ImageReader::new(std::io::Cursor::new(data))
                .with_guessed_format()
                .map_err(|e| e.to_string())?;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(8192);
            limits.max_image_height = Some(8192);
            limits.max_alloc = Some(96 * 1024 * 1024);
            reader.limits(limits);
            let img = reader
                .decode()
                .map_err(|e| format!("Image webcam illisible : {e}"))?
                .into_rgba8();
            frames.push((imageops::thumbnail(&img, 640, 640), 1000));
        }
        if frames.is_empty() {
            return Err("Le fond ne contient aucune image.".into());
        }
        let duration = frames.iter().map(|(_, ms)| *ms as u64).sum();
        Ok(Self { frames, duration })
    }
    fn frame(&self, ms: u64) -> &RgbaImage {
        let mut remaining = ms % self.duration.max(1);
        for (frame, duration) in &self.frames {
            if remaining < *duration as u64 {
                return frame;
            }
            remaining -= *duration as u64;
        }
        &self.frames[0].0
    }
}
struct Config {
    settings: Settings,
    background: Option<Arc<Background>>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ready: bool,
    pub error: Option<String>,
    pub render_ms: f32,
    pub analysis_ms: f32,
    pub capture_ms: f32,
    pub queue_ms: f32,
    pub fps: f32,
    pub dropped_frames: u64,
}
pub struct Control {
    config: RwLock<Arc<Config>>,
    pub status: Mutex<Status>,
}
impl Default for Control {
    fn default() -> Self {
        Self {
            config: RwLock::new(Arc::new(Config {
                settings: Settings::default(),
                background: None,
            })),
            status: Mutex::new(Status {
                ready: true,
                ..Default::default()
            }),
        }
    }
}
impl Control {
    pub fn settings(&self) -> Settings {
        self.config
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .settings
            .clone()
    }
    pub fn configure(&self, mut settings: Settings) -> Result<(), String> {
        settings.blur = settings.blur.clamp(4, 24);
        let old = self
            .config
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let background = if settings.background == BackgroundMode::Image {
            if settings.background_path.is_empty() {
                return Err("Choisis une image ou une vidéo pour ce fond.".into());
            }
            if old.settings.background_path == settings.background_path && old.background.is_some()
            {
                old.background.clone()
            } else {
                Some(Arc::new(Background::load(&settings.background_path)?))
            }
        } else {
            None
        };
        let waiting =
            settings.person() && !old.settings.person() || settings.face() && !old.settings.face();
        let simple = !settings.person() && !settings.face();
        *self.config.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(Config {
            settings,
            background,
        });
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        status.error = None;
        if simple {
            status.ready = true;
        } else if waiting {
            status.ready = false;
        }
        Ok(())
    }
}

struct Matte {
    source: Arc<Vec<f32>>,
    crop: [u32; 4],
    width: u32,
    height: u32,
    outline: bool,
    pixels: Vec<[f32; 2]>,
}
impl Matte {
    fn matches(
        &self,
        source: &Arc<Vec<f32>>,
        crop: [u32; 4],
        width: u32,
        height: u32,
        outline: bool,
    ) -> bool {
        Arc::ptr_eq(&self.source, source)
            && self.crop == crop
            && self.width == width
            && self.height == height
            && self.outline == outline
    }
    fn new(source: Arc<Vec<f32>>, crop: [u32; 4], width: u32, height: u32, outline: bool) -> Self {
        let coordinates = crop.map(|v| v as f32 / 2048.0);
        let d = 2.5 / width.min(height) as f32;
        let mut pixels = Vec::with_capacity((width * height) as usize);
        for y in 0..height {
            for x in 0..width {
                let (sx, sy) = (
                    coordinates[0] + x as f32 / width as f32 * coordinates[2],
                    coordinates[1] + y as f32 / height as f32 * coordinates[3],
                );
                let a = sample_mask(&source, sx, sy);
                let edge = if outline {
                    let around = [(sx - d, sy), (sx + d, sy), (sx, sy - d), (sx, sy + d)]
                        .iter()
                        .map(|&(x, y)| sample_mask(&source, x, y))
                        .fold(a, f32::max);
                    ((around - a) * 4.0).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                pixels.push([a, edge]);
            }
        }
        Self {
            source,
            crop,
            width,
            height,
            outline,
            pixels,
        }
    }
}
pub struct Processor {
    control: Arc<Control>,
    segmenter: Option<PersonSegmenter>,
    worker: Option<Worker>,
    submitted: Instant,
    started: Instant,
    face: Option<Face>,
    crop: [f32; 4],
    gain: f32,
    logo: Option<RgbaImage>,
    matte: Option<Matte>,
}
impl Processor {
    pub fn new(control: Arc<Control>) -> Self {
        let settings = control.settings();
        *control.status.lock().unwrap_or_else(|e| e.into_inner()) = Status {
            ready: !settings.person() && !settings.face(),
            ..Default::default()
        };
        Self {
            control,
            segmenter: None,
            worker: None,
            submitted: Instant::now() - Duration::from_secs(1),
            started: Instant::now(),
            face: None,
            crop: [0.0, 0.0, 1.0, 1.0],
            gain: 1.0,
            logo: None,
            matte: None,
        }
    }
    pub fn enabled(&mut self) -> bool {
        let enabled = self.control.settings().enabled();
        if !enabled {
            self.segmenter = None;
            self.worker = None;
            self.matte = None;
            self.face = None;
            self.crop = [0.0, 0.0, 1.0, 1.0];
            self.gain = 1.0;
        }
        enabled
    }
    pub fn process(&mut self, input: RgbaImage) -> RgbaImage {
        let start = Instant::now();
        let config = self
            .control
            .config
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let settings = &config.settings;
        if !settings.enabled() {
            self.enabled();
            return input;
        }
        let (w, h) = input.dimensions();
        let scale = (640.0 / w.max(h) as f32).min(1.0);
        let (ow, oh) = (
            ((w as f32 * scale) as u32 / 2 * 2).max(2),
            ((h as f32 * scale) as u32 / 2 * 2).max(2),
        );
        let image = if (w, h) == (ow, oh) {
            input
        } else {
            imageops::resize(&input, ow, oh, FilterType::Triangle)
        };
        let mut mask = None;
        let mut segmentation_ms = 0.0;
        let mut segmentation_error = None;
        if settings.person() {
            // Détourer cette image avant de la publier. Réutiliser un masque
            // d'une autre image révèle le fond derrière une main en mouvement.
            let started = Instant::now();
            let segmenter = self.segmenter.get_or_insert_with(PersonSegmenter::new);
            match segmenter.segment(tensor_input(&image, PERSON_SIZE, true)) {
                Ok(pixels) => mask = Some(Arc::new(pixels)),
                Err(error) => segmentation_error = Some(format!("Effets webcam : {error}")),
            }
            segmentation_ms = started.elapsed().as_secs_f32() * 1000.0;
        } else {
            self.segmenter = None;
        }
        let mut analysis = Analysis::default();
        if settings.face() {
            let worker = self.worker.get_or_insert_with(Worker::new);
            analysis = worker
                .result
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let interval =
                Duration::from_millis((analysis.elapsed_ms * 1.25).max(100.0).min(600.0) as u64);
            if self.submitted.elapsed() >= interval && analysis.error.is_none() {
                worker.submit(tensor_input(&image, 320, false));
                self.submitted = Instant::now();
            }
            if analysis
                .finished
                .is_some_and(|time| time.elapsed() < Duration::from_millis(800))
            {
                self.face = match (&self.face, &analysis.face) {
                    (Some(old), Some(new)) => Some(smooth_face(old, new, 0.35)),
                    (_, face) => face.clone(),
                };
            } else {
                self.face = None;
            }
        } else {
            self.worker = None;
            self.face = None;
        }
        let target = if settings.auto_frame {
            self.face
                .as_ref()
                .map(face_crop)
                .unwrap_or([0.0, 0.0, 1.0, 1.0])
        } else {
            [0.0, 0.0, 1.0, 1.0]
        };
        for (old, next) in self.crop.iter_mut().zip(target) {
            *old += (next - *old) * 0.1;
        }
        let crop = self.crop;
        let mut output = crop_frame(&image, crop);
        let ms = self.started.elapsed().as_millis() as u64;
        if settings.person() {
            let crop_key = crop.map(|value| (value * 2048.0).round() as u32);
            if let Some(mask) = &mask {
                if !self
                    .matte
                    .as_ref()
                    .is_some_and(|matte| matte.matches(mask, crop_key, ow, oh, settings.outline))
                {
                    self.matte = Some(Matte::new(mask.clone(), crop_key, ow, oh, settings.outline));
                }
            } else {
                self.matte = None;
            }
            let backdrop = match settings.background {
                BackgroundMode::Blur => {
                    let small = imageops::thumbnail(&output, 160, 160);
                    Some(imageops::fast_blur(&small, settings.blur as f32))
                }
                BackgroundMode::Image => config.background.as_ref().map(|bg| bg.frame(ms).clone()),
                BackgroundMode::Aurora | BackgroundMode::Sion => {
                    Some(aurora(ms, settings.background == BackgroundMode::Sion))
                }
                BackgroundMode::None => None,
            };
            let background_crop = backdrop
                .as_ref()
                .map(|image| cover_coordinates(image, ow, oh));
            let color = accent(&settings.accent);
            for y in 0..oh {
                for x in 0..ow {
                    // L'interpolation et le contour sont calculés une fois
                    // pour cette image, avant le mélange de ses pixels.
                    let [a, edge] = self
                        .matte
                        .as_ref()
                        .map_or([0.0, 0.0], |matte| matte.pixels[(y * ow + x) as usize]);
                    let foreground = output.get_pixel_mut(x, y);
                    if let Some(background) = &backdrop {
                        let [bx, by, bw, bh] = background_crop.unwrap();
                        let bg = sample_pixel(
                            background,
                            bx + x as f32 / ow as f32 * bw,
                            by + y as f32 / oh as f32 * bh,
                        );
                        for c in 0..3 {
                            foreground[c] =
                                (foreground[c] as f32 * a + bg[c] as f32 * (1.0 - a)) as u8;
                        }
                    }
                    if settings.outline {
                        for c in 0..3 {
                            foreground[c] = (foreground[c] as f32 * (1.0 - edge)
                                + color[c] as f32 * edge)
                                as u8;
                        }
                    }
                }
            }
            if settings.background == BackgroundMode::Sion {
                if self.logo.is_none() {
                    self.logo = image::load_from_memory(include_bytes!(
                        "../../../public/branding/logo.webp"
                    ))
                    .ok()
                    .map(|img| imageops::resize(&img.into_rgba8(), 48, 48, FilterType::Triangle));
                }
                if let Some(logo) = &self.logo {
                    imageops::overlay(&mut output, logo, 12, oh.saturating_sub(60) as i64);
                }
            }
        } else {
            self.matte = None;
        }
        if settings.light {
            let sum: f32 = output
                .pixels()
                .step_by(32)
                .map(|p| {
                    (p[0] as f32 * 0.2126 + p[1] as f32 * 0.7152 + p[2] as f32 * 0.0722) / 255.0
                })
                .sum();
            let average = sum / ((ow * oh + 31) / 32) as f32;
            let target = (0.48 / average.max(0.08)).clamp(0.85, 1.8);
            self.gain += (target - self.gain) * 0.08;
        } else {
            self.gain = 1.0;
        }
        if settings.filter != Filter::None || self.gain != 1.0 {
            apply_filter(&mut output, settings.filter, self.gain, ms);
        }
        if let Some(face) = self
            .face
            .as_ref()
            .filter(|_| settings.accessory != Accessory::None)
        {
            accessories::draw(&mut output, &mapped_face(face, crop), settings.accessory);
        }
        let mut status = self
            .control
            .status
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        status.ready =
            (!settings.person() || mask.is_some()) && (!settings.face() || analysis.face_analyzed);
        status.error = segmentation_error.or(analysis.error);
        status.analysis_ms = segmentation_ms + analysis.elapsed_ms;
        status.render_ms = (start.elapsed().as_secs_f32() * 1000.0 - segmentation_ms).max(0.0);
        output
    }
}

fn tensor_input(image: &RgbaImage, side: usize, person: bool) -> Vec<f32> {
    let small = imageops::resize(image, side as u32, side as u32, FilterType::Triangle);
    let mut values = vec![0.0; 3 * side * side];
    for (i, p) in small.pixels().enumerate() {
        for c in 0..3 {
            values[c * side * side + i] = if person {
                p[c] as f32 / 255.0
            } else {
                p[2 - c] as f32
            };
        }
    }
    values
}
fn smooth_face(old: &Face, new: &Face, a: f32) -> Face {
    let mut result = new.clone();
    for i in 0..4 {
        result.rect[i] = old.rect[i] * (1.0 - a) + new.rect[i] * a;
    }
    for i in 0..5 {
        for j in 0..2 {
            result.points[i][j] = old.points[i][j] * (1.0 - a) + new.points[i][j] * a;
        }
    }
    result
}
fn face_crop(face: &Face) -> [f32; 4] {
    let size = (face.rect[2] * 3.8).clamp(0.6, 1.0);
    [
        (face.rect[0] + face.rect[2] / 2.0 - size / 2.0).clamp(0.0, 1.0 - size),
        (face.rect[1] + face.rect[3] * 0.7 - size * 0.4).clamp(0.0, 1.0 - size),
        size,
        size,
    ]
}
fn mapped_face(face: &Face, crop: [f32; 4]) -> Face {
    let mut result = face.clone();
    result.rect = [
        (face.rect[0] - crop[0]) / crop[2],
        (face.rect[1] - crop[1]) / crop[3],
        face.rect[2] / crop[2],
        face.rect[3] / crop[3],
    ];
    for p in &mut result.points {
        p[0] = (p[0] - crop[0]) / crop[2];
        p[1] = (p[1] - crop[1]) / crop[3];
    }
    result
}
fn crop_frame(image: &RgbaImage, crop: [f32; 4]) -> RgbaImage {
    let (w, h) = image.dimensions();
    let x = (crop[0] * w as f32) as u32;
    let y = (crop[1] * h as f32) as u32;
    let cw = ((crop[2] * w as f32) as u32).max(1).min(w - x.min(w - 1));
    let ch = ((crop[3] * h as f32) as u32).max(1).min(h - y.min(h - 1));
    if x == 0 && y == 0 && cw == w && ch == h {
        image.clone()
    } else {
        imageops::resize(
            &imageops::crop_imm(image, x.min(w - 1), y.min(h - 1), cw, ch).to_image(),
            w,
            h,
            FilterType::Triangle,
        )
    }
}
fn cover_coordinates(image: &RgbaImage, w: u32, h: u32) -> [f32; 4] {
    let scale = (w as f32 / image.width() as f32).max(h as f32 / image.height() as f32);
    let (cw, ch) = (
        w as f32 / (image.width() as f32 * scale),
        h as f32 / (image.height() as f32 * scale),
    );
    [(1.0 - cw) / 2.0, (1.0 - ch) / 2.0, cw, ch]
}
fn sample_pixel(image: &RgbaImage, x: f32, y: f32) -> [u8; 4] {
    image
        .get_pixel(
            (x.clamp(0.0, 0.9999) * image.width() as f32) as u32,
            (y.clamp(0.0, 0.9999) * image.height() as f32) as u32,
        )
        .0
}
fn sample_mask(mask: &[f32], x: f32, y: f32) -> f32 {
    let last = PERSON_SIZE - 1;
    let (x, y) = (
        x.clamp(0.0, 1.0) * last as f32,
        y.clamp(0.0, 1.0) * last as f32,
    );
    let (ix, iy) = (x as usize, y as usize);
    let (a, b) = (x - ix as f32, y - iy as f32);
    let index = iy * PERSON_SIZE + ix;
    let right = iy * PERSON_SIZE + (ix + 1).min(last);
    let down = (iy + 1).min(last) * PERSON_SIZE + ix;
    let diagonal = (iy + 1).min(last) * PERSON_SIZE + (ix + 1).min(last);
    (mask[index] * (1.0 - a) + mask[right] * a) * (1.0 - b)
        + (mask[down] * (1.0 - a) + mask[diagonal] * a) * b
}
fn accent(hex: &str) -> [u8; 3] {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return [120, 200, 176];
    }
    [
        u8::from_str_radix(&h[0..2], 16).unwrap_or(120),
        u8::from_str_radix(&h[2..4], 16).unwrap_or(200),
        u8::from_str_radix(&h[4..6], 16).unwrap_or(176),
    ]
}
fn aurora(ms: u64, sion: bool) -> RgbaImage {
    let t = ms as f32 / 3000.0;
    RgbaImage::from_fn(160, 90, |x, y| {
        let (x, y) = (x as f32 / 160.0, y as f32 / 90.0);
        let a = ((x * 5.0 + y * 3.0 + t).sin() * 0.5 + 0.5) * 0.5;
        let b = ((x * 3.0 - y * 5.0 - t * 0.7).sin() * 0.5 + 0.5) * 0.5;
        if sion {
            image::Rgba([
                (15.0 + 25.0 * b) as u8,
                (28.0 + 80.0 * a) as u8,
                (35.0 + 65.0 * a + 30.0 * b) as u8,
                255,
            ])
        } else {
            image::Rgba([
                (25.0 + 120.0 * b) as u8,
                (25.0 + 140.0 * a) as u8,
                (65.0 + 100.0 * a) as u8,
                255,
            ])
        }
    })
}
fn apply_filter(image: &mut RgbaImage, filter: Filter, gain: f32, ms: u64) {
    if filter == Filter::Pixel {
        let (w, h) = image.dimensions();
        let small = imageops::resize(
            image,
            (w / 12).max(1),
            (h / 12).max(1),
            FilterType::Triangle,
        );
        *image = imageops::resize(&small, w, h, FilterType::Nearest);
    }
    let width = image.width();
    for (i, p) in image.pixels_mut().enumerate() {
        let mut rgb = [p[0] as f32 * gain, p[1] as f32 * gain, p[2] as f32 * gain];
        match filter {
            Filter::Mono => {
                let y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
                rgb = [y; 3];
            }
            Filter::Cinema => {
                rgb[0] = rgb[0] * 1.08 + 5.0;
                rgb[1] = rgb[1] * 1.02 + 2.0;
                rgb[2] = rgb[2] * 0.9 + 7.0;
            }
            Filter::Vhs => {
                let row = i as u32 / width;
                let hash = (i as u64)
                    .wrapping_mul(1664525)
                    .wrapping_add(ms / 50 * 1013904223);
                let noise = ((hash >> 8) % 17) as f32 - 8.0;
                for c in &mut rgb {
                    *c = *c * (if row % 3 == 0 { 0.87 } else { 1.0 }) + noise;
                }
                rgb[0] += 6.0;
                rgb[2] += 10.0;
            }
            _ => {}
        }
        for c in 0..3 {
            p[c] = rgb[c].clamp(0.0, 255.0) as u8;
        }
    }
}

/// Le fichier est décodé avant de remplacer la configuration courante.
pub fn validate_background(path: &Path) -> Result<(), String> {
    Background::load(&path.to_string_lossy()).map(|_| ())
}

pub fn encode_video_frames(folder: &Path, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut encoder = image::codecs::gif::GifEncoder::new_with_speed(file, 15);
    encoder
        .set_repeat(image::codecs::gif::Repeat::Infinite)
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    for i in 0..60 {
        let path = folder.join(format!("{i}.png"));
        if !path.is_file() {
            break;
        }
        let image = image::open(&path).map_err(|e| e.to_string())?.into_rgba8();
        encoder
            .encode_frame(image::Frame::from_parts(
                imageops::thumbnail(&image, 320, 320),
                0,
                0,
                image::Delay::from_numer_denom_ms(100, 1),
            ))
            .map_err(|e| e.to_string())?;
        count += 1;
    }
    if count == 0 {
        return Err("La vidéo ne contient pas d'image lisible.".into());
    }
    Ok(())
}
