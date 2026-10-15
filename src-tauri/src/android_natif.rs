//! Initialisations Java d'Android, appelées par `SionNatif.initialiser`
//! (Kotlin) au tout début de `MainActivity.onCreate`, avant que Tauri ne
//! démarre quoi que ce soit (docs/plan-android-2.1.md, étapes A0 et A2).
//!
//! - **TLS** : `matrix-sdk` (reqwest 0.13) vérifie les certificats avec le
//!   magasin du système par `rustls-platform-verifier`, qui passe par un petit
//!   composant Kotlin (dépendance Gradle `org.rustls:rustls-platform-verifier`)
//!   et doit être initialisé avant la première requête : sans lui, aucune
//!   connexion au serveur Matrix n'aboutit.
//! - **WebRTC** : micro et haut-parleur passent par les classes Java de
//!   libwebrtc (`libwebrtc.jar`), qui veulent la JavaVM et le Context de
//!   l'appli.

use std::sync::Mutex;
static AUDIO_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();
static AUDIO_CONTEXT: std::sync::OnceLock<jni::objects::GlobalRef> = std::sync::OnceLock::new();
pub(crate) fn audio_vm() -> Option<&'static jni::JavaVM> { AUDIO_VM.get() }

/// Check before constructing a recorder: OpenSL ES cannot safely tear down a
/// recorder whose initialization failed because Android denied microphone access.
pub(crate) fn verifier_permission_micro() -> Result<(), String> {
    let vm = audio_vm().ok_or("interface audio Android indisponible")?;
    let context = AUDIO_CONTEXT.get().ok_or("contexte audio Android indisponible")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let permission = env.new_string("android.permission.RECORD_AUDIO").map_err(|e| e.to_string())?;
    let status = env.call_method(context.as_obj(), "checkSelfPermission", "(Ljava/lang/String;)I",
        &[jni::objects::JValue::Object(permission.as_ref())])
        .and_then(|v| v.i()).map_err(|e| e.to_string())?;
    if status == 0 { Ok(()) } else { Err("autorisation du micro refusée".into()) }
}

use jni::objects::{JClass, JObject};
use jni::JNIEnv;

/// L'initialisation précède le journal de Tauri : ses messages attendent ici
/// que `journaliser_initialisation` les écrive.
static RAPPORT: Mutex<Vec<(log::Level, String)>> = Mutex::new(Vec::new());

fn noter(niveau: log::Level, message: String) {
    RAPPORT.lock().unwrap_or_else(|e| e.into_inner()).push((niveau, message));
}

/// Écrit dans le journal ce que l'initialisation a noté (appelé une fois le
/// journal de Tauri installé).
pub fn journaliser_initialisation() {
    for (niveau, message) in RAPPORT.lock().unwrap_or_else(|e| e.into_inner()).drain(..) {
        log::log!(niveau, "{message}");
    }
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_initialiser<'local>(
    mut env: JNIEnv<'local>,
    _classe: JClass<'local>,
    contexte: JObject<'local>,
) {
    if let Ok(vm) = env.get_java_vm() { let _ = AUDIO_VM.set(vm); }
    // Keep only the application context for process-wide permission checks.
    if let Ok(context) = env.call_method(&contexte, "getApplicationContext", "()Landroid/content/Context;", &[])
        .and_then(|v| v.l()).and_then(|context| env.new_global_ref(context)) {
        let _ = AUDIO_CONTEXT.set(context);
    }
    initialiser_tls(&env, &contexte);
    #[cfg(feature = "native-voice")]
    initialiser_webrtc(&env, &contexte);
    #[cfg(feature = "native-voice")]
    if let Err(error) = crate::camera_capture::initialiser_android(&mut env) {
        noter(log::Level::Error, format!("[Sion][android] caméra : {error}"));
    }
}

fn initialiser_tls(env: &JNIEnv, contexte: &JObject) {
    // `rustls-platform-verifier` parle jni 0.22, Tauri et libwebrtc jni 0.21 :
    // le même JNIEnv, repris par son pointeur brut.
    let mut env22 = unsafe { jni22::EnvUnowned::from_raw(env.get_raw().cast()) };
    let brut = contexte.as_raw();
    let issue = env22
        .with_env(|e| -> Result<(), jni22::errors::Error> {
            let ctx = unsafe { jni22::objects::JObject::from_raw(e, brut.cast()) };
            rustls_platform_verifier::android::init_with_env(e, ctx)
        })
        .into_outcome();
    match issue {
        jni22::Outcome::Ok(()) => noter(log::Level::Info, "[Sion][android] vérification TLS du système prête".into()),
        jni22::Outcome::Err(e) => noter(log::Level::Error, format!("[Sion][android] vérification TLS indisponible : {e}")),
        jni22::Outcome::Panic(_) => noter(log::Level::Error, "[Sion][android] vérification TLS : panique à l'initialisation".into()),
    }
}

#[cfg(feature = "native-voice")]
fn initialiser_webrtc(env: &JNIEnv, contexte: &JObject) {
    let vm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => {
            noter(log::Level::Error, format!("[Sion][android] WebRTC : JavaVM introuvable : {e}"));
            return;
        }
    };
    if livekit::webrtc::android::initialize_android_context(&vm, contexte) {
        noter(log::Level::Info, "[Sion][android] WebRTC initialisé (micro et haut-parleur Java)".into());
    } else {
        noter(log::Level::Error, "[Sion][android] WebRTC : initialisation du Context refusée".into());
    }
}

/// Appli tuée (tâche retirée des récentes) : `VoiceCallService.onTaskRemoved`
/// appelle ceci avant de s'arrêter. Sans ça, la voix continuait sans
/// interface — « Quitter » de la notification ne répondait plus — et les
/// autres voyaient un participant fantôme (29/09).
#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_quitterVoix<'local>(_env: JNIEnv<'local>, _classe: JClass<'local>) {
    log::info!("[Sion][android] appli fermée : départ de l'appel");
    // D'abord l'appartenance MatrixRTC (les autres ne nous voient plus),
    // puis la session LiveKit (départ propre au SFU).
    crate::matrix_pont::quitter_voix_bloquant(std::time::Duration::from_millis(1500));
    crate::voice_native::couper_voix_native();
    crate::audio_playback::shutdown();
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_sessionVoix(_env: JNIEnv, _class: JClass) -> jni::sys::jlong {
    crate::voice_native::android_voice_token() as jni::sys::jlong
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_microCoupe(_env: JNIEnv, _class: JClass, token: jni::sys::jlong) -> jni::sys::jboolean {
    crate::voice_native::android_voice_muted(token as u64) as jni::sys::jboolean
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_interruptionVoix(_env: JNIEnv, _class: JClass, token: jni::sys::jlong, interrupted: jni::sys::jboolean) {
    crate::voice_native::android_set_interrupted(token as u64, interrupted != 0);
}

#[no_mangle]
pub extern "system" fn Java_com_sion_client_SionNatif_actionCasque(_env: JNIEnv, _class: JClass, token: jni::sys::jlong, action: jni::sys::jint) {
    crate::voice_native::android_headset_action(token as u64, action);
}
