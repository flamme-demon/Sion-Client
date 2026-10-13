use std::path::PathBuf;

/// Recopie les bibliothèques de `transcribe-cpp` à côté de l'exécutable.
///
/// Le crate est bâti avec `dynamic-backends`, qui compile UNE variante du noyau
/// CPU par palier SIMD (sse42, haswell, icelake, zen4…) et laisse ggml choisir
/// au démarrage selon le processeur réel. C'est la seule façon de livrer un
/// binaire unique : lié statiquement, ggml se cale sur le CPU de COMPILATION et
/// embarque de l'AVX-512 que la machine de l'utilisateur ne sait pas exécuter —
/// SIGILL dès que le moteur de transcription démarre. Constaté sur un Ryzen
/// 5950X avec l'AppImage 1.6.1, compilée sur un runner Intel.
///
/// La contrepartie est que ces `.so`/`.dll` doivent voyager avec l'exécutable.
///
/// Transcribe 0.4 transmet le dossier exact de ses bibliothèques via les
/// métadonnées Cargo. Ne jamais sélectionner un ancien build dans target/ :
/// il peut encore contenir une ABI 0.1 et ne pas exporter les fonctions VAD.
fn copy_transcribe_libs() {
    println!("cargo:rerun-if-env-changed=DEP_TRANSCRIBE_CPP_LIB_DIR");
    let Some(lib_dir) = std::env::var_os("DEP_TRANSCRIBE_CPP_LIB_DIR").map(PathBuf::from) else {
        return; // Android : aucun moteur ASR desktop dans ce graphe.
    };
    let Some(target_dir) = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|p| {
            p.ancestors()
                .find(|a| a.file_name().is_some_and(|n| n == "build"))
                .and_then(|a| a.parent())
                .map(PathBuf::from)
        })
    else {
        return;
    };

    let mut directories = std::collections::BTreeSet::from([lib_dir]);
    for key in ["RUNTIME_DIR", "MODULE_DIR", "BIN_DIR"] {
        let variable = format!("DEP_TRANSCRIBE_CPP_{key}");
        println!("cargo:rerun-if-env-changed={variable}");
        if let Some(path) = std::env::var_os(variable) {
            directories.insert(PathBuf::from(path));
        }
    }
    for directory in directories {
        println!("cargo:rerun-if-changed={}", directory.display());
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let is_lib = name
                .to_str()
                .map(|n| n.contains(".so") || n.ends_with(".dll") || n.ends_with(".dylib"))
                .unwrap_or(false);
            if !is_lib || !path.is_file() {
                continue;
            }
            // Recopie inconditionnelle : une variante obsolète serait chargée en
            // priorité et pourrait réexposer le SIGILL que tout ceci évite.
            std::fs::copy(&path, target_dir.join(&name))
                .expect("copie des bibliothèques de transcription");
        }
    }
}

fn main() {
    copy_transcribe_libs();
    // Android + voix : les fonctions JNI de libwebrtc (`Java_livekit_org_webrtc_*`,
    // appelées par libwebrtc.jar) doivent rester dans libapp_lib.so. webrtc-sys
    // les réclame dans son propre build script, mais le `rustc-link-arg` d'une
    // dépendance ne s'applique pas à notre bibliothèque finale : l'éditeur de
    // liens les retirait, et la voix plantait à la création de WebRTC
    // (UnsatisfiedLinkError sur SoftwareVideoEncoderFactory, 29/09).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android")
        && std::env::var_os("CARGO_FEATURE_NATIVE_VOICE").is_some()
    {
        webrtc_sys_build::configure_jni_symbols().expect("symboles JNI de libwebrtc");
    }
    // Android : segments de libapp_lib.so alignés sur 16 Ko. Les téléphones à
    // pages de 16 Ko (Android 15+) refusent sinon de charger la bibliothèque,
    // et Android le signale déjà sur les versions de débogage (29/09).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    // Les variantes ggml voyagent à côté de l'exécutable : sans $ORIGIN dans le
    // RPATH, l'éditeur de liens dynamique ne regarde jamais ce dossier et le
    // lancement échoue sur « libtranscribe.so.0 => not found ».
    // `$ORIGIN` couvre le lancement depuis target/ ; le second chemin couvre
    // l'AppImage, qui range le binaire dans usr/bin et les bibliothèques dans
    // usr/lib/sion-client, aux côtés de CEF.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN:$ORIGIN/../lib/sion-client");
    tauri_build::build()
}
