# Roadmap 2.0.0 — Interface en bulles, lecteur natif, PIP système, thèmes

Document vivant pour la 2.0.0 finale. Interface actualisée le 07/10/2026 sur
`feat/interface-bulles` ; validations du lecteur et des thèmes ci-dessous
conservées depuis le bilan du 24/09.

> **État d'avancement de l'interface (07/10/2026)**
>
> ✅ **Chantier 1 (interface en bulles)** : rail de navigation, bulle des
> salons, conversation et panneau latéral unique. Store `sion-layout` v6
> migré depuis les dispositions précédentes ; sidebar déployée / rail /
> masquée (Ctrl+B), côté gauche ou droit, panneau redimensionnable de 300 à
> 520 px et superposé sous 1100 px. La voix reste dans la carte de profil.
> Les fonds se règlent dans l'apparence ; les profils `.sionprofil`
> conservent thème, accent, fonds et sons, et ignorent l'ancienne disposition.
> Le mode édition, les trois zones, les presets et les panneaux flottants
> de la dock sont retirés. Le partage flottant et le PIP natif restent disponibles.
> Détails et validations : [interface-bulles.md](interface-bulles.md).
>
> 🟡 **Chantier 2 (partage et lecteur natifs)** : surface native par défaut
> sous Linux (GtkGLArea rendu à la demande, agrandissement bicubique et pose
> au pixel près depuis le 23/09), sous-surface EGL Wayland en opt-in
> (`SION_WAYLAND_SUBSURFACE`), surface HWND sous Windows, PIP système natif.
> Depuis l'alpha 9, la vidéo est **percée sous les menus** et panneaux au lieu
> de passer dessus (Linux et Windows). Le **lecteur vidéo du fil** passe aussi
> par ffmpeg et la même surface (contrôles incrustés, mini-lecteur, ffmpeg
> livré). Restent la mesure de fluidité Linux, la validation Windows côté
> spectateur et le retrait du repli JPEG — voir §2.3.
>
> 🟡 **Chantier 3 (thèmes)** : tokenisation et garde anti-hex, Dark / Light /
> AMOLED, application avant le premier rendu, import/export JSON, et depuis
> le 24/09 **garde de contraste WCAG** (test sur les thèmes livrés,
> avertissement à l'import), **aperçu au survol** et **couleur d'accent**
> personnalisée. Restent `outline` de Sion Light et la synchronisation
> Matrix — voir §3.4.
>
> ⏳ **Hors chantiers, avant la 2.0.0** : voir §6 (fonctions retirées avec
> l'ancien moteur, points de fiabilité).
>
> 📌 **Décision du 24/09** : la 2.0.0 est **réservée aux ordinateurs** (Linux,
> Windows). Android revient, compatible, dans une 2.1.

---

## 0. État des lieux (constats vérifiés dans le code)

| Sujet | Constat | Fichier |
|---|---|---|
| Interface | store v6 migré, sidebar trois états et deux côtés, bulles, panneau unique, onglets, carte de profil, profils sans disposition | `useLayoutStore.ts`, `Bulle.tsx`, `PanneauLateral.tsx`, `CarteProfil.tsx`, `profilService.ts` |
| Partage natif | Linux : I420 → BGRA → texture d'un `GtkGLArea` rendu à la demande (bicubique, pose au pixel près) ; sous-surface EGL en opt-in ; Windows : I420 → BGRA → HWND/GDI, agrandi par libyuv. Surface percée sous les menus. Opt-out diagnostic `SION_DISABLE_NATIVE_VIDEO_SURFACE=1` | `native_video_surface.rs`, `voice_engine.rs`, `voiceNativeService.ts` |
| Lecteur vidéo du fil | ffmpeg en sous-processus → plans I420 → même surface native ; contrôles incrustés en Rust, mini-lecteur, ffmpeg livré | `lecteur_video.rs`, `incrustation_lecteur.rs`, `NativeVideoPlayer.tsx` |
| PIP système | vraie fenêtre OS winit + softbuffer, always-on-top, redimensionnable, persistée et alimentée directement en BGRA | `src-tauri/src/pip_window.rs` |
| Fallback | JPEG/SVF1/WebSocket toujours dans le code, utilisé seulement sans surface native | `native_video_transport.rs` |
| Cible restante | mesure de fluidité Linux, validation Windows côté spectateur, transitions/DPI multi-écrans, retrait du fallback JPEG | voir §2.3 |
| Thèmes | tokenisation et garde anti-hex ; Dark/Light/AMOLED ; application au boot ; import/export JSON ; garde de contraste WCAG ; aperçu au survol | `src/themes/`, `themeService.ts`, `useThemeStore.ts` |

Point clé : ni le PIP système ni le lecteur intégré natif ne font traverser
les pixels dans WebKit. La WebView publie uniquement les rectangles visibles ; Rust garde une file
latest-wins par expéditeur et peint les frames directement.

---

## 1. Chantier 1 — Interface en bulles

Implémentation du [plan du 07/10](superpowers/plans/2026-10-07-interface-bulles.md)
sur `feat/interface-bulles`, à intégrer pour la 2.0.0 finale.

- **Coque** : rail de 72 px, bulle des salons, bulle de conversation et bulle
  du panneau. Rayon 20 px, écart 12 px, cartes de contenu à rayon 14 px ;
  couleurs issues du thème et fonds par portée conservés.
- **Navigation** : le rail ouvre le compte, l'administration si autorisée,
  les réglages et replie le menu. Transcription, soundboard et memeboard
  passent en onglets de conversation ; épinglés et membres restent à droite.
- **Voix** : carte de profil en bas du menu, commandes micro / casque /
  réglages / raccrocher ; participants en avatars superposés et dépliage explicite.
- **Panneau unique** : `panneau: PanneauId | null`, largeur persistée de
  300 à 520 px (360 px par défaut), poignée accessible au clavier, Échap
  et retour du focus. Sous 1100 px, il se superpose au chat. Sur téléphone,
  il utilise la feuille existante.
- **Conversation** : soundboard en deux colonnes, filtres et volume ; saisie
  desktop sur deux lignes avec mention, lien, fichier, GIF et emoji ; actions
  de message placées sous le texte. La saisie mobile conserve son organisation.
- **Migration** : reprise du panneau actif à droite, des dimensions de la
  sidebar, des fonds et du partage. Anciennes zones et cartes abandonnées ;
  ancienne section disposition ignorée à l'import des profils.
- **Vidéo** : surface native rectangulaire à l'intérieur des bulles ; les
  panneaux superposés sont pris en compte dans les trous envoyés à Rust.

La validation réelle du partage reçu et du lecteur plein écran sur Linux
et Windows reste à faire avant intégration. Le bilan précis de compilation,
tests, aperçu et performance se trouve dans `interface-bulles.md`.

---

## 2. Chantier 2 — Lecteur natif et PIP système du partage d'écran

### 2.1 Expérience de lecture — ✅ livrée, rendu natif Linux en validation

La vue en ligne, le plein écran, la mosaïque multi-partages et la carte
flottante interne sont fonctionnels. Les contrôles audio sont propres à chaque
partage et les curseurs restent ciblés sur le bon expéditeur. La carte interne
conserve sa position et sa taille via `useLayoutStore.shareFloating` ;
**Ctrl+Shift+P** la bascule en ligne/flottante.

Sous Linux, `spawn_video_pump` réduit la frame I420 décodée par libwebrtc à la
plus grande surface native visible, la convertit en BGRA via libyuv et la
dépose dans une file latest-wins. Une `GtkDrawingArea` compose la dernière
frame via une texture GL et `gdk_cairo_draw_from_gl` aux rectangles DOM de la
vue simple, de la mosaïque ou de la carte flottante ; Cairo reste le repli et
peint les curseurs. Aucun pixel ne traverse l'IPC ; le canvas WebKit est un
placeholder de géométrie et d'interactions uniquement. Son suivi est cadencé à
4 Hz plutôt que par une boucle `requestAnimationFrame` permanente.

### 2.2 PIP système natif — ✅ livré

`src-tauri/src/pip_window.rs` fournit une vraie fenêtre OS sans décoration,
always-on-top et indépendante de la webview :

- fenêtre winit + softbuffer, préchauffée au lancement ; X11/XWayland sous
  Linux pour garantir l'always-on-top, backend natif sous Windows ;
- glisser pour déplacer, redimensionnement libre par les bords, bornes
  240×135 → 1920×1080 et double-clic pour basculer le preset 768×432 ;
- position et taille persistées dans `pip-state.json`, avec rappel au coin
  proche lors de la restauration ;
- boutons natifs retour à Sion, son et pointeur ; clic droit ou Échap pour
  fermer ; fermeture automatique lorsque le partage prend fin ;
- lorsque ce PIP est ouvert, il reçoit directement le BGRA de libyuv et le
  blitte dans softbuffer : aucun encodage/décodage JPEG.

Le bouton retour appelle bien `show`/`unminimize`/`set_focus`. Sous Wayland,
le compositeur peut refuser l'activation sans jeton utilisateur, car le PIP
always-on-top vit sous XWayland ; dans ce cas Sion demande l'attention. Cette
limitation du protocole n'empêche ni l'affichage ni les autres contrôles du
PIP. Le Document PiP WebKit n'est plus un objectif : la fenêtre native couvre
déjà le besoin de PIP système.

### 2.3 Lecteur principal entièrement natif — 🟡 pixels natifs, isolation du compositeur en cours

**État au 24/09/2026** (les paragraphes datés plus bas sont l'historique) :

- **Linux** : le `GtkGLArea` est le chemin par défaut, rendu **à la
  demande** (une image = un rendu, plus de composition continue). Depuis le
  23/09, l'agrandissement est bicubique (Catmull-Rom) et une image réduite
  pour sa zone est posée au pixel près (`rect_affiche`) : le partage reçu
  n'est plus crénelé. La sous-surface EGL Wayland existe, hors composition
  WebKit, mais reste en opt-in (`SION_WAYLAND_SUBSURFACE`).
- **Menus par-dessus la vidéo** (alpha 9) : la page relève ce qui passe devant
  la vidéo (panneaux flottants, menus, dialogues) et Rust perce la surface à
  ces endroits — trous transparents sous Linux, région découpée sous
  Windows. Journal : « trous dans la vidéo : N ».
- **Windows** : surface HWND en place depuis le 18/09. Depuis le 24/09,
  libyuv agrandit l'image jusqu'à sa zone (au plus ×2), car `StretchDIBits`
  n'agrandit qu'au plus proche voisin — **compilation Windows de ce dernier
  changement encore à vérifier**.
- **Lecteur vidéo du fil** : même surface, alimentée par ffmpeg (voir
  `docs/lecteur-video-natif.md`).

Reste, dans cet ordre :

1. **Mesurer la fluidité Linux** avec le rendu à la demande actuel (le 16/09 :
   ~38 % d'un cœur côté `WebKitWebProcess` pendant un partage). Si le coût
   reste là, décider de passer la sous-surface EGL par défaut.
2. **Valider Windows côté spectateur** avec l'installeur : netteté d'un partage
   agrandi, trous sous les menus, curseurs, DPI multi-écrans.
3. **Retirer le repli JPEG/SVF1** (`native_video_transport.rs`) une fois 1 et 2
   acquis — critères de sortie ci-dessous.

**Socle livré (15/09/2026)** : le pin Git Tauri hérité de CEF a été retiré.
Le client utilise les crates Tauri 2 stables (`tauri` 2.11.5,
`tauri-runtime-wry` 2.11.4). Seul le runtime WRY est vendorié : son
gestionnaire Linux retrouve maintenant la vraie `GtkWindow` dans les ancêtres
de la WebView au lieu de supposer la hiérarchie fixe
`WebView → GtkBox → GtkWindow`. Cela supprime le crash GTK lors de l'ajout d'un
`GtkOverlay` tout en conservant le redimensionnement souris et tactile des
fenêtres sans décorations. Le patch et sa procédure de retrait sont documentés
dans `src-tauri/vendor/tauri-runtime-wry/SION_PATCH.md`.

**Implémentation validée en direct (15/09/2026)** : le runtime WRY crée un
`GtkOverlay` avant la WebView. `native_video_surface.rs` y installe une
`GtkDrawingArea` bornée à l'union des rectangles fournis par le front, avec une
région d'entrée native vide. Elle conserve uniquement la dernière frame BGRA
par expéditeur et la charge dans une texture GL composée par GDK, sans bloquer
les clics du DOM. Le repli Cairo reste disponible si le contexte GL ou
l'upload BGRA ne sont pas supportés. Le moteur contourne alors complètement
`encode_jpeg_rgba` et `native_video_transport`. Le PIP système partage ce
chemin BGRA direct via softbuffer.

Les curseurs des autres viewers et leurs ondes de clic sont peints dans le
même Cairo (`draw_viewer_cursors`) : en mode natif le calque DOM est occlu
par la peinture GTK, c'est désormais le seul chemin où les voir. Le filtre
« pointe un partage affiché par cette fenêtre » est fait en Rust
(`forward_cursor_to_viewer_surface`), même couleur par identité que l'overlay
du partageur (`cursor_overlay::draw::identity_color_rgba8`), même TTL 5 s,
même plafond d'ondes, latest-wins partout.

Les essais interactifs ont révélé puis fermé deux défauts Wayland distincts :
une surface overlay plein écran interceptait toutes les entrées, puis le
renderer DMA-BUF de WebKitGTK 2.52 conservait visuellement la première texture
alors que les empreintes BGRA et les callbacks Cairo changeaient. La surface
est désormais bornée et input-transparent. Le contournement
`WEBKIT_DISABLE_DMABUF_RENDERER=1` avait débloqué la texture mais saturait
WebKit au repos ; il reste donc limité au repli de crash NVIDIA et au diagnostic
explicite `SION_NATIVE_VIDEO_SOFTWARE_COMPOSITING=1`. Deux captures espacées ont
confirmé l'orientation et 8,6 % de pixels différents dans la zone vidéo. La
surface native est active par défaut depuis le 16/09 ;
`SION_DISABLE_NATIVE_VIDEO_SURFACE=1` force le fallback pour le diagnostic.

**Blocage performance constaté le 16/09/2026** : même sans aucun pixel, Blob
ou canvas vidéo dans JavaScript, le `GtkGLArea` reste composé dans le même
toplevel GTK que WebKit. Avec un partage actif, `sion-client` consomme environ
52 % d'un cœur et `WebKitWebProcess` environ 38 % ; les clics et changements
d'état deviennent visiblement tardifs. Le prochain jalon est donc une vraie
surface enfant indépendante (`wl_subsurface` sous Wayland, fenêtre enfant X11
sous X11/XWayland), avec le backend GTK actuel en repli. Le diagnostic, les
essais annulés et le plan de reprise sont consignés dans
[`native-video-surface-handoff.md`](native-video-surface-handoff.md).

**Windows (16/09/2026)** : WebView2 publie les mêmes rectangles CSS et Rust
crée un HWND enfant borné par rectangle, converti en pixels physiques avec le
facteur DPI de la fenêtre. La dernière frame BGRA est peinte directement par
`StretchDIBits` (letterbox inclus), sans JPEG, Blob ni canvas. `WM_NCHITTEST`
retourne `HTTRANSPARENT` afin que les interactions atteignent la WebView. Le
code passe le contrôle croisé Rust jusqu'au build des dépendances natives ; la
validation visuelle/perf sur une vraie session Windows reste un critère de
sortie avant suppression du fallback.

Critères de sortie :

1. plus d'appel à `encode_jpeg_rgba` dans le chemin des partages reçus ;
2. plus de WebSocket `native_video_transport` pour transporter les pixels ;
3. plus de `Blob`, `createImageBitmap`, `Image` ou peinture canvas pour le
   média dans `ScreenShareView` ;
4. une seule source latest-wins par expéditeur, partagée entre les surfaces
   visibles sans redécodage ni file non bornée ;
5. parité fonctionnelle : sélection multi-partages, mosaïque, plein écran,
   carte flottante, audio, pointeurs, fin de piste et reconnexion ;
6. nettoyage déterministe de chaque surface et frame à la fermeture, au
   changement de partage et à la déconnexion ;
7. validation Linux Wayland/X11 et Windows, avec mesures réception→pixels,
   cadence, CPU, RSS/PSS et test d'arrêt/reprise prolongé.

Les critères média 1 à 4 et le nettoyage déterministe sont validés sur Linux.
L'affichage direct fonctionne, mais la fluidité globale n'est pas encore un
critère acquis tant que la surface GTK réveille la composition WebKit. La
surface média Windows est codée ; restent sa validation réelle, les
contrôles/curseurs superposés, les transitions prolongées et le DPI
multi-écrans. Le pont JPEG/SVF1 demeure uniquement comme fallback de sûreté
jusqu'à cette validation.

## 3. Chantier 3 — Thèmes

### 3.1 Pourquoi c'est réaliste (et pas un chantier d'un an)

Ton app a déjà tout ce qu'il faut : **41 tokens `--color-*`** dans le bloc
`@theme` de `index.css`. Tailwind 4 compile les utilitaires en
`var(--color-surface-container-low)` etc. → **changer de thème = réécrire des
valeurs de custom properties à l'exécution**, sans rebuild ni refonte CSS.

C'est exactement l'approche Material Design 3 : des rôles (surface, on-surface,
primary-container…) et des palettes qui les remplissent. Le thème actuel
**est déjà** une palette M3 dark ; on rend cette indirection dynamique.

### 3.2 Architecture proposée

**Trois axes indépendants** :

1. **Mode** : `dark` / `light` → synchro `color-scheme` (WebKitGTK en dépend
   pour les selects/scrollbars natifs, cf. commentaire `index.css:330-348`).
2. **Palette** : le thème lui-même (« Sion Dark », « Sion Light », « AMOLED »,
   « Nord »…).
3. **Accent** (optionnel, phase ultérieure) : une couleur *seed* d'où l'on
   dérive `primary`, `primary-container`, `on-primary*`.

**Application runtime** — un seul point d'entrée :

```ts
// themeService.ts
function applyTheme(theme: Theme, mode: ThemeMode) {
  const t = resolve(theme, mode);            // ThemeTokenValues typé
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) {
    root.style.setProperty(`--color-${k}`, v);
  }
  root.dataset.theme = theme.id;
  root.style.colorScheme = mode;
}
```

- Appelé au boot **avant le premier paint** (côté `main.tsx`/`index.html` :
  lire un mini-subset en `localStorage` et inliner le thème pour éviter le
  flash blanc/bleu au démarrage — même souci que la splash actuelle).
- `themeStore` (zustand persist) : `themeId`, `mode`, `accent`, `customThemes[]`.
- Sync de la fenêtre Tauri (`appWindow.setTheme`) pour la barre de titre
  Windows ; sous Linux GTK on reste sur `color-scheme`.

**Format d'un thème** (aussi le format d'échange communautaire, si tu en veux) :

```json
{
  "id": "sion-dark",
  "name": "Sion Dark",
  "mode": "dark",
  "tokens": { "surface": "#111318", "primary": "#a8c7fa", "…": "…" }
}
```

Whitelist stricte de clés = les 41 tokens (+ 4-6 tokens supplémentaires pour
ombres/états). Jamais de CSS arbitraire dans un thème importé ; les valeurs
validées comme couleurs CSS pures.

### 3.3 Phase 1 obligatoire : la tokenisation complète

Avant de faire des thèmes, finir l'audit — **zéro changement visuel** :

- 12 hex en dur hors `index.css` :
  `UserControls.tsx` (1), `VerificationBanner.tsx` (3), `Message.tsx` (4),
  `TranscriptPanel.tsx` (1), `AudioPreview.tsx` (1), `AudioTrimmer.tsx` (2).
- Dans `index.css` : `select option { background: #1f1f24 }`, le chevron SVG
  en data-URL (`stroke='%23c9c9d0'` → à générer depuis un token), les
  `rgba(0,0,0,…)` d'ombres et le `speaking-glow` `rgba(125,220,135,…)`.
- Ajouter 3-6 tokens de plus : `--shadow-*`, `--color-glow` (parler), pour
  couvrir ces cas proprement.
- Vérifier les endroits qui supposent « fond sombre » (bordures claires,
  `box-shadow` noirs) — c'est la que se cache la vraie dette d'un thème clair.

✅ L'acquis est verrouillé par `src/services/themeGuard.test.ts` : tout nouveau
`#hex` sous `src/` (hors `src/themes/`, qui EST le thème) fait échouer la suite
de tests — sauf les deux échappatoires documentées, le repli de
`themeColor("--token", "#repli")` et la ligne marquée `theme-exempt`.

### 3.4 Phases

| Phase | Contenu | Risque |
|---|---|---|
| ✅ 1 | Tokenisation complète (§3.3) + garde anti-hex (`services/themeGuard.test.ts`) | très faible |
| ✅ 2 | `themeStore` + `applyTheme` + section **Apparence** dans SettingsPanel + « Sion Dark » (actuel) + « AMOLED » | faible |
| ✅ 3 | « Sion Light » — palette complète claire livrée ; contraste vérifié par test (24/09). Un point à trancher : `outline`, employé 77 fois comme texte secondaire (horodatages, indications), n'atteint que 4,26:1 sur `surface` et 3,45:1 sur le conteneur le plus foncé — assez pour un élément d'interface (3:1), pas pour du texte (4,5:1). Le foncer foncerait aussi les bordures | moyen |
| ✅ 4 | Accent seed (24/09) : `@material/material-color-utilities` (Google, Apache-2.0), schéma « tonal spot » — `themes/accent.ts`. Il ne redéfinit que primary / secondary / tertiary / accent, par-dessus n'importe quel thème, clair ou sombre ; 7 pastilles + couleur libre, aperçu au survol ; chaque pastille est testée contre les seuils de contraste sur les trois thèmes livrés | moyen |
| 5 | ✅ Import/export JSON (livré avec la phase 2 — thèmes partiels acceptés, `custom-` rétabli au re-import) ; ✅ **aperçu au survol** (24/09) ; ✅ **garde de contraste WCAG** (24/09, `themes/contrast.ts` : test sur les thèmes livrés, avertissement à l'import) — reste, en option : sync Matrix `com.sion.theme` en account data → le thème suit le compte sur tous les appareils | faible |

**Apparence dans SettingsPanel** : grille de vignettes (aperçu 3 couleurs :
surface / primary / texte), toggle dark/light, picker accent, bouton « importer
un thème », « réinitialiser ».

### 3.5 Garde-fous

- **Contraste** : vérifier WCAG AA (≥ 4.5:1 sur les paires texte/fond
  principales) et afficher un warning si un thème importé échoue — l'utilisateur
  reste maître, mais informé.
- **Thème au boot** : sous-ensemble minimal en `localStorage` appliqué avant
  React (éviter le flash au lancement, surtout en mode clair).
- Le thème ne touche **pas** les pixels du partage ni les couleurs des
  curseurs distants dérivées de l'identité. Les contrôles placés au-dessus de
  la surface native continuent, eux, d'utiliser les tokens du thème.

---

## 4. Ordre de réalisation conseillé pour la 2.0.0 finale

1. 🚧 **Parité du partage natif** (§2.3) — mesurer la fluidité Linux,
   valider Windows côté spectateur, puis retirer le repli JPEG.
2. 🚧 **Interface en bulles** (§1) — valider partage / lecteur natifs et
   le rendu sur téléphone réel avant intégration de `feat/interface-bulles`.
3. ⏳ **Thèmes** (§3.4) — `outline` de Sion Light, et décision sur la
   synchronisation Matrix `com.sion.theme`.

Android n'est plus une étape de la 2.0.0 : décision du 24/09, voir §6.

Le socle de l'interface en bulles, les profils sans disposition, le PIP
système natif, le lecteur vidéo natif, la tokenisation, Dark / Light /
AMOLED, l'import/export de thèmes, leur aperçu au survol et la garde de
contraste sont livrés ; ils ne sont plus des étapes à planifier.

## 5. Vérifications transverses

- `bun run test` / `lint` / `build` à chaque étape (stores et `applyTheme` se
  testent en vitest sans DOM lourd).
- Stores persistés : ajouter `version` + `migrate` (les utilisateurs alpha ont
  déjà un `localStorage` rempli) ; préserver sidebar, fonds et partage lors
  du passage au panneau unique.
- Lecteur natif : tester les changements de géométrie pendant un drag/resize,
  le passage inline ↔ flottant ↔ plein écran ↔ PIP système, la mosaïque et les
  changements de moniteur/DPI sans flash noir ni surface orpheline.
- Transport vidéo : le runtime Linux doit journaliser `flux direct GTK ...
  BGRA (sans JPEG/WebSocket)` et ne plus produire de statistiques d'encodage
  JPEG ; profiler encore une source 1440p/60 avant suppression du fallback.
- PIP système : garder un test fenêtré opt-in en plus des tests purs de rendu ;
  vérifier always-on-top, restauration position/taille, son, pointeur, retour
  à Sion et fermeture automatique sur Linux et Windows.
- Panneau superposé : vérifier le focus, Échap, la poignée de largeur et
  la visibilité des contrôles devant une vidéo native sous 1100 px.
- Mobile : tout ce qui précède est desktop-only (`isMobile`), ne pas régresser
  les vues tactiles.

## 6. Hors chantiers — à régler avant la 2.0.0

État au 24/09/2026, vérifié dans le code et les journaux.

- **Android → 2.1** (décision du 24/09) : la 2.0.0 sort pour ordinateurs
  seulement. Le moteur vocal Rust n'est pas porté sur Android
  (`build-android.sh` ne compile pas `native-voice`), la voix y est donc
  inactive ; son portage est le chantier de la 2.1 — voir
  `docs/native-voice-validation.md`.
- **Fonctions retirées avec l'ancien moteur**, à refaire en Rust : couper le
  son d'un seul participant (pas de gain par piste exposé) et l'affichage de
  la latence (RTT).
- **Statistiques WebRTC** : `get_stats()` ne fait plus planter Sion (24/09 :
  le JSON refusé devient une erreur journalisée, patch documenté dans
  `vendor/libwebrtc/SION_PATCH.md`), mais le JSON produit par libwebrtc reste
  illisible pour serde dans certains cas — cause à trouver dans le journal
  avant de s'appuyer sur ces statistiques (RTT par exemple).
- **Mémoire en émission de partage** : ~2,4 Go de RSS après 4 minutes de
  partage 1080p, sans redescendre à l'arrêt (mesure du 10/09, build debug) — à refaire en release.
- **AV1 affiché en vert** sur carte AMD (DMA-BUF).
- **Memeboard** : jamais essayée par-dessus un vrai jeu en plein écran ;
  couper la memeboard retire l'image mais laisse finir le son (≤ 10 s).
- **macOS** : le son du partage n'est pas capturé par le moteur natif (si
  macOS fait partie de la cible).

