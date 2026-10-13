# Mise à jour des dépendances — 13 octobre 2026

Les dépendances de l’interface, du workspace Rust, du vérificateur de conservation et d’Android ont été mises à jour. Les changements fonctionnels déjà présents dans le projet sont conservés. Les motivations et les liens vers les changelogs officiels figurent dans [l’audit préalable](audit-dependances-2026-10-13.md).

## Adaptations dans Sion

- LiveKit 0.9.5, libwebrtc 0.3.52 et webrtc-sys 0.3.49 migrés ensemble. Les forks conservent les réglages audio/AEC/AGC, les gains de lecture, la capture Wayland, la normalisation SDP/BUNDLE, les codecs uniques et le repli NVDEC. Le tag du binaire précompilé WebRTC et son JAR Android restent cohérents via webrtc-sys-build 0.3.19.
- Tauri 2.12.3, runtime-wry 2.12.1, Wry 0.57.0 et plugins migrés ensemble. L’overlay GTK, la limitation des caches WebKit et le correctif de notification Linux sont conservés. Le redimensionnement retrouve sa fenêtre via l’ancêtre GTK.
- Notifications : adaptation du nouveau type d’action, y compris le clic `tap`, la navigation et la réponse.
- React 19.3, Vite 8.3.4 et plugin React 6.1.2 : minification Oxc, compilation des assets/WASM et migration de la chaîne TypeScript/ESLint/Vitest. Le paquet déprécié `@types/dompurify` est retiré.
- Reqwest 0.13 utilise le fournisseur TLS Ring déjà installé par Sion. Adaptations CPAL 0.18, Ashpd 0.13, ZIP 9, SHA2 0.11 et Windows 0.62 : types d’appareils, options des portails, métadonnées ZIP, hachage, poignées Win32/GDI et callback COM WASAPI.
- Keyring 3 migre vers keyring-core 1.0.1. La migration des sessions reste dormante tant qu’aucun coffre natif n’est enregistré ; le store de test ne provoque pas la suppression de session.json.
- La révision rdev est fixée à `0904f23ce496e255461a98848b85c11fa5a62eab`. Le Rust minimum déclaré passe à 1.96, conformément à Matrix SDK 0.19.1 (les effets webcam exigent 1.91).
- CI : Bun 1.4.0 et Node 26 explicites. Android utilise Gradle 9.8.1, AGP 9.4.1, Kotlin 2.4.21 et NDK 30.0.16248370 ; compileSdk 37, targetSdk 36. Le plugin Rust Gradle utilise ExecOperations et les cibles JVM Java/Kotlin sont alignées à 11.

## Transcription : VAD active et limites du streaming

Transcribe passe à 0.4.0. **Silero VAD 6.2 est intégré** au découpage des prises de parole, avec un modèle F32 livré (~1 Mo, licence MIT), des trames de 32 ms, une hystérésis 0,50/0,35 et earshot 1.2.2 en repli. Le modèle et sa provenance sont documentés dans `src-tauri/resources/transcription-NOTICES.txt`.

Les pauses restent bornées à 700 ms et les segments à 12 s. Le micro muet ferme le segment et remet la VAD à zéro. Le worker d’ingestion est arrêté et rejoint avant une nouvelle session ; chaque worker ASR possède son propre jeton d’annulation, pour éviter qu’une ancienne session interfère avec la suivante.

Les bibliothèques natives livrées proviennent désormais du dossier exact transmis par Transcribe au build, y compris les DLL dans bin sous Windows. Le binaire Linux demande bien `libtranscribe.so.0.4`.

Le [streaming Parakeet](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.0/docs/models/parakeet.md) concerne **unified-en**, en anglais. Le Parakeet TDT v3 utilisé par défaut dans Sion reste un modèle par segments, avec le français et les autres langues préservés. Transcribe propose aussi [Nemotron 3.5 ASR Streaming](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.0/docs/models/nemotron-3.5-asr-streaming-0.6b.md), dont fr-FR ; cette mise à jour n’ajoute pas de nouveau modèle ni d’affichage des résultats provisoires dans Sion.

## Versions conservées pour compatibilité

- TypeScript **6.0.3** : typescript-eslint 8.71.2 annonce `<6.1.0`, donc TypeScript 7 n’est pas forcé.
- GTK/gdkwayland **0.18** : branche exigée par Tauri ; les types de 0.19 ne sont pas interchangeables.
- windows-core **0.62** : même génération que Windows 0.62, plutôt que la branche 0.100 incompatible.
- JNI 0.21 et 0.22 coexistent selon les dépendances Tauri/WebRTC et le vérificateur TLS.
- Android conserve temporairement les options de compatibilité `android.builtInKotlin=false` et `android.newDsl=false`, nécessaires aux plugins Tauri actuels. Les dépréciations AGP restent visibles.

## Vérifications

- Interface dans le projet : build production réussi ; **893 tests réussis, 5 ignorés** ; lint sans erreur, 33 avertissements existants.
- Workspace Rust : compilation et suites unitaires réussies, dont chargement/réinitialisation réels de Silero.
- Vérificateur de conservation : **20 tests réussis**.
- Transcription de bout en bout : tap natif → Silero → Parakeet TDT v3 → résultat WebSocket, avec une phrase synthétique française.
- Windows : compilation croisée des modules Win32/GDI/COM réels avec Windows 0.62 réussie. Les limites voix/réseau sont remplacées par des stubs uniquement dans le harnais temporaire ; ce contrôle ne constitue pas un build complet ni un essai Windows réel.
- Android : compilation Rust ARM64, Kotlin et assemblage de l’APK réussis. Les symboles JNI Tauri/WebRTC et les segments ELF alignés à 16 Ko ont été vérifiés. APK de debug : `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. Aucun déploiement sur téléphone effectué.
- Test WebRTC SDP/BUNDLE après rebase : réussi, avec de vraies PeerConnection locales.
- Sion dev relancé avec Vite 8 et le nouveau binaire Linux ; moteur Matrix Rust et surface vidéo GTK initialisés. Le lanceur accepte aussi `--no-build` pour démarrer un binaire déjà validé pendant une compilation Android.

Les avertissements Wry sur la feature amont v2_42 et WebKit sur run_javascript, les options Gradle dépréciées, les gros chunks Vite et l’absence locale du SDK CUDA restent visibles. Aucun essai matériel caméra/micro ni appel Windows n’est revendiqué par ces contrôles.

## Interface : versions modifiées

| Paquet | Avant | Après |
| --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | 2.12.3 |
| `@tauri-apps/plugin-global-shortcut` | 2.3.2 | 2.4.1 |
| `@tauri-apps/plugin-log` | 2.9.0 | 2.10.1 |
| `@tauri-apps/plugin-notification` | 2.3.3 | 2.6.0 |
| `dompurify` | 3.4.12 | 3.4.17 |
| `highlight.js` | 11.11.1 | 11.12.0 |
| `i18next` | 25.10.10 | 26.4.4 |
| `i18next-http-backend` | 3.0.6 | 4.0.2 |
| `jose` | 6.2.3 | 6.2.12 |
| `matrix-js-sdk` | 42.3.0 | 43.0.0 |
| `react` | 19.2.7 | 19.3.0 |
| `react-dom` | 19.2.7 | 19.3.0 |
| `react-i18next` | 16.6.6 | 17.0.16 |
| `zustand` | 5.0.14 | 5.0.15 |
| `@eslint/js` | 9.39.5 | 10.0.1 |
| `@tauri-apps/cli` | 2.11.4 | 2.12.2 |
| `@types/node` | 24.13.3 | 26.6.5 |
| `@types/react` | 19.2.17 | 19.3.0 |
| `@types/react-dom` | 19.2.3 | 19.3.0 |
| `@vitejs/plugin-react` | 5.2.0 | 6.1.2 |
| `eslint` | 9.39.5 | 10.12.0 |
| `eslint-plugin-react-refresh` | 0.4.26 | 0.5.7 |
| `globals` | 16.5.0 | 17.13.0 |
| `jsdom` | 29.1.1 | 30.1.2 |
| `typescript` | 5.9.3 | 6.0.3 |
| `typescript-eslint` | 8.65.0 | 8.71.2 |
| `vite` | 7.3.6 | 8.3.4 |
| `vitest` | 4.1.10 | 5.0.4 |

## Rust : dépendances directes modifiées

Versions des dépendances directes ; le verrou conserve également les branches transitives imposées par les autres bibliothèques.

| Crate | Avant | Après |
| --- | --- | --- |
| `serde_json` | 1.0.151 | 1.0.154 |
| `sha2` | 0.10.9 | 0.11.1 |
| `log` | 0.4.33 | 0.4.34 |
| `tauri` | 2.11.5 | 2.12.3 |
| `tauri-plugin-log` | 2.9.0 | 2.10.1 |
| `open` | 5.4.0 | 5.4.4 |
| `reqwest` | 0.12.28 | 0.13.5 |
| `scraper` | 0.22.0 | 0.27.0 |
| `base64` | 0.22.1 | 0.23.1 |
| `dirs` | 6.0.0 | 7.0.0 |
| `tauri-plugin-notification` | 2.3.3 | 2.6.0 |
| `webrtc-sys` | 0.3.47 | 0.3.49 |
| `livekit` | 0.9.3 | 0.9.5 |
| `tokio` | 1.53.1 | 1.53.2 |
| `tungstenite` | 0.24.0 | 0.30.0 |
| `rustls` | 0.23.42 | 0.23.45 |
| `tauri-build` | 2.6.3 | 2.7.2 |
| `tauri-plugin-updater` | 2.12.0 | 2.13.3 |
| `tauri-plugin-global-shortcut` | 2.3.2 | 2.4.1 |
| `keyring → keyring-core` | 3.6.3 | 1.0.1 |
| `zip` | 0.6.6 | 9.0.2 |
| `tauri-plugin-window-state` | 2.4.1 | 2.5.0 |
| `rfd` | 0.15.4 | 0.17.2 |
| `cpal` | 0.15.3 | 0.18.2 |
| `transcribe-cpp` | 0.1.3 | 0.4.0 |
| `earshot` | 0.1.0 | 1.2.2 |
| `tiny-skia` | 0.11.4 | 0.12.0 |
| `wayland-client` | 0.31.14 | 0.31.15 |
| `ashpd` | 0.11.1 | 0.13.13 |
| `zbus` | 5.18.0 | 5.19.0 |
| `x11rb` | 0.13.2 | 0.14.0 |
| `rustix` | 0.38.44 | 1.1.5 |
| `wl-clipboard-rs` | 0.9.3 | 0.9.4 |
| `windows` | 0.58.0 | 0.62.2 |
| `windows-core` | 0.58.0 | 0.62.2 |
| `getrandom` | 0.3.4 | 0.4.3 |
| `libwebrtc` | 0.3.50 | 0.3.52 |
| `notify-rust` | 4.18.0 | 4.18.2 |
| `tauri-runtime-wry` | 2.11.4 | 2.12.1 |
| `wry` | 0.55.1 | 0.57.0 |

## Android : bibliothèques

| Composant | Avant | Après |
| --- | --- | --- |
| Android Gradle Plugin | 8.11.0 | 9.4.1 |
| Gradle | 8.14.3 | 9.8.1 |
| Kotlin | 1.9.25 | 2.4.21 |
| NDK | 27.2.12479018 | 30.0.16248370 |
| AndroidX WebKit | 1.14.0 | 1.17.1 |
| AppCompat | 1.7.1 | 1.8.0 |
| Activity KTX | 1.10.1 | 1.13.0 |
| Material Components | 1.12.0 | 1.14.0 |
| AndroidX Media | 1.7.0 | 1.8.0 |
| Work Runtime KTX | 2.10.0 | 2.12.0 |

## Suivi régulier — à mettre en place ultérieurement

Décision du 13/10/2026 : retenir Renovate et un audit des forks locaux.
La mise en place est différée à la demande de l’utilisateur ; aucune
automatisation n’est activée dans le cadre de cette décision.

- Contrôle hebdomadaire, le lundi : dépendances JavaScript, Rust, Android,
  outils de compilation et nouvelles versions amont des forks Sion.
- Tableau de suivi GitHub : versions actuelle/disponible, changelogs,
  mises à jour en attente et raisons des contraintes de compatibilité.
- Propositions regroupées par ensemble cohérent : React/types, Tauri/plugins,
  LiveKit/WebRTC et Android/Gradle/Kotlin.
- Reprise des correctifs des forks locaux et validation de leur conservation.
- Tests et compilations des plateformes concernées avant fusion.
- Contrôle quotidien des vulnérabilités pour prioriser les correctifs de sécurité.
