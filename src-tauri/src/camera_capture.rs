//! Capture caméra locale : I420 natif → source WebRTC, jamais par la webview.
//! L'aperçu ne publie rien ; le moteur décide séparément de la publication.
use livekit::webrtc::video_frame::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_frame::{VideoBuffer, native::VideoFrameBufferExt};
use livekit::webrtc::video_source::native::NativeVideoSource;
use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};

pub const PREVIEW_KEY: &str = "camera:local-preview";
static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
pub fn camera_key(identity: &str) -> String { format!("camera:{identity}") }

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevice { pub id: String, pub label: String, pub front: bool }

pub struct CameraCapture {
    pub ready: Arc<AtomicBool>,
    pub error: Arc<Mutex<Option<String>>>,
    pub device: CameraDevice,
    pub started: std::time::Instant,
    token: u64,
    stopping: Arc<AtomicBool>,
    #[cfg(not(target_os = "android"))]
    child: Arc<Mutex<std::process::Child>>,
    #[cfg(not(target_os = "android"))]
    reader: Option<std::thread::JoinHandle<()>>,
    #[cfg(not(target_os = "android"))]
    processor: Option<std::thread::JoinHandle<()>>,
}

#[cfg(target_os = "linux")]
pub fn devices(_ffmpeg: &str) -> Result<Vec<CameraDevice>, String> {
    use std::os::fd::AsRawFd;
    #[repr(C)]
    struct Caps { driver: [u8; 16], card: [u8; 32], bus: [u8; 32], version: u32, caps: u32, device_caps: u32, reserved: [u32; 3] }
    extern "C" { fn ioctl(fd: std::os::raw::c_int, request: std::os::raw::c_ulong, ...) -> std::os::raw::c_int; }
    let mut result = Vec::new();
    let Ok(entries) = std::fs::read_dir("/sys/class/video4linux") else { return Ok(result) };
    for entry in entries.flatten() {
        let id = format!("/dev/{}", entry.file_name().to_string_lossy());
        let Ok(file) = std::fs::File::open(&id) else { continue };
        let mut caps = Caps { driver: [0; 16], card: [0; 32], bus: [0; 32], version: 0, caps: 0, device_caps: 0, reserved: [0; 3] };
        // VIDIOC_QUERYCAP : ne capture aucune image. Écarte les nœuds de
        // métadonnées que les webcams UVC exposent à côté de leur caméra.
        if unsafe { ioctl(file.as_raw_fd(), 0x80685600, &mut caps) } < 0 { continue }
        let bits = if caps.caps & 0x80000000 != 0 { caps.device_caps } else { caps.caps };
        if bits & (1 | 0x1000) == 0 { continue }
        let label = std::fs::read_to_string(entry.path().join("name")).unwrap_or_else(|_| id.clone()).trim().to_owned();
        result.push(CameraDevice { id, label, front: false });
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn devices(ffmpeg: &str) -> Result<Vec<CameraDevice>, String> {
    #[cfg(target_os = "windows")]
    let args = ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"];
    #[cfg(target_os = "macos")]
    let args = ["-hide_banner", "-list_devices", "true", "-f", "avfoundation", "-i", ""];
    let output = crate::hidden_command(ffmpeg).args(args).stdin(std::process::Stdio::null()).output().map_err(|e| format!("Caméras indisponibles : {e}"))?;
    Ok(parse_devices(&String::from_utf8_lossy(&output.stderr)))
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
fn parse_devices(output: &str) -> Vec<CameraDevice> {
    let mut result: Vec<CameraDevice> = Vec::new();
    let mut av_video = false;
    let mut dshow_video = false;
    let mut last_video: Option<usize> = None;
    for line in output.lines() {
        if line.contains("DirectShow video devices") { dshow_video = true; continue }
        if line.contains("DirectShow audio devices") { dshow_video = false; last_video = None; continue }
        if line.contains("(audio)") { last_video = None; }
        if line.contains("Alternative name") {
            if let (Some(index), Some(id)) = (last_video, line.split('"').nth(1)) { result[index].id = id.into(); }
            continue;
        }
        if line.contains("AVFoundation video devices:") { av_video = true; continue }
        if line.contains("AVFoundation audio devices:") { av_video = false; }
        if line.contains("(video)") || dshow_video {
            if let Some(label) = line.split('"').nth(1) { result.push(CameraDevice { id: label.into(), label: label.into(), front: false }); last_video = Some(result.len() - 1); }
        } else if av_video {
            if let Some((_, suffix)) = line.split_once("] [") {
                if let Some((index, label)) = suffix.split_once("] ") {
                    if index.parse::<u32>().is_ok() && !label.starts_with("Capture screen") { result.push(CameraDevice { id: index.into(), label: label.into(), front: false }); }
                }
            }
        }
    }
    result
}

#[cfg(not(target_os = "android"))]
impl CameraCapture {
    pub fn start(device: CameraDevice, ffmpeg: &str, source: NativeVideoSource) -> Result<Self, String> {
        use std::io::{BufRead, Read};
        use std::process::Stdio;
        let mut cmd = crate::hidden_command(ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
        #[cfg(target_os = "linux")]
        {
            cmd.args(["-f", "v4l2"]);
            if let Some(mode) = sion_camera_effects::linux_camera::mode(&device.id) {
                cmd.args(["-input_format", mode.format, "-video_size", &format!("{}x{}",mode.width,mode.height), "-framerate", &mode.fps.to_string()]);
                log::info!("[Sion][caméra] capture {} {}x{} à {:.1} im/s",mode.format,mode.width,mode.height,mode.fps);
            }
            cmd.args(["-i", &device.id]);
        }
        #[cfg(target_os = "windows")]
        cmd.args(["-f", "dshow", "-i", &format!("video={}", device.id)]);
        #[cfg(target_os = "macos")]
        cmd.args(["-f", "avfoundation", "-framerate", "30", "-i", &format!("{}:none", device.id)]);
        // Cadre 720p/30, ratio conservé ; aucune capture audio supplémentaire.
        cmd.args(["-an", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"]);
        let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Impossible d'ouvrir la caméra : {e}"))?;
        let mut stdout = child.stdout.take().ok_or("Flux caméra absent")?;
        let stderr = child.stderr.take().ok_or("Journal caméra absent")?;
        let child = Arc::new(Mutex::new(child));
        let ready = Arc::new(AtomicBool::new(false));
        let stopping = Arc::new(AtomicBool::new(false));
        let token = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let error = Arc::new(Mutex::new(None));
        let err = error.clone();
        // Vider stderr évite un blocage du sous-processus ; ne conserver
        // qu'une erreur courte, sans accumulation de journal en mémoire.
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() { *err.lock().unwrap_or_else(|e| e.into_inner()) = Some(line.chars().take(300).collect()); }
            }
        });
        let frames = Arc::new(sion_camera_effects::latest::Latest::<(Vec<u8>,std::time::Instant)>::default());
        let queue = frames.clone();
        let first = ready.clone();
        let stopped = stopping.clone();
        let processor = match std::thread::Builder::new().name("sion-camera-effects".into()).spawn(move || {
            let control=crate::camera_effects::control();
            let mut effects=sion_camera_effects::Processor::new(control.clone());
            let mut count=0u32;let mut since=std::time::Instant::now();let mut fps=0.0;
            while let Some((bytes,captured))=queue.take() {
                if stopped.load(Ordering::Acquire) { break }
                let start=std::time::Instant::now();
                let queue_ms=captured.elapsed().as_secs_f32()*1000.0;
                deliver_i420(&source, &bytes, 1280, 720, 0, &mut effects);
                first.store(true, Ordering::Release);
                count+=1;
                if since.elapsed().as_secs_f32()>=1.0 { fps=count as f32/since.elapsed().as_secs_f32();count=0;since=std::time::Instant::now(); }
                {let mut status=control.status.lock().unwrap_or_else(|e|e.into_inner());status.capture_ms=start.elapsed().as_secs_f32()*1000.0;status.queue_ms=queue_ms;status.fps=fps;status.dropped_frames=queue.dropped();}
                queue.recycle((bytes,captured));
            }
        }) {
            Ok(processor)=>processor,
            Err(e)=>{let mut c=child.lock().unwrap_or_else(|e|e.into_inner());let _=c.kill();let _=c.wait();return Err(format!("Traitement caméra : {e}"));}
        };
        let queue = frames.clone();
        let stopped = stopping.clone();
        let err = error.clone();
        let reader = match std::thread::Builder::new().name("sion-camera-read".into()).spawn(move || {
            let mut bytes = vec![0; 1280 * 720 * 3 / 2];
            while stdout.read_exact(&mut bytes).is_ok() {
                bytes=queue.push((bytes,std::time::Instant::now())).map(|(bytes,_)|bytes).unwrap_or_else(||vec![0;1280*720*3/2]);
            }
            queue.close();
            if !stopped.load(Ordering::Acquire) {
                err.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert("La caméra a cessé de transmettre.".into());
                std::thread::spawn(move || crate::voice_native::camera_failed(token));
            }
        }) {
            Ok(reader) => reader,
            Err(e) => { let mut c = child.lock().unwrap_or_else(|e| e.into_inner()); let _ = c.kill(); let _ = c.wait();frames.close();let _=processor.join();return Err(format!("Capture caméra : {e}")); }
        };
        Ok(Self { ready, error, device, started: std::time::Instant::now(), token, stopping, child, reader: Some(reader), processor: Some(processor) })
    }
}

impl Drop for CameraCapture {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        #[cfg(not(target_os = "android"))]
        {
            let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
            let _ = child.kill();
            let _ = child.wait();
            drop(child);
            if let Some(reader) = self.reader.take() { let _ = reader.join(); }
            if let Some(processor) = self.processor.take() { let _ = processor.join(); }
        }
        #[cfg(target_os = "android")]
        android::stop(self.token);
    }
}

impl CameraCapture { pub fn matches_token(&self, token: u64) -> bool { self.token == token } }

pub fn deliver_i420(source: &NativeVideoSource, bytes: &[u8], width: u32, height: u32, rotation: i32, effects: &mut sion_camera_effects::Processor) {
    if width < 2 || height < 2 || width > 1920 || height > 1920 || width % 2 != 0 || height % 2 != 0 { return }
    let y = (width * height) as usize;
    if bytes.len() != y * 3 / 2 { return }
    let mut buffer = I420Buffer::with_strides(width, height, width, width / 2, width / 2);
    let (dy, du, dv) = buffer.data_mut();
    dy.copy_from_slice(&bytes[..y]); du.copy_from_slice(&bytes[y..y + y / 4]); dv.copy_from_slice(&bytes[y + y / 4..]);
    // Appliquer la rotation aux pixels : le rendu natif lit les plans I420.
    if rotation == 90 || rotation == 180 || rotation == 270 {
        let (rw, rh) = if rotation == 180 { (width, height) } else { (height, width) };
        let mut rotated = I420Buffer::with_strides(rw, rh, rw, rw / 2, rw / 2);
        let (ry, ru, rv) = rotated.data_mut();
        let (sy, su, sv) = buffer.data();
        for (src, dst, w, h) in [(sy, ry, width as usize, height as usize), (su, ru, width as usize / 2, height as usize / 2), (sv, rv, width as usize / 2, height as usize / 2)] {
            for y in 0..h { for x in 0..w {
                let index = match rotation { 90 => x * h + h - 1 - y, 180 => (h - 1 - y) * w + w - 1 - x, _ => (w - 1 - x) * h + y };
                dst[index] = src[y * w + x];
            } }
        }
        buffer = rotated;
    }
    if effects.enabled() {
        use livekit::webrtc::video_frame::VideoFormatType;
        // Réduire les plans YUV en SIMD avant la conversion RGBA ; le
        // détourage ne travaille déjà que sur un côté de 640 pixels.
        let scale=(640.0/buffer.width().max(buffer.height()) as f32).min(1.0);
        let (w,h)=(((buffer.width() as f32*scale) as u32/2*2).max(2),((buffer.height() as f32*scale) as u32/2*2).max(2));
        if (w,h)!=(buffer.width(),buffer.height()) { buffer=buffer.scale(w as i32,h as i32); }
        let (width,height)=(buffer.width(),buffer.height());
        let mut rgba=vec![0; (width*height*4) as usize];
        buffer.to_argb(VideoFormatType::ABGR,&mut rgba,width*4,width as i32,height as i32);
        if let Some(image)=sion_camera_effects::RgbaImage::from_raw(width,height,rgba) {
            let processed=effects.process(image);let (w,h)=processed.dimensions();
            let mut output=I420Buffer::with_strides(w,h,w,w/2,w/2);let (y,u,v)=output.data_mut();
            livekit::webrtc::native::yuv_helper::abgr_to_i420(processed.as_raw(),w*4,y,w,u,w/2,v,w/2,w as i32,h as i32);
            buffer=output;
        }
    }
    source.capture_frame(&VideoFrame::new(VideoRotation::VideoRotation0, buffer));
}

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::devices;
#[cfg(target_os = "android")]
pub use android::init as initialiser_android;
#[cfg(target_os = "android")]
pub use android::normaliser_video;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn camera_et_partage_du_meme_participant_ont_des_flux_distincts() {
        let identity = "@membre:example.org:appareil";
        assert_ne!(camera_key(identity), identity);
        assert_ne!(camera_key(identity), PREVIEW_KEY);
    }
    #[test]
    fn liste_dshow_ne_confond_pas_les_micros_avec_les_webcams() {
        let output = "[dshow @ 0] \"USB Camera\" (video)\n[dshow @ 0] Alternative name \"@device_pnp_camera\"\n[dshow @ 0] \"Microphone\" (audio)";
        let devices = parse_devices(output);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "@device_pnp_camera");
        assert_eq!(devices[0].label, "USB Camera");
    }
    #[test]
    fn liste_avfoundation_ecarte_ecrans_et_entrees_audio() {
        let output = "[AVFoundation indev @ 0] AVFoundation video devices:\n[AVFoundation indev @ 0] [0] FaceTime HD Camera\n[AVFoundation indev @ 0] [1] Capture screen 0\n[AVFoundation indev @ 0] AVFoundation audio devices:\n[AVFoundation indev @ 0] [0] Built-in Microphone";
        let devices = parse_devices(output);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "0");
    }
}
