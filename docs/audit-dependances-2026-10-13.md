# Audit des dépendances Sion — 13 octobre 2026

Mise à jour réalisée : voir [le compte rendu des versions et validations](mise-a-jour-dependances-2026-10-13.md). Cet audit conserve l’inventaire relevé avant migration.

Le relevé porte sur les **versions réellement verrouillées** dans `bun.lock` et `src-tauri/Cargo.lock`, et sur les versions déclarées pour Android. Les 43 paquets npm installés correspondent au verrou. Les registres npm, crates.io, Google Maven, Maven Central et les notes des mainteneurs ont été consultés le 13/10/2026.

**28 paquets npm et 42 crates ont une version stable plus récente.** Le périmètre Rust comprend 74 noms : les dépendances directes du workspace et les forks locaux, dont `rdev` provenant de Git. Les dépendances transitives ne sont pas auditées individuellement. Le petit workspace de vérification du serveur de conservation est relevé séparément.

Il s'agit d'un audit : aucune dépendance, aucun manifeste et aucun verrou n'ont été mis à jour. Une plage de version qui autorise une mise à jour ne prouve pas à elle seule que le code et ses correctifs locaux restent compatibles.

## Changements à prioriser

| Composant | Dans Sion → disponible | Changelog utile pour Sion | Suite conseillée |
| --- | --- | --- | --- |
| Rustls | 0.23.42 → 0.23.45 | Correctif de validation des messages TLS 1.3. Notre version figure dans la plage affectée par l'avis GHSA-2mjx-qc3c-rqvc, de gravité modérée. | Premier lot de correctifs. [Avis officiel](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc). |
| DOMPurify | 3.4.12 → 3.4.17 | Durcissement de la sanitisation XML/HTML, des espaces de noms et de plusieurs cas limites ; corrections du mode `IN_PLACE`. | Correctif dans la branche 3.4. [Notes](https://github.com/cure53/DOMPurify/releases/tag/3.4.17). |
| Highlight.js | 11.11.1 → 11.12.0 | Corrections de coloration, notamment Markdown/Rust ; suppression de cas de traitement excessif par expressions régulières en C/C++ et XML. | Utile au rendu du chat. [Notes](https://github.com/highlightjs/highlight.js/releases/tag/11.12.0). |
| LiveKit / WebRTC | LiveKit 0.9.3 → 0.9.5 ; libwebrtc 0.3.50 → 0.3.52 ; webrtc-sys 0.3.47 → 0.3.49 | Déconnexion plus fiable, ressources VAAPI libérées, débit initial caméra adapté à la vitesse de connexion, vidéo préencodée rendue décodable après des pertes d'images. | Reprendre les patches Sion ensemble avant compilation. [0.9.4](https://github.com/livekit/rust-sdks/releases/tag/livekit/v0.9.4), [0.9.5](https://github.com/livekit/rust-sdks/releases/tag/livekit/v0.9.5). |
| Tauri et Wry | Tauri 2.11.5 → 2.12.3 ; runtime-wry 2.11.4 → 2.12.1 ; Wry 0.55.1 → 0.57.0 | Corrections d'IPC, de fuite d'écouteurs et de cycle de vie Android ; corrections de fermeture WebView2 Windows. | Lot coordonné Rust/JS et reprise des forks Linux. [Tauri](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md), [Wry](https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md). |
| Notifications Tauri | 2.3.3 → 2.6.0, Rust et JS | Permission Windows correctement renvoyée ; plusieurs API Android réparées ; réception des clics/actions sur desktop. Le type transmis à `onAction` change. | Utile sur Windows/Android ; conserver ou reprendre le correctif notify-rust Linux. [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/CHANGELOG.md). |
| Updater Tauri | 2.12.0 → 2.13.3 | Vérification de signature renforcée, installation macOS plus robuste ; ne modifie plus les chemins des certificats TLS du processus sur Linux. | À associer au lot Tauri. [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md). |
| Transcription | transcribe-cpp 0.1.3 → 0.4.0 | Moins de mémoire pour Parakeet, correction de perte de fin de flux, diarisation avec certains modèles, sélection des backends et nouveaux modèles. | Migration du moteur à préparer, puis essais Whisper/Parakeet et des bibliothèques natives livrées. [Diff officiel](https://github.com/handy-computer/transcribe.cpp/compare/v0.1.3...v0.4.0). |

Les apports de LiveKit 0.9.4 et 0.9.5 sont documentés, mais leur effet sur les warnings PulseAudio et les coupures audio observées dans Sion reste à mesurer. Les notes ne permettent pas d'affirmer qu'ils corrigent ces symptômes.

## Points de compatibilité vérifiés

### Voix : mettre à jour les trois couches ensemble

LiveKit **0.9.5 a été publié le 12 octobre vers 22 h 10 UTC**, soit dans la nuit du 12 au 13 à Paris. Son graphe demande `libwebrtc ^0.3.52`, qui demande `webrtc-sys ^0.3.49`. Les forks locaux Sion sont respectivement en 0.3.50 et 0.3.47, et le manifeste de Sion fixe explicitement webrtc-sys à `=0.3.47`. Une simple mise à jour LiveKit rencontre donc une incompatibilité avec cette contrainte et ne conserve pas automatiquement les versions locales.

Il faut reprendre notamment le traitement audio, les réglages AEC/AGC, le gain de lecture, les adaptations de capture Wayland, les corrections SDP/BUNDLE, les déclarations uniques de codecs et le repli NVDEC. Pour Android, le JAR libwebrtc doit suivre le binaire natif correspondant.

En 0.9.4, le SDK borne la fermeture des sockets de signalisation, évite certains blocages de déconnexion, libère les pistes déjà fermées côté serveur et améliore la gestion des ressources VAAPI. En 0.9.5, la fermeture devient un état final fiable, les couches dynacast sont réappliquées après renégociation et la vidéo préencodée attend une image clé après une perte. Une rupture d'API est également annoncée sur les grants des tokens ; Sion ne construit pas ces grants directement dans son code actuel. Cela ne remplace pas une vérification du graphe.

Sources : [notes 0.9.4](https://github.com/livekit/rust-sdks/releases/tag/livekit/v0.9.4), [notes 0.9.5](https://github.com/livekit/rust-sdks/releases/tag/livekit/v0.9.5), [dépendances LiveKit](https://crates.io/api/v1/crates/livekit/0.9.5/dependencies), [dépendances libwebrtc](https://crates.io/api/v1/crates/libwebrtc/0.3.52/dependencies).

### Tauri : conserver les adaptations Linux

Tauri 2.12.3 demande `tauri-runtime-wry ~2.12.1`, dont la dépendance Wry est `^0.57.0`. Les forks locaux 2.11.4 et 0.55.1 ne satisfont pas ces exigences. Il faut reprendre le conteneur GTK utilisé par la vidéo native, le redimensionnement sans décorations et les réglages de pression mémoire WebKit. Le fork softbuffer 0.4.8 pour la transparence Wayland est déjà à la dernière version stable.

Les paquets JS de Tauri et de ses plugins doivent être mis à jour avec leur partie Rust. Le passage à Tauri 2.12 relève le minimum Rust annoncé à 1.90. Sion utilise déjà un crate caméra déclarant Rust 1.91, alors que le manifeste principal indique encore 1.77.2 : cette déclaration ne reflète plus le minimum du projet. La CI suit Rust stable ; le commentaire qui justifie earshot 0.1 par un besoin Rust 1.87 est également à réexaminer.

Source : [changelog Tauri](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md), [changelog tauri-build](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-build/CHANGELOG.md), [dépendances runtime](https://crates.io/api/v1/crates/tauri-runtime-wry/2.12.1/dependencies). Patches locaux : `src-tauri/vendor/{wry,tauri-runtime-wry,notify-rust,libwebrtc,webrtc-sys}/SION_PATCH.md`.

### Notifications Linux : le fork reste à préserver

notify-rust 4.18.1/4.18.2 apporte surtout une réorganisation et des changements de notifications Windows. zbus 5.19 rend ses backends async-io/Tokio additifs, mais son `block_on` utilise toujours un runtime Tokio lorsque cette feature est active. Le code publié a été contrôlé : cela ne suffit pas à supprimer notre contournement du runtime imbriqué.

Sources : [notify-rust 4.18.2](https://github.com/hoodie/notify-rust/releases/tag/v4.18.2), [zbus 5.19 — utils.rs](https://docs.rs/crate/zbus/5.19.0/source/src/utils.rs), [changelog zbus](https://github.com/z-galaxy/zbus/blob/main/zbus/CHANGELOG.md).

### Matrix : le cœur Rust est déjà à jour

`matrix-sdk` et `matrix-sdk-crypto` **0.19.1 sont déjà les dernières versions stables**. Le changelog 0.19.1 concerne principalement la documentation publiée ; les nouveautés 0.19.0 sont déjà comprises dans la version utilisée.

Le SDK JS 42.3.0 peut passer à **42.4.0 dans la plage actuelle**, ou à **43.0.0 après revue**. La 42.4 corrige notamment le traitement des timeouts locaux répétés dans MatrixRTC et la révocation OAuth. La 43 corrige des courses MatrixRTC et des accusés de lecture et ajoute des données applicatives aux memberships RTC. Elle déplace aussi le renouvellement OAuth dans le SDK, avec une rupture annoncée. Le moteur Rust est actif par défaut sur desktop ; le SDK JS reste utilisé par les chemins de secours, le web et les outils de validation.

Sources : [Rust](https://github.com/matrix-org/matrix-rust-sdk/blob/main/crates/matrix-sdk/CHANGELOG.md), [JS 42.4](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v42.4.0), [JS 43](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v43.0.0).

### Outils web et traductions : séparer les migrations

Vite **7.3.7** et Vitest **4.1.11** sont des correctifs accessibles sans changer les plages actuelles. Vite 8.3.4 et le plugin React 6.1.2 forment un autre lot : Vite change de moteur de compilation vers Rolldown/Oxc. Il faut vérifier le chargement WASM Matrix, les cibles WebKit/WebView2 et `build.minify: "esbuild"`. Le plugin WASM installé annonce bien Vite 8 dans ses peers, mais cela ne valide pas l'ensemble du build Sion.

TypeScript **7.0.2** est publié, mais `typescript-eslint` **8.71.2**, même à jour, annonce `typescript >=4.8.4 <6.1.0`. TypeScript 7 dépasse donc la compatibilité déclarée du lint. ESLint 10, Vitest 5 et jsdom 30 demandent aussi une revue de configuration et des runtimes de CI.

Les mises à jour i18next 26.4.4 / react-i18next 17.0.16 vont ensemble : le second demande i18next >=26.2.0. i18next 26 retire notamment l'ancien formatage et `initImmediate` ; ces options ne sont pas employées dans `src/i18n.ts`. Le backend HTTP 4 abandonne son polyfill fetch ; la correction de sécurité 4.0.2 concerne des chemins commençant directement par un placeholder. Le chemin Sion commence par `/locales/` et ne correspond pas à cette configuration affectée.

Sources : [Vite 7.3.7](https://github.com/vitejs/vite/blob/v7.3.7/packages/vite/CHANGELOG.md), [migration Vite 8](https://vite.dev/guide/migration), [Vitest 4.1.11](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11), [peers typescript-eslint](https://registry.npmjs.org/typescript-eslint/8.71.2), [migration i18next](https://github.com/i18next/i18next-gitbook/blob/master/misc/migration-guide.md), [backend HTTP](https://github.com/i18next/i18next-http-backend/blob/master/CHANGELOG.md).

## Inventaire npm

« Compatible » désigne la dernière version autorisée par `package.json`, selon `bun outdated`. Les colonnes ne constituent pas une validation de la migration.

### Exécution : mises à jour disponibles

| Paquet | Verrouillé | Compatible | Dernière stable | Notes officielles / point à vérifier |
| --- | --- | --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | 2.12.3 | 2.12.3 | [Changelog](https://github.com/tauri-apps/tauri/blob/dev/packages/api/CHANGELOG.md) — À coordonner avec le cœur Rust. |
| `@tauri-apps/plugin-global-shortcut` | 2.3.2 | 2.4.1 | 2.4.1 | [Changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/global-shortcut/CHANGELOG.md) — Corrige un deadlock de callback de raccourci. |
| `@tauri-apps/plugin-log` | 2.9.0 | 2.10.1 | 2.10.1 | [Changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/log/CHANGELOG.md) — Emplacements des logs webview et intégration de l’API globale. |
| `@tauri-apps/plugin-notification` | 2.3.3 | 2.6.0 | 2.6.0 | [Changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/CHANGELOG.md) — Corrections Windows/Android et clics desktop ; type onAction modifié. |
| `dompurify` | 3.4.12 | 3.4.17 | 3.4.17 | [Changelog](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) — Durcissement de la sanitisation ; prioritaire. |
| `highlight.js` | 11.11.1 | 11.12.0 | 11.12.0 | [Changelog](https://github.com/highlightjs/highlight.js/releases/tag/11.12.0) — Coloration et cas de traitement excessif C/C++/XML. |
| `i18next` | 25.10.10 | 25.10.10 | 26.4.4 | [Changelog](https://github.com/i18next/i18next-gitbook/blob/master/misc/migration-guide.md) — Migration 26 : retrait d’options anciennes. |
| `i18next-http-backend` | 3.0.6 | 3.0.6 | 4.0.2 | [Changelog](https://github.com/i18next/i18next-http-backend/blob/master/CHANGELOG.md) — Migration 4 : fetch fourni par le runtime. |
| `jose` | 6.2.3 | 6.2.12 | 6.2.12 | [Changelog](https://github.com/panva/jose/releases/tag/v6.2.12) — Optimisations JWS/JWE et imports JWKS. |
| `matrix-js-sdk` | 42.3.0 | 42.4.0 | 43.0.0 | [Changelog](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v43.0.0) — 43 : MatrixRTC et OAuth ; 42.4 possible séparément. |
| `react` | 19.2.7 | 19.3.0 | 19.3.0 | [Changelog](https://github.com/react/react/releases/tag/v19.3.0) — ViewTransition et refs de Fragment ; avec ReactDOM/types. |
| `react-dom` | 19.2.7 | 19.3.0 | 19.3.0 | [Changelog](https://github.com/react/react/releases/tag/v19.3.0) — À mettre à jour avec React et ses types. |
| `react-i18next` | 16.6.6 | 16.6.6 | 17.0.16 | [Changelog](https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md) — 17 demande i18next >=26.2.0. |
| `zustand` | 5.0.14 | 5.0.15 | 5.0.15 | [Changelog](https://github.com/pmndrs/zustand/releases/tag/v5.0.15) — Corrige une course de réhydratation persist et les devtools. |

### Développement : mises à jour disponibles

| Paquet | Verrouillé | Compatible | Dernière stable | Notes officielles / point à vérifier |
| --- | --- | --- | --- | --- |
| `@eslint/js` | 9.39.5 | 9.39.5 | 10.0.1 | [Changelog](https://eslint.org/docs/latest/use/migrate-to-10.0.0) — À coordonner avec ESLint 10 et les plugins. |
| `@tauri-apps/cli` | 2.11.4 | 2.12.2 | 2.12.2 | [Changelog](https://github.com/tauri-apps/tauri/blob/dev/packages/cli/CHANGELOG.md) — Build et packaging ; suivre le lot Tauri. |
| `@types/node` | 24.13.3 | 24.19.2 | 26.6.5 | [Changelog](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) — 24.19.2 dans la branche actuelle ; aligner au runtime ciblé. |
| `@types/react` | 19.2.17 | 19.3.0 | 19.3.0 | [Changelog](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) — Suivre le lot React 19.3. |
| `@types/react-dom` | 19.2.3 | 19.3.0 | 19.3.0 | [Changelog](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) — Suivre le lot React 19.3. |
| `@vitejs/plugin-react` | 5.2.0 | 5.2.0 | 6.1.2 | [Changelog](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md) — 6.1.2 demande Vite 8. |
| `eslint` | 9.39.5 | 9.39.5 | 10.12.0 | [Changelog](https://eslint.org/docs/latest/use/migrate-to-10.0.0) — Migration de la chaîne de lint. |
| `eslint-plugin-react-refresh` | 0.4.26 | 0.4.26 | 0.5.7 | [Changelog](https://github.com/ArnaudBarre/eslint-plugin-react-refresh/blob/main/CHANGELOG.md) — Changement de branche 0.5 ; revoir les règles. |
| `globals` | 16.5.0 | 16.5.0 | 17.13.0 | [Changelog](https://github.com/sindresorhus/globals/releases) — Définitions de globals à revoir avec ESLint. |
| `jsdom` | 29.1.1 | 29.1.1 | 30.1.2 | [Changelog](https://github.com/jsdom/jsdom/releases) — 30 demande Node >=22.22.2, >=24.15 ou >=26 suivant la branche. |
| `typescript` | 5.9.3 | 5.9.3 | 7.0.2 | [Changelog](https://github.com/microsoft/TypeScript/releases/tag/v7.0.2) — 7 hors de la plage prise en charge par typescript-eslint. |
| `typescript-eslint` | 8.65.0 | 8.71.2 | 8.71.2 | [Changelog](https://github.com/typescript-eslint/typescript-eslint/releases) — Même branche ; compatibilité TypeScript <6.1. |
| `vite` | 7.3.6 | 7.3.7 | 8.3.4 | [Changelog](https://vite.dev/guide/migration) — 7.3.7 correctif ; 8.3.4 migration Rolldown/Oxc. |
| `vitest` | 4.1.10 | 4.1.11 | 5.0.4 | [Changelog](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11) — 4.1.11 : concurrence des tests et restrictions des mocks ; 5 à préparer. |

### Paquets npm déjà à jour

- `@material/material-color-utilities` 0.4.0
- `@types/dompurify` 3.2.0 — paquet déprécié : DOMPurify fournit déjà ses types ; suppression possible après vérification TypeScript.
- `emojibase-data` 17.0.0
- `i18next-browser-languagedetector` 8.2.1
- `jsqr` 1.4.0
- `react-markdown` 10.1.0
- `rehype-highlight` 7.0.2
- `remark-breaks` 4.0.0
- `remark-gfm` 4.0.1
- `@tailwindcss/vite` 4.3.3
- `eslint-plugin-react-hooks` 7.1.1
- `fake-indexeddb` 6.2.5
- `tailwindcss` 4.3.3
- `vite-plugin-top-level-await` 1.6.0
- `vite-plugin-wasm` 3.6.0

La dépréciation de `@types/dompurify` est indiquée par le [registre npm](https://registry.npmjs.org/%40types%2Fdompurify/3.2.0).

## Inventaire Rust

Pour les crates 0.x, un changement du deuxième nombre peut nécessiter une migration. Les versions locales sous `[patch.crates-io]` demandent une reprise de leurs correctifs.

| Crate | Verrouillée | Dernière stable | Plage actuelle | Notes / prudence |
| --- | --- | --- | --- | --- |
| `ashpd` | 0.11.1 | [0.13.13](https://crates.io/crates/ashpd/0.13.13) | `0.11` | [Notes](https://github.com/bilelmoussaoui/ashpd/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `base64` | 0.22.1 | [0.23.1](https://crates.io/crates/base64/0.23.1) | `0.22` | [Notes](https://github.com/marshallpierce/rust-base64/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `cpal` | 0.15.3 | [0.18.2](https://crates.io/crates/cpal/0.18.2) | `0.15` | [Notes](https://github.com/RustAudio/cpal/blob/master/CHANGELOG.md) — Migration 0.18 : backends, timestamps et formats ; ce n’est pas le moteur micro WebRTC. |
| `dirs` | 6.0.0 | [7.0.0](https://crates.io/crates/dirs/7.0.0) | `6` | [Notes](https://codeberg.org/dirs/dirs-rs) — Changement de branche ; revue des API et du changelog nécessaire. |
| `earshot` | 0.1.0 | [1.2.2](https://crates.io/crates/earshot/1.2.2) | `0.1` | [Notes](https://github.com/pykeio/earshot/releases) — Migration VAD ; minimum Rust 1.87, déjà inférieur au crate caméra 1.91. |
| `gdkwayland-sys` | 0.18.2 | [0.19.0](https://crates.io/crates/gdkwayland-sys/0.19.0) | `0.18` | [Notes](https://github.com/gtk-rs/gtk3-rs/releases) — À aligner avec la famille GTK employée par Tauri. |
| `getrandom` | 0.3.4 | [0.4.3](https://crates.io/crates/getrandom/0.4.3) | `0.3` | [Notes](https://github.com/rust-random/getrandom/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `gtk` | 0.18.2 | [0.19.0](https://crates.io/crates/gtk/0.19.0) | `0.18` | [Notes](https://github.com/gtk-rs/gtk3-rs/releases) — Tauri 2.12 utilise encore gtk ^0.18 ; ne pas migrer ce binding seul. |
| `keyring` | 3.6.3 | [4.2.0](https://crates.io/crates/keyring/4.2.0) | `3` | [Notes](https://github.com/open-source-cooperative/keyring-rs/releases) — Migration 4 ; Sion n’active actuellement aucun backend persistant de cette crate. |
| `libwebrtc` | 0.3.50 (fork Sion) | [0.3.52](https://crates.io/crates/libwebrtc/0.3.52) | Patch local | [Notes](https://github.com/livekit/rust-sdks/releases/tag/libwebrtc/v0.3.52) — Fork local à reprendre ; demande webrtc-sys ^0.3.49. |
| `livekit` | 0.9.3 | [0.9.5](https://crates.io/crates/livekit/0.9.5) | `0.9` | [Notes](https://github.com/livekit/rust-sdks/releases/tag/livekit/v0.9.5) — Reprise coordonnée des forks WebRTC. |
| `log` | 0.4.33 | [0.4.34](https://crates.io/crates/log/0.4.34) | `0.4` | [Notes](https://github.com/rust-lang/log/releases) — Patch dans la plage actuelle ; notes détaillées à examiner avant application. |
| `notify-rust` | 4.18.0 (fork Sion) | [4.18.2](https://crates.io/crates/notify-rust/4.18.2) | Patch local | [Notes](https://github.com/hoodie/notify-rust/releases/tag/v4.18.2) — Changements Windows ; conserver le correctif Tokio local. |
| `open` | 5.4.0 | [5.4.4](https://crates.io/crates/open/5.4.4) | `5` | [Notes](https://github.com/Byron/open-rs/releases) — Patch dans la plage actuelle ; notes détaillées à examiner avant application. |
| `reqwest` | 0.12.28 | [0.13.5](https://crates.io/crates/reqwest/0.13.5) | `0.12` | [Notes](https://github.com/seanmonstar/reqwest/releases) — Migration 0.13 ; déjà présent transitivement via Matrix, code direct encore en 0.12. |
| `rfd` | 0.15.4 | [0.17.2](https://crates.io/crates/rfd/0.17.2) | `0.15` | [Notes](https://github.com/PolyMeilex/rfd/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `rustix` | 0.38.44 | [1.1.5](https://crates.io/crates/rustix/1.1.5) | `0.38` | [Notes](https://github.com/bytecodealliance/rustix/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `rustls` | 0.23.42 | [0.23.45](https://crates.io/crates/rustls/0.23.45) | `0.23` | [Notes](https://github.com/rustls/rustls/security/advisories/GHSA-2mjx-qc3c-rqvc) — Correctif TLS ; prioritaire. |
| `scraper` | 0.22.0 | [0.27.0](https://crates.io/crates/scraper/0.27.0) | `0.22` | [Notes](https://github.com/rust-scraper/scraper/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `serde_json` | 1.0.151 | [1.0.154](https://crates.io/crates/serde_json/1.0.154) | `1.0, 1` | [Notes](https://github.com/serde-rs/json/releases/tag/v1.0.154) — Dernier patch : preserve_order en no_std ; intérêt immédiat limité pour Sion. |
| `sha2` | 0.10.9 | [0.11.1](https://crates.io/crates/sha2/0.11.1) | `0.10` | [Notes](https://github.com/RustCrypto/hashes/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `tauri` | 2.11.5 | [2.12.3](https://crates.io/crates/tauri/2.12.3) | `2` | [Notes](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md) — Lot coordonné avec runtime, Wry, plugins et API JS. |
| `tauri-build` | 2.6.3 | [2.7.2](https://crates.io/crates/tauri-build/2.7.2) | `2` | [Notes](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-build/CHANGELOG.md) — Suivi des ressources, packaging et nouveaux gabarits Android. |
| `tauri-plugin-global-shortcut` | 2.3.2 | [2.4.1](https://crates.io/crates/tauri-plugin-global-shortcut/2.4.1) | `2` | [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/global-shortcut/CHANGELOG.md) — Correctif de deadlock ; même version côté JS. |
| `tauri-plugin-log` | 2.9.0 | [2.10.1](https://crates.io/crates/tauri-plugin-log/2.10.1) | `2` | [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/log/CHANGELOG.md) — Intégration API globale et logs webview ; même version côté JS. |
| `tauri-plugin-notification` | 2.3.3 | [2.6.0](https://crates.io/crates/tauri-plugin-notification/2.6.0) | `2.3.3` | [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/CHANGELOG.md) — Actions desktop, permissions Windows, API Android ; même version côté JS. |
| `tauri-plugin-updater` | 2.12.0 | [2.13.3](https://crates.io/crates/tauri-plugin-updater/2.13.3) | `2.12` | [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md) — Signatures renforcées, TLS Linux, installation macOS. |
| `tauri-plugin-window-state` | 2.4.1 | [2.5.0](https://crates.io/crates/tauri-plugin-window-state/2.5.0) | `2` | [Notes](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/window-state/CHANGELOG.md) — Intégration API globale et minimum Rust 1.90. |
| `tauri-runtime-wry` | 2.11.4 (fork Sion) | [2.12.1](https://crates.io/crates/tauri-runtime-wry/2.12.1) | Patch local | [Notes](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/CHANGELOG.md) — Fork local GTK/vidéo à reprendre ; Wry ^0.57 requis. |
| `tiny-skia` | 0.11.4 | [0.12.0](https://crates.io/crates/tiny-skia/0.12.0) | `0.11` | [Notes](https://github.com/linebender/tiny-skia/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `tokio` | 1.53.1 | [1.53.2](https://crates.io/crates/tokio/1.53.2) | `1` | [Notes](https://github.com/tokio-rs/tokio/releases/tag/tokio-1.53.2) — Verrous, timers, canaux et arrêt de processus Windows. |
| `transcribe-cpp` | 0.1.3 | [0.4.0](https://crates.io/crates/transcribe-cpp/0.4.0) | `0.1.3` | [Notes](https://github.com/handy-computer/transcribe.cpp/compare/v0.1.3...v0.4.0) — Mémoire Parakeet, diarisation et flux ; revue API/backend native. |
| `tungstenite` | 0.24.0 | [0.30.0](https://crates.io/crates/tungstenite/0.30.0) | `0.24` | [Notes](https://github.com/snapview/tungstenite-rs/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `wayland-client` | 0.31.14 | [0.31.15](https://crates.io/crates/wayland-client/0.31.15) | `0.31` | [Notes](https://github.com/Smithay/wayland-rs/blob/master/wayland-client/CHANGELOG.md) — Patch 0.31 ; ne pas confondre avec les ruptures de la section Unreleased. |
| `webrtc-sys` | 0.3.47 (fork Sion) | [0.3.49](https://crates.io/crates/webrtc-sys/0.3.49) | `=0.3.47` et patch local | [Notes](https://github.com/livekit/rust-sdks/releases/tag/webrtc-sys/v0.3.49) — Fixé =0.3.47 dans Sion ; fork C++ à reprendre. |
| `windows` | 0.58.0 | [0.62.2](https://crates.io/crates/windows/0.62.2) | `0.58` | [Notes](https://github.com/microsoft/windows-rs/releases) — Migration des API COM/Win32 ; associer windows-core 0.62.2. |
| `windows-core` | 0.58.0 | [0.100.0](https://crates.io/crates/windows-core/0.100.0) | `0.58` | [Notes](https://github.com/microsoft/windows-rs/releases) — 0.100 existe, mais windows 0.62.2 demande ^0.62.2 : éviter de prendre chaque latest isolément. |
| `wl-clipboard-rs` | 0.9.3 | [0.9.4](https://crates.io/crates/wl-clipboard-rs/0.9.4) | `0.9` | [Notes](https://github.com/YaLTeR/wl-clipboard-rs/blob/master/CHANGELOG.md) — Copies interrompues, MIME KDE et données sensibles. |
| `wry` | 0.55.1 (fork Sion) | [0.57.0](https://crates.io/crates/wry/0.57.0) | Patch local | [Notes](https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md) — Fork mémoire WebKit à reprendre ; corrections Windows/Android. |
| `x11rb` | 0.13.2 | [0.14.0](https://crates.io/crates/x11rb/0.14.0) | `0.13` | [Notes](https://github.com/psychon/x11rb/releases) — Changement de branche ; revue des API et du changelog nécessaire. |
| `zbus` | 5.18.0 | [5.19.0](https://crates.io/crates/zbus/5.19.0) | `5` | [Notes](https://github.com/z-galaxy/zbus/blob/main/zbus/CHANGELOG.md) — Backends additifs ; ne supprime pas notre besoin de correctif notify-rust. |
| `zip` | 0.6.6 | [9.0.2](https://crates.io/crates/zip/9.0.2) | `0.6` | [Notes](https://github.com/zip-rs/zip2/blob/master/CHANGELOG.md) — Migration importante depuis 0.6 ; revoir les API d’archives utilisées. |

### Crates sans version stable plus récente

- `ab_glyph` 0.2.32
- `anyhow` 1.0.104
- `arboard` 3.6.1
- `futures-util` 0.3.34
- `httpdate` 1.0.3
- `image` 0.25.10
- `jni` 0.21.1, 0.22.4 — 0.21.1 et 0.22.4 coexistent volontairement : Tauri/WebRTC et le vérificateur TLS utilisent des API distinctes.
- `jpeg-rusturbo` 0.9.2
- `khronos-egl` 6.0.0
- `matrix-sdk` 0.19.1
- `matrix-sdk-crypto` 0.19.1
- `mime` 0.3.17
- `nnnoiseless` 0.5.2
- `qrcode` 0.14.1
- `raw-window-handle` 0.6.2
- `rustls-platform-verifier` 0.7.1
- `semver` 1.0.28
- `serde` 1.0.229
- `softbuffer` 0.4.8 — fork Sion à conserver.
- `sys-locale` 0.3.2
- `tempfile` 3.27.0
- `thiserror` 2.0.21
- `tract-onnx` 0.23.8
- `urlencoding` 2.1.3
- `wayland-egl` 0.32.11
- `wayland-protocols-wlr` 0.3.12
- `wayland-sys` 0.31.11
- `webkit2gtk` 2.0.2
- `webrtc-sys-build` 0.3.19
- `winit` 0.30.13
- `xkeysym` 0.2.1

### Dépendance Git et workspace auxiliaire

`rdev` suit le fork rustdesk-org. Le verrou contient `a90dbe1172f8832f54c97c62e823c5a34af5fdfe` ; la tête amont consultée est `0904f23ce496e255461a98848b85c11fa5a62eab`, avec 15 commits supplémentaires. Les changements portent notamment sur les codes de touches Linux/JIS et les diagnostics macOS. Le verrou fixe bien la révision actuelle, mais le manifeste ne précise pas de `rev` : une future mise à jour Git la changera. [Diff exact](https://github.com/rustdesk-org/rdev/compare/a90dbe1172f8832f54c97c62e823c5a34af5fdfe...0904f23ce496e255461a98848b85c11fa5a62eab).

`server/conservation/planner-check` a son propre verrou : serde 1.0.229 est à jour ; serde_json 1.0.151 peut passer à 1.0.154. Ce workspace ne constitue pas le graphe complet du serveur déployé.

## Android

Versions stables relevées dans les registres officiels. Une mise à jour de bibliothèque AndroidX n'est pas une mise à jour du moteur Android System WebView installé sur le téléphone.

| Composant | Projet | Dernière stable | Notes officielles / vérification |
| --- | --- | --- | --- |
| Android Gradle Plugin | 8.11.0 | 9.4.1 | [AGP 9.4](https://developer.android.com/build/releases/agp-9-4-0-release-notes) : Gradle >=9.6 et JDK 17. [AGP 9](https://developer.android.com/build/releases/agp-9-0-0-release-notes) change le DSL et intègre Kotlin. Version déclarée à deux endroits, dont buildSrc. |
| Gradle | 8.14.3 | 9.8.1 | [Notes 9.8.1](https://docs.gradle.org/9.8.1/release-notes.html). Migration avec AGP et le plugin Rust local. |
| Kotlin Gradle Plugin | 1.9.25 | 2.4.21 | [Notes Kotlin](https://kotlinlang.org/docs/releases.html). La DSL `kotlinOptions` actuelle est à migrer ; décider de l'intégration Kotlin avec AGP. |
| NDK | 27.2.12479018 | 30.0.16248370 (r30 LTS) | [Téléchargements et historique](https://developer.android.com/ndk/downloads). Synchroniser Gradle, build-android.sh et CI ; vérifier les bibliothèques natives, pas de besoin établi de migration immédiate. |
| androidx.webkit | 1.14.0 | 1.17.1 | [Notes](https://developer.android.com/jetpack/androidx/releases/webkit). 1.17.1 retire Kotlin de cette bibliothèque pour éviter des problèmes kotlinc. |
| androidx.appcompat | 1.7.1 | 1.8.0 | [Notes](https://developer.android.com/jetpack/androidx/releases/appcompat). Vérifier la compilation Android et les comportements de thème. |
| androidx.activity:activity-ktx | 1.10.1 | 1.13.0 | [Notes](https://developer.android.com/jetpack/androidx/releases/activity). Vérifier les exigences SDK/Kotlin et le retour système. |
| Material Components | 1.12.0 | 1.14.0 | [Notes](https://github.com/material-components/material-components-android/releases). Vérifier les thèmes et exigences Android du lot. |
| androidx.media | 1.7.0 | 1.8.0 | [Notes](https://developer.android.com/jetpack/androidx/releases/media). Vérifier session média/notifications. |
| androidx.work:work-runtime-ktx | 2.10.0 | 2.12.0 | [Notes](https://developer.android.com/jetpack/androidx/releases/work). Vérifier les tâches de fond et contraintes de compilation. |

Le composant Kotlin `org.rustls:rustls-platform-verifier` est dérivé automatiquement de la version `rustls-platform-verifier-android` du Cargo.lock, actuellement 0.2.0. Ne pas le mettre à jour indépendamment de la crate Rust associée, elle-même à jour en 0.7.1.

La dernière version de Tauri fournit également de nouveaux gabarits Android (Gradle 9.6.1 / AGP 9.3.1 / Kotlin 2.2 dans le changelog tauri-build). Il faudra comparer ces gabarits avec nos fichiers, qui contiennent des adaptations de signature, de configuration réseau et de compilation native, plutôt que les remplacer sans revue.

## Ordre de travail proposé et validations

1. Correctifs isolables : Rustls, DOMPurify, Highlight.js, Zustand, Jose ; patches Tokio/serde_json/log/open/clipboard ; Vite 7.3.7, Vitest 4.1.11 et typescript-eslint 8.71.2. Valider le build et les tests pertinents du chat, de l'authentification, des stores persistants et du presse-papiers.
2. LiveKit/WebRTC : reprendre les forks sur les trois versions compatibles, puis vérifier appels Linux/Windows/Android, changement de micro, caméra/flou, partage d'écran, SDP/BUNDLE, déconnexion/reconnexion et codecs matériel/logiciel.
3. Tauri/Wry/plugins : coordonner Rust/JS et patches Linux ; vérifier les fenêtres, la vidéo native, les notifications, les raccourcis, les mises à jour et le packaging.
4. Transcription : migrer transcribe-cpp et éventuellement earshot dans un lot dédié ; mesurer mémoire/temps de traitement avec les modèles livrés et vérifier la fin de parole.
5. Migrations indépendantes : traductions, React 19.3, Vite 8/outils de tests, Android et API Windows. TypeScript 7 attend une chaîne de lint compatible.

La CI utilise Bun 1.3.9, tandis que la machine utilise 1.4.0 : aligner ce choix pendant une mise à jour de l'outillage pour garder des résultats reproductibles.

Ce contrôle vérifie les publications, les notes pertinentes et des contraintes explicites. Il ne valide pas la compilation après migration et ne remplace pas un audit complet des vulnérabilités transitives. Les autres lignes dont les notes restent à examiner sont signalées dans le tableau Rust.
