# Sion capture-processing extension

Based on the published `webrtc-sys` **0.3.49** crate, used by LiveKit 0.9.3
(rebased from 0.3.43 on 02/10: LiveKit #1212 made `AdmProxy` worker-thread
affine — candidate fix for the capture-thread crash on voice reconnection).
The original sources and notices are retained. Sion modifications:

- `Cargo.toml`: optional `sion-audio` feature and local processor dependency.
- `build.rs`: `cargo:rerun-if-env-changed=CUDA_HOME` — sans cette ligne, définir
  CUDA_HOME après coup ne relance pas le script : cargo réutilise les objets C++
  compilés sans NVENC et l'app ressort silencieusement sans codecs NVIDIA
  (vécu en CI Windows le 2026-09-13 : la variable arrivait, le cache était
  périmé). À conserver tant que le chemin NVIDIA est compilé conditionnellement.
- `build.rs` : bloc NVIDIA **porté dans la branche `windows`** (il n'existait
  que côté Linux) + macros du prébuilt (`webrtc_defines()`, sinon
  `PlatformThreadId` non défini) + `WIN32_LEAN_AND_MEAN`/`NOMINMAX` (conflits
  winsock) + `cuda.lib` au lieu des shims ELF.
- `src/nvidia/nvidia_{encoder,decoder}_factory.cpp` : portage Windows du
  chargement — `dlfcn.h` n'existe pas, `LoadLibraryA`/`GetProcAddress`/
  `FreeLibrary` sous `_WIN32`, DLL du pilote (`nvEncodeAPI64.dll`,
  `nvcuvid.dll`, dans System32) au lieu des noms POSIX. Même schéma que
  `cuda_context.cpp`, déjà cross-plateforme.
- `src/nvidia/nvcuvid_windows.cpp` (nouveau, Windows) : les 13 fonctions
  NVDEC appelées par les décodeurs (`cuvidCreateDecoder`, `cuvidMapVideoFrame64`,
  `cuvidParseVideoData`…) fournies comme redirections dynamiques vers
  `nvcuvid.dll`. Même raison que les shims ELF côté Linux : NVIDIA ne
  publie pas de bibliothèque d'import pour cette API du pilote. Sans pilote,
  chaque appel rend `CUDA_ERROR_NOT_INITIALIZED` — pas de crash, repli
  décodage logiciel.
- `build.rs`, `src/lib.rs`: compile/export the extension only with that feature.
- `src/peer_connection_factory.cpp`: install the capture APM builder behind
  `SION_NATIVE_AUDIO`; upstream behavior is preserved without the feature.
- `include/livekit/sion_audio.h`, `src/sion_audio.{rs,cpp}`: capture callback,
  software processing configuration, native soundboard render mixer, effective
  APM diagnostic and offline harness.
- `src/audio_device_controller.cpp`: expose an opaque index-based device ID
  when the Linux ADM enumerates named endpoints with empty GUIDs, and resolve
  that ID back to the same ADM index when selecting a device.
- ~~`src/adm_proxy.cpp` (Android) : transport audio remis à l'ADM créé à la
  demande~~ — repris par LiveKit dans 0.3.44 (#1212), patch retiré.
- `src/adm_proxy.cpp`, `include/livekit/adm_proxy.h` (toutes plateformes,
  sur le fil de travail de WebRTC depuis #1212) :
  `ReinitPlatformAdmIfTerminated()`, appelé par `Init()` et
  `AcquirePlatformAdm()`. Toujours nécessaire en 0.3.49 : `Init()` y reste
  sans effet et la création paresseuse s'arrête si l'ADM existe déjà. Un `Terminate()` du proxy (fabrique de pairs
  recréée quand une première connexion au serveur vocal expire) laissait
  l'ADM de la plateforme terminé : « -1 recording devices, -1 playout
  devices », « Unable to set playout device », silence jusqu'au redémarrage
  de l'appli (26/09, 01/10).
- `audio_track.{h,cpp,rs}`: expose the existing WebRTC
  `AudioSourceInterface::SetVolume` operation for per-share local playback
  gain. The small safe Rust forwarding method lives in `vendor/libwebrtc`.

The proxy forwards WebRTC's APM interface unchanged except for `ApplyConfig`:
AEC and digital AGC follow the application settings and built-in noise
suppression stays disabled. This also applies when the voice engine reapplies
source options after publishing or reconnecting. The actual capture and render
paths remain owned by the same WebRTC APM, preserving its echo-reference timing.

The capture post-processor calls `sion-native-audio` directly through CXX.
Its per-channel RNNoise state is owned by the capture thread. No PCM goes
through Tauri, Web Audio, an application queue or a second microphone capture.
A weak registry lets settings reach existing APM instances without retaining
ended rooms. Application settings are atomically published; APM configuration
updates are serialized outside the capture callback.

RNNoise expects 480 samples of float PCM in the signed 16-bit range. Lower-rate
APM buffers use WebRTC's sinc resamplers, constructed during initialization.
When RNNoise is off, resampling and denoising are bypassed. When enabled, the dry
branch is delayed by one 10 ms frame to align with RNNoise's output.

The render pre-processor consumes decoded 48 kHz mono soundboard clips from a
bounded native queue and mixes them before WebRTC analyzes the reverse stream.
Consequently the clip follows the selected PlatformAudio output and is included
in the AEC reference. Concurrent clips overlap and saturate safely. Encoded
media remains downloaded and decoded by the web UI; a clip crosses Tauri once
as PCM, rather than sending realtime frames over IPC.

On an SDK update, review the entire `AudioProcessing` interface against the
pinned WebRTC headers, keep every forwarding method, and run both the Rust DSP
tests and the C++/Rust offline integration tests. Do not assume that changing
`PlatformAudio::configure_audio_processing` configures the desktop software APM.

The extension changes application processing only. It does not replace the
SDK's prebuilt libwebrtc, its media transport, desktop capture or device routing.

## Diagnostic capture d'écran (Linux/Wayland)

`src/desktop_capturer.cpp` journalise sur stderr les options effectives du
capturer (`allow_pipewire`, `allow_x11`) avant `CreateScreenCapturer`. Sous
WRY, la liste des sources ne contient qu'une entrée anonyme et la capture
renvoie des erreurs temporaires en boucle : ces logs permettent de confirmer
si le backend PipeWire (portail XDG) a bien été retenu ou si le binaire est
retombé sur X11, qui ne voit rien sous Wayland natif.

## Durcissement NVDEC (13/09/2026) — échec logiciel au lieu d'un abort

**Symptôme** : chez un testeur NVIDIA (pilote propriétaire 580), le client
mourait sur `SIGABRT` (`IOT instruction (core dumped)`) à la **première image
du partage reçu**. La pile pointait `webrtc::internal::AudioSendStream` d'un
côté, et surtout : `NvCodec/.../NvDecoder.cpp` lève `NVDECException` sur tout
échec d'appel cuvid, alors que :
- `NvidiaH264DecoderImpl::Configure()` construisait son `NvDecoder` **sans
  try/catch** ;
- `IsNvdecRuntimeAvailable()` ne testait qu'un `dlopen("libnvcuvid.so.1")` —
  il prouve la présence de la bibliothèque, pas que le pilote sait ouvrir une
  session de décodage H264 sur ce GPU ;
- WebRTC n'attrape pas : une exception qui s'échappe termine le processus.

**Correctif** (fichiers ci-dessous) :
- `nvidia_decoder_factory.{h,cpp}` : drapeau process-wide `g_nvdec_failed`
  (`NoteNvdecFailure`). Une fois positionné, `IsSupported()` renvoie faux — les
  flux suivants décodent en logiciel au lieu de re-tenter le matériel.
  - **sonde réelle** dans le constructeur : ouverture puis destruction d'une
    session `NvDecoder` H264 (4096×4096). Un `dlopen` réussi ne suffit plus.
  - `Create()` : créations H264/H265 sous try/catch.
- `h264_decoder_impl.cpp` / `h265_decoder_impl.cpp` : `Configure`, la boucle
  `Decode` et la récupération des images (`GetFrame` →
  `cuvidMapVideoFrame64`) sont sous try/catch ; l'échec marque NVDEC
  inutilisable et renvoie `WEBRTC_VIDEO_CODEC_ERROR` au lieu de propager.

`LK_DISABLE_NVDEC=1` reste le contournement manuel (coupe la fabrique).

**Avertissement distinct** : les fabriques matérielles et logicielles peuvent
déclarer les mêmes profils H264 (`Factory produced duplicate codecs`). WebRTC
dédoublonne ces profils ; les déclarations identiques sont maintenant retirées
à la source (voir ci-dessous).

### 12/10 — paramètres de débit vidéo cohérents dans le BUNDLE

Les journaux Windows de la bêta 10 montrent une collision VP8 réellement
refusée avec `INVALID_PARAMETER` : le payload 109 porte
`x-google-start-bitrate=1000` dans une section vidéo et aucun paramètre dans
une autre. `livekit` 0.9.3 complète les fmtp existants et détecte leur absence
par payload dans tout le SDP, alors que la présence se vérifie par section.

`libwebrtc/src/native/video_sdp.rs` complète le paramètre manquant uniquement
pour un codec, un payload et un groupe BUNDLE identiques, lorsque les autres
paramètres concordent et qu'une valeur positive unique existe. Les profils
différents, hints contradictoires, transports indépendants et sections
rejetées restent inchangés. `SessionDescription::parse` applique ce correctif
avant la création native : l'offre validée localement et l'offre envoyée
contiennent ainsi les mêmes paramètres. Six tests purs couvrent la régression,
les autres codecs, l'idempotence et les limites du correctif.

### 12/10 — déclarations de codecs uniques

La capture Windows du 12/10 compte 1 045 avertissements de codecs déclarés
plusieurs fois. `GetSupportedFormats()` concaténait les listes logicielles,
matérielles et préencodées. Les listes d'encodage et de décodage passent
maintenant par `UniqueVideoFormats` : la première déclaration est conservée
pour un nom de codec et des paramètres SDP identiques. Les niveaux/profils
H264, les modes de paquetisation et les paramètres matériels distincts ne
sont pas fusionnés. Le choix du backend et `GetImplementations()` conservent
leurs listes complètes.

Le test C++ `test/unique_video_formats_test.cc`, exécuté avec les en-têtes,
définitions et libc++ du prébuilt WebRTC, couvre les doublons VP8/VP9/AV1/H264,
la priorité de la première déclaration et les formats qui doivent rester
distincts. Un test de négociation native crée deux transceivers vidéo,
reproduit le hint VP8 manquant et vérifie `set_local_description` après
normalisation.

Validation du 12/10 : `cargo test --lib video_sdp` (sept tests),
`cargo check --tests` et le test natif caméra/partage exécuté séparément
réussissent sous Linux. Sur flammemob, le test C++ passe avec MSVC et le
prébuilt Windows ; les six tests SDP et la négociation native à deux pistes
passent aussi. Pour cette dernière, le normaliseur corrigé est appliqué avant
le parseur du LiveKit déjà compilé dans le cache Windows. Ces tests sont
isolés dans `%TEMP%\sion-warning-check-20261012` ; la validation d'un appel
avec un client Windows reconstruit reste à effectuer.

La même capture contient 9 674 avertissements `VideoReceiveStreamInterface
not connected to a VideoSink` entre 12:31:49 et 12:38:12. Ils commencent lors
de la publication de la webcam locale, avec des SSRC non signalés et une
collision BUNDLE. Les pompes du partage et de la webcam distante continuent
pourtant à recevoir des images : cela ne prouve pas un arrêt de la pompe
d'affichage. Vérifier cette séquence sur Windows après le correctif SDP avant
de modifier le cycle des récepteurs. L'AEC Windows configurée après
initialisation et les candidats ICE de composant 2 restent à examiner.
