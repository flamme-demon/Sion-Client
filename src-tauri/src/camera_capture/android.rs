use super::*;
use jni::{objects::{GlobalRef, JByteArray, JClass, JObject, JString, JValue}, JNIEnv, JavaVM};
use std::sync::OnceLock;

struct Bridge { vm: JavaVM, class: GlobalRef }
static BRIDGE: OnceLock<Bridge> = OnceLock::new();
struct Sink { token: u64, source: NativeVideoSource, ready: Arc<AtomicBool>, error: Arc<Mutex<Option<String>>>, effects: Arc<Mutex<sion_camera_effects::Processor>> }
static SINK: Mutex<Option<Sink>> = Mutex::new(None);

pub fn init(env: &mut JNIEnv) -> Result<(), String> {
    let class = env.find_class("com/sion/client/CameraBridge").map_err(|e| e.to_string())?;
    let bridge = Bridge { vm: env.get_java_vm().map_err(|e| e.to_string())?, class: env.new_global_ref(class).map_err(|e| e.to_string())? };
    let _ = BRIDGE.set(bridge);
    Ok(())
}

fn with_bridge<T>(action: impl FnOnce(&mut JNIEnv, &JClass) -> Result<T, String>) -> Result<T, String> {
    let bridge = BRIDGE.get().ok_or("Caméra Android indisponible.")?;
    let mut env = bridge.vm.attach_current_thread().map_err(|e| e.to_string())?;
    let class: &JClass = bridge.class.as_obj().into();
    let result = action(&mut env, class);
    if env.exception_check().unwrap_or(false) { let _ = env.exception_clear(); return Err("La caméra Android n'a pas pu être ouverte.".into()) }
    result
}

pub fn devices(_ffmpeg: &str) -> Result<Vec<CameraDevice>, String> {
    with_bridge(|env, class| {
        let raw = env.call_static_method(class, "lister", "()Ljava/lang/String;", &[]).and_then(|v| v.l()).map_err(|e| e.to_string())?;
        let value: String = env.get_string(&JString::from(raw)).map_err(|e| e.to_string())?.into();
        serde_json::from_str(&value).map_err(|e| e.to_string())
    })
}

impl CameraCapture {
    pub fn start(device: CameraDevice, _ffmpeg: &str, source: NativeVideoSource) -> Result<Self, String> {
        let token = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let ready = Arc::new(AtomicBool::new(false));
        let error = Arc::new(Mutex::new(None));
        *SINK.lock().unwrap_or_else(|e| e.into_inner()) = Some(Sink { token, source, ready: ready.clone(), error: error.clone(), effects: Arc::new(Mutex::new(sion_camera_effects::Processor::new(crate::camera_effects::control()))) });
        let result = with_bridge(|env, class| {
            let id = env.new_string(&device.id).map_err(|e| e.to_string())?;
            let error = env.call_static_method(class, "demarrer", "(Ljava/lang/String;J)Ljava/lang/String;", &[JValue::Object(&JObject::from(id)), JValue::Long(token as i64)]).and_then(|v| v.l()).map_err(|e| e.to_string())?;
            let error: String = env.get_string(&JString::from(error)).map_err(|e| e.to_string())?.into();
            if error.is_empty() { Ok(()) } else { Err(error) }
        });
        if let Err(e) = result { stop(token); return Err(e) }
        Ok(Self { ready, error, device, started: std::time::Instant::now(), token, stopping: Arc::new(AtomicBool::new(false)) })
    }
}

pub fn stop(token: u64) {
    let mut sink = SINK.lock().unwrap_or_else(|e| e.into_inner());
    if !sink.as_ref().is_some_and(|s| s.token == token) { return }
    sink.take(); drop(sink);
    let _ = with_bridge(|env, class| env.call_static_method(class, "arreter", "(J)V", &[JValue::Long(token as i64)]).map(|_| ()).map_err(|e| e.to_string()));
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_CameraBridge_frame(env: JNIEnv, _class: JClass, token: jni::sys::jlong, bytes: JByteArray, width: jni::sys::jint, height: jni::sys::jint, rotation: jni::sys::jint) {
    let current = SINK.lock().ok().and_then(|s| s.as_ref().filter(|s| s.token == token as u64).map(|s| (s.source.clone(), s.ready.clone(), s.effects.clone())));
    if let Some((source, ready, effects)) = current {
        if let Ok(bytes) = env.convert_byte_array(bytes) {
            deliver_i420(&source, &bytes, width as u32, height as u32, rotation, &mut effects.lock().unwrap_or_else(|e|e.into_inner()));
            ready.store(true, Ordering::Release);
        }
    }
}

pub fn normaliser_video(input:&std::path::Path,output:&std::path::Path)->Result<(),String>{
    let frames=output.with_extension("frames");std::fs::create_dir_all(&frames).map_err(|e|e.to_string())?;
    let result=with_bridge(|env,class|{
        let input=env.new_string(input.to_string_lossy()).map_err(|e|e.to_string())?;
        let folder=env.new_string(frames.to_string_lossy()).map_err(|e|e.to_string())?;
        let error=env.call_static_method(class,"normaliserFondVideo","(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",&[JValue::Object(&JObject::from(input)),JValue::Object(&JObject::from(folder))]).and_then(|v|v.l()).map_err(|e|e.to_string())?;
        let error:String=env.get_string(&JString::from(error)).map_err(|e|e.to_string())?.into();if error.is_empty(){Ok(())}else{Err(error)}
    }).and_then(|_|sion_camera_effects::encode_video_frames(&frames,output));
    let _=std::fs::remove_dir_all(frames);result
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_CameraBridge_failure(mut env: JNIEnv, _class: JClass, token: jni::sys::jlong, message: JString) {
    if let Ok(message) = env.get_string(&message) {
        if let Some(s) = SINK.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|s| s.token == token as u64) {
            *s.error.lock().unwrap_or_else(|e| e.into_inner()) = Some(message.into());
            let token = token as u64;
            std::thread::spawn(move || crate::voice_native::camera_failed(token));
        }
    }
}
