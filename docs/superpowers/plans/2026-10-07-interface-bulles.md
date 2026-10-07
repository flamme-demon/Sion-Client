# Interface « bulles » — plan d'implémentation

> **Pour les agents :** sous-compétence requise : `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes
> utilisent des cases `- [ ]` pour le suivi.

**Objectif :** donner au bureau la disposition de la maquette du 07/10/2026 —
quatre bulles (barre d'icônes, salons, conversation, panneau latéral) aux
coins arrondis, séparées par un espacement — et ranger les boutons comme elle
le fait : onglets de panneaux dans l'en-tête, contrôles vocaux sous la carte
de profil, saisie sur deux lignes avec un bouton Envoyer.

**Architecture :** la disposition déplaçable (dock à trois zones, cartes
flottantes, mode Réorganiser, préréglages, fichier de disposition) est
**retirée** au profit d'une disposition fixe : la v2 est en bêta et personne
n'en dépend. Un seul panneau latéral, ouvert par les onglets de l'en-tête,
remplace les zones. Les composants des panneaux (soundboard, memeboard,
membres, transcription, épinglés) sont gardés tels quels ; seul leur contenant
change. Le téléphone garde sa feuille de panneaux (`MobilePanelSheet`).

**Pile :** React 19, zustand 5 (`persist`), CSS en ligne + `index.css`, Vitest
(jsdom), Tauri 2 (WebKitGTK sous Linux, WebView2 sous Windows).

**Maquette de référence :** `docs/superpowers/plans/2026-10-07-maquette-bulles.png`.

**Branche :** `feat/interface-bulles`, partie de `main` après la beta 8, créée
avec ce plan. Hors v2 : ne pas fusionner avant la 2.0.0.

## Contraintes globales

- **Bureau seulement** pour la mise en page ; sous 768 px (`useIsMobile`), le
  rendu téléphone actuel reste inchangé (`MobilePanelSheet`, `MobileVoiceBar`).
- **Couleurs : uniquement les variables de thème** (`var(--color-…)`), pour
  que les thèmes, l'accent et `themeGuard.test.ts` restent valides. Une
  couleur hors thème porte le marqueur `theme-exempt`.
- **Pas de `backdrop-filter`** sur les bulles : sous WebKitGTK, un flou
  au-dessus d'un fond animé est recalculé à chaque image (WebKit déjà à 27 %
  d'un cœur mesuré le 06/10). Bulles semi-opaques à la place.
- **Arrondi des bulles : 20 px ; espacement entre bulles et bord de fenêtre :
  12 px.** Arrondi des cartes internes (sons, champ de saisie) : 14 px.
- **Les fonds d'image par panneau sont conservés** (`panelBackgrounds`,
  portées `chat`, `channels`, et une par panneau) : ils s'appliquent à
  l'intérieur de la bulle correspondante.
- **Clé de stockage `sion-layout` conservée**, version passée de 5 à **6** ;
  la migration jette les champs de la dock et ne garde que la barre latérale
  et les fonds.
- Chaque texte visible passe par i18next, en **fr et en**
  (`src/services/i18nKeys.test.ts` le vérifie).
- Après chaque tâche : `bunx tsc -b`, `bun run lint` (0 erreur),
  `bun run test` verts. Commits en français, au format du dépôt
  (`feat(interface): …`).

## Points de vigilance

Ce que les tests des tâches ne couvrent pas et qui se verra en premier :

1. **Vidéo native dans une bulle arrondie.** Le partage d'écran et le lecteur
   sont des fenêtres natives posées sur la page (sous-surface Wayland, HWND
   Windows) : elles restent rectangulaires. Accepté : les coins de la vidéo
   sont carrés, la bulle autour reste arrondie (tâche 4 le documente).
2. **Fenêtre étroite (768 à 1100 px).** Quatre bulles ne tiennent pas : le
   panneau latéral passe par-dessus la conversation (tâche 6), la liste des
   salons se replie en rail (tâche 3).
3. **Raccourcis existants.** Ctrl+B (barre des salons) doit continuer de
   marcher ; Ctrl+Shift+L (Réorganiser) disparaît avec la dock ; Ctrl+Shift+P
   (partage flottant) est gardé.
4. **Profils exportés avant la branche.** `profilService` importe une
   « disposition » : un ancien profil doit s'importer sans erreur, sa
   disposition ignorée (tâche 2).
5. **Bannière de transcription et épinglés.** `TranscriptInviteBanner` et
   `PinnedBar` ouvrent un panneau : ils doivent ouvrir le panneau latéral
   unique (tâche 2), pas une zone disparue.

---

## Structure des fichiers

| Fichier | Rôle après la branche |
|---|---|
| `src/stores/useLayoutStore.ts` | Barre latérale, panneau latéral unique, partage, fonds. Plus de zones ni de cartes flottantes. |
| `src/components/layout/Bulle.tsx` *(nouveau)* | Le contenant arrondi commun aux quatre colonnes. |
| `src/components/layout/RailServeurs.tsx` *(nouveau)* | Barre d'icônes de gauche. |
| `src/components/layout/PanneauLateral.tsx` *(nouveau)* | Bulle de droite : en-tête (titre, compteur, ✕) + corps du panneau actif. Remplace `DockZone`. |
| `src/components/chat/OngletsPanneaux.tsx` *(nouveau)* | Onglets Transcription / Soundboard / Memeboard de l'en-tête. |
| `src/components/sidebar/CarteProfil.tsx` *(nouveau)* | Bas de la barre des salons : avatar, état, micro, casque, paramètres, raccrocher. |
| `src/components/layout/Sidebar.tsx`, `MainArea.tsx`, `App.tsx` | Assemblent les bulles. |
| `src/components/chat/ChatHeader.tsx`, `ChatInput.tsx` | Boutons réorganisés. |
| `src/components/sidebar/ChannelItem.tsx`, `UserControls.tsx`, `ServerHeader.tsx` | Avatars vocaux en ligne, compteurs ; contrôles déplacés. |
| `src/components/chat/SoundboardPanel.tsx` | Puces de filtre, grille 2 colonnes, volume en pied. |
| **Supprimés** | `DockZone.tsx`, `dockZoneContext.tsx`, `FloatingPanels.tsx`, `LayoutPresetsMenu.tsx`, `ResizeHandle.tsx` (si plus utilisé), `services/layoutFile.ts`, `services/layoutPresets.ts` et leurs tests. |

`dockPanels.ts` est gardé (titres et corps des panneaux, partagés avec le
téléphone), renommé `panneaux.ts` à la tâche 2.

---

### Tâche 1 : Branche, maquette et jetons de forme

**Fichiers :**
- Modifier : `src/index.css` (variables de forme, à la suite du bloc `:root` l. 428)
- Créer : `src/components/layout/Bulle.tsx`
- Test : `src/components/layout/Bulle.test.tsx`

**Interfaces :**
- Produit : `function Bulle(props: { as?: "aside" | "main" | "nav" | "section"; scope?: BackgroundScope; className?: string; style?: React.CSSProperties; children: React.ReactNode; "aria-label"?: string }): JSX.Element`
- Produit (CSS) : `--sion-bulle-rayon: 20px`, `--sion-bulle-ecart: 12px`, `--sion-carte-rayon: 14px`, classe `.sion-bulle`.

- [ ] **Étape 1 :** `git switch feat/interface-bulles`, puis `git merge main` pour repartir du `main` le plus récent.
- [ ] **Étape 2 : test qui échoue** — `Bulle.test.tsx` :
  - `it("rend un contenant arrondi avec la classe sion-bulle")` : `container.firstElementChild.classList.contains("sion-bulle")` et la balise vaut `as` (défaut `section`).
  - `it("pose le fond d'image de sa portée")` : avec `scope="chat"` et un fond posé dans le store, le calque `PanelBackgroundLayer` est rendu dans la bulle.
- [ ] **Étape 3 :** lancer `bunx vitest run src/components/layout/Bulle.test.tsx` → ÉCHEC (module absent).
- [ ] **Étape 4 :** écrire `Bulle.tsx` et la classe CSS : `border-radius: var(--sion-bulle-rayon)`, `overflow: hidden`, `background: var(--color-surface-container-low)`, `border: 1px solid var(--color-outline-variant)`, `position: relative`, `display: flex; flex-direction: column; min-height: 0; min-width: 0`. Le fond par portée réutilise `PanelBackgroundLayer` et `BackgroundControls` (`src/services/panelBackground.ts`).
- [ ] **Étape 5 :** relancer le test → SUCCÈS ; `bunx tsc -b`.
- [ ] **Étape 6 :** commit `feat(interface): contenant « bulle » et jetons de forme`.

### Tâche 2 : Retirer la dock, un seul panneau latéral

**Fichiers :**
- Modifier : `src/stores/useLayoutStore.ts`, `src/stores/useLayoutStore.test.ts`, `src/stores/useLayoutStore.repair.test.ts`
- Renommer : `src/components/layout/dockPanels.ts` → `panneaux.ts`
- Modifier : tous les appelants de `openDockPanel` / `toggleDockPanel` / `closeDockPanel` (`ChatHeader.tsx`, `PinnedBar.tsx`, `TranscriptInviteBanner.tsx`, `allerAuMessage.ts`, `MemberPanel.tsx`, `SoundboardPanel.tsx`, `MemeboardPanel.tsx`, `TranscriptPanel.tsx`, `PinnedListPanel.tsx`, `MobilePanelSheet.tsx`, `useKeyboardShortcuts.ts`)
- Modifier : `src/services/profilService.ts` (+ `profilService.test.ts`)
- Supprimer : `DockZone.tsx`, `dockZoneContext.tsx`, `FloatingPanels.tsx`, `LayoutPresetsMenu.tsx`, `layoutFile.ts(+test)`, `layoutPresets.ts(+test)`

**Interfaces :**
- Consomme : rien des tâches précédentes.
- Produit, dans `useLayoutStore` :
  - `type PanneauId = "members" | "soundboard" | "memeboard" | "transcript" | "pinned"` (le bloc `voice` disparaît : les contrôles vocaux vont dans la carte de profil, tâche 5).
  - `panneau: PanneauId | null` (persisté), `largeurPanneau: number` (persisté, bornée 300–520, défaut 360).
  - `ouvrirPanneau(id: PanneauId): void`, `basculerPanneau(id: PanneauId): void` (ouvre, ou ferme s'il est déjà actif), `fermerPanneau(): void`, `setLargeurPanneau(px: number): void`.
  - Conservés tels quels : `sidebarWidth`, `sidebarMode`, `sidebarSide`, `toggleSidebar`, `shareViewMaxVh`, `shareDock`, `shareFloating`, `toggleShareDock`, `panelBackgrounds`, `setPanelBackground`, `resetSidebar`.
  - `type BackgroundScope = "chat" | "channels" | PanneauId`.
- Produit, dans `panneaux.ts` : `PANNEAU_TITRES: Record<PanneauId, string>`, `PANNEAU_CORPS: Record<PanneauId, ComponentType>`.

- [ ] **Étape 1 : tests qui échouent** — réécrire le bloc « dock à zones » de `useLayoutStore.test.ts` :
  - `it("un seul panneau ouvert à la fois")` : `ouvrirPanneau("soundboard")` puis `ouvrirPanneau("members")` → `panneau === "members"`.
  - `it("basculer referme le panneau actif")` : `basculerPanneau("soundboard")` deux fois → `panneau === null`.
  - `it("borne la largeur du panneau")` : `setLargeurPanneau(100)` → 300 ; `setLargeurPanneau(2000)` → 520.
  - `it("migre une disposition v5 sans erreur")` : état persisté v5 avec `dockZones.right.panels = ["soundboard", "members"]`, `dockZones.right.active = "members"`, `floatingPanels`, `voiceInMenu` → après migration : `panneau === "members"`, `sidebarWidth` et `panelBackgrounds` conservés, aucun champ `dockZones` / `floatingPanels` / `voiceInMenu` dans l'état.
  - `it("persiste panneau et largeur, pas l'état éphémère")`.
  - `profilService.test.ts` : `it("importe un ancien profil avec disposition en ignorant la disposition")` — le thème et les fonds sont appliqués, aucune erreur.
- [ ] **Étape 2 :** `bunx vitest run src/stores/useLayoutStore.test.ts src/services/profilService.test.ts` → ÉCHEC.
- [ ] **Étape 3 :** réécrire le store : `version: 6`, `migrate` qui reprend `dockZones.right.active ?? dockZones.right.panels[0] ?? null` (seulement si ce n'est pas `"voice"`) comme `panneau`, et la taille de zone droite comme `largeurPanneau`. Retirer `layoutEditing`, `draggingPanel`, `moveDockPanel`, `floatDockPanel`, `sendVoiceToDock`, `returnVoiceToMenu`, `resetLayout` (la réinitialisation de la barre reste `resetSidebar`). Dans `profilService`, retirer la section « disposition » de l'export ; à l'import, la lire et l'ignorer.
- [ ] **Étape 4 :** mettre à jour les appelants vers `ouvrirPanneau` / `basculerPanneau` / `fermerPanneau`. `useDockZone()` disparaît : `SoundboardPanel` et `MemeboardPanel` perdent leur mode `compact` (zone basse) — supprimer ces branches. Retirer Ctrl+Shift+L de `useKeyboardShortcuts.ts`. Dans `MainArea.tsx`, remplacer provisoirement les trois `DockZone` et `FloatingPanels` par rien (le panneau revient à la tâche 6) : l'appli doit compiler et tourner.
- [ ] **Étape 5 :** `bunx tsc -b`, `bun run lint`, `bun run test` → verts. Lancer `./build-scripts/run-native.sh` : la conversation s'affiche, aucune erreur dans la console.
- [ ] **Étape 6 :** commit `refactor(interface): un seul panneau latéral au lieu de la dock`.

### Tâche 3 : Coque à quatre bulles et barre d'icônes

**Fichiers :**
- Créer : `src/components/layout/RailServeurs.tsx` (+ `RailServeurs.test.tsx`)
- Modifier : `src/App.tsx` (bloc `app-root`, l. 482-488), `src/components/layout/Sidebar.tsx`, `src/components/layout/MainArea.tsx`, `src/index.css` (`.app-root`)
- Modifier : `src/components/sidebar/ServerHeader.tsx`

**Interfaces :**
- Consomme : `Bulle` (tâche 1), `useLayoutStore.sidebarMode` / `toggleSidebar`.
- Produit : `function RailServeurs(): JSX.Element` — logo Sion (bouton qui bascule la barre des salons, comme Ctrl+B), avatar du compte (ouvre le panneau de compte, `toggleAccountPanel`), bouton Administration si `isAdmin` (`toggleAdmin`), séparateur, bouton Paramètres (`toggleSettings`). **Pas de liste de serveurs** : Sion n'en gère qu'un ; la place est prête pour les espaces Matrix plus tard.

- [ ] **Étape 1 : tests qui échouent** — `RailServeurs.test.tsx` :
  - `it("le logo replie et déplie la barre des salons")` : clic → `sidebarMode` passe de `"full"` à `"rail"`.
  - `it("n'affiche le bouton Administration qu'aux admins")` : `isAdmin=false` → absent ; `true` → présent.
  - `it("chaque bouton a un nom accessible")` : tous les `button` ont `aria-label` non vide.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** écrire `RailServeurs` (largeur 72 px, boutons ronds de 48 px, actif = fond `var(--color-primary)`). `.app-root` : `display: flex; gap: var(--sion-bulle-ecart); padding: var(--sion-bulle-ecart); background: var(--color-surface)`. `App.tsx` desktop : `RailServeurs` | `Sidebar` (dans une `Bulle as="nav" scope="channels"`) | `MainArea`. `MainArea` met la conversation dans une `Bulle as="main" scope="chat"`. `ServerHeader` garde le nom du serveur et le nombre de membres en ligne ; ses boutons Administration / Déconnexion / profil passent au rail (tâche 3) et à la carte de profil (tâche 5) — retirer leur doublon ici.
- [ ] **Étape 4 :** tests → SUCCÈS ; `bunx tsc -b` ; `run-native.sh` : trois bulles visibles, arrondies, espacées de 12 px, fond de chat et fond de salons toujours appliqués.
- [ ] **Étape 5 :** commit `feat(interface): coque à bulles et barre d'icônes`.

### Tâche 4 : En-tête de la conversation et onglets de panneaux

**Fichiers :**
- Créer : `src/components/chat/OngletsPanneaux.tsx` (+ test)
- Modifier : `src/components/chat/ChatHeader.tsx` (boutons l. 215-420)
- Modifier : `public/locales/fr/translation.json`, `public/locales/en/translation.json`

**Interfaces :**
- Consomme : `basculerPanneau`, `panneau` (tâche 2).
- Produit : `function OngletsPanneaux(props: { salonVocal: boolean }): JSX.Element` — trois onglets en pilule, icône + libellé : Transcription (si `salonVocal`), Soundboard, Memeboard ; l'onglet du panneau ouvert est surligné (`var(--color-surface-container-high)`), `aria-pressed` le reflète.

- [ ] **Étape 1 : tests qui échouent** :
  - `it("un clic ouvre le panneau, un second le ferme")` sur Soundboard → `panneau` vaut `"soundboard"` puis `null`.
  - `it("l'onglet actif est marqué aria-pressed")`.
  - `it("Transcription n'apparaît que dans un salon vocal")`.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** écrire `OngletsPanneaux`. Dans `ChatHeader` : à gauche, icône du salon + nom + `OngletsPanneaux` ; à droite, dans cet ordre, épinglés (`basculerPanneau("pinned")`), membres (`basculerPanneau("members")`), partage d'écran (bouton surligné quand on partage). Paramètres du salon et Inviter passent dans un menu « ⋯ » à droite. Supprimer l'ancien rendu des boutons Soundboard / Memeboard / Membres. Commenter dans le JSX que la vidéo native (partage inline) reste rectangulaire dans la bulle arrondie (point de vigilance 1).
- [ ] **Étape 4 :** ajouter la clé `chat.more` (fr « Plus d'actions », en « More actions ») pour le menu « ⋯ » ; tests → SUCCÈS, `i18nKeys.test.ts` vert.
- [ ] **Étape 5 :** commit `feat(interface): onglets de panneaux dans l'en-tête`.

### Tâche 5 : Liste des salons et carte de profil

**Fichiers :**
- Créer : `src/components/sidebar/CarteProfil.tsx` (+ test)
- Modifier : `src/components/sidebar/ChannelItem.tsx`, `src/components/sidebar/ChannelList.tsx`, `src/components/sidebar/UserControls.tsx`, `src/components/layout/Sidebar.tsx`
- Modifier : `src/components/chat/VoiceStatusPanel.tsx` (n'est plus un panneau ; ses boutons sont réutilisés ou supprimés)

**Interfaces :**
- Consomme : `useAppStore` (`isMuted`, `isDeafened`, `toggleMute`, `toggleDeafen`, `connectedVoiceChannel`, `toggleSettings`), le raccrochage existant de `UserControls` (bouton `voice.disconnect`).
- Produit : `function CarteProfil(props: { compact: boolean }): JSX.Element` — ligne 1 : avatar (pastille d'état), nom, état (« En ligne », ou le salon vocal en cours) ; ligne 2 : micro, casque, paramètres, et à droite **raccrocher en rouge** (`var(--color-error-container)` / `var(--color-error)`) seulement en appel. Les indicateurs de `UserControls` (qualité réseau, décalage d'horloge, republier la présence, transcription) sont gardés dans cette carte, compacts.

- [ ] **Étape 1 : tests qui échouent** — `CarteProfil.test.tsx` :
  - `it("raccrocher n'apparaît qu'en appel")`.
  - `it("micro et casque reflètent et basculent l'état")` : `aria-pressed` suit `isMuted` / `isDeafened`, le clic appelle `toggleMute` / `toggleDeafen`.
  - `it("en rail, seuls l'avatar et raccrocher restent")` avec `compact`.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** écrire `CarteProfil` à partir de `UserControls` (en garder la logique, pas la mise en page) ; `Sidebar` la pose en pied de bulle. `ChannelItem` : salon actif en pilule (`var(--color-surface-container-high)`, rayon 12 px) ; salon vocal occupé → avatars superposés des participants (3 au plus) suivis de `+N` sur la même ligne, au lieu de la liste dépliée (la liste détaillée reste au survol / dépliage existant) ; compteur de non-lus en pastille ronde à droite (`unreadCount` existant). `ChannelList` garde ses onglets Salons / MP et leur pastille de non-lus.
- [ ] **Étape 4 :** tests → SUCCÈS ; `run-native.sh` en appel : couper le micro depuis la carte et depuis F8 donne le même état.
- [ ] **Étape 5 :** commit `feat(interface): carte de profil et liste des salons`.

### Tâche 6 : Bulle du panneau latéral

**Fichiers :**
- Créer : `src/components/layout/PanneauLateral.tsx` (+ test)
- Modifier : `src/components/layout/MainArea.tsx`, `src/components/chat/SoundboardPanel.tsx`, `MemeboardPanel.tsx`, `MemberPanel.tsx`, `TranscriptPanel.tsx`, `PinnedListPanel.tsx` (retirer leur propre titre et leur ✕, désormais portés par la bulle)

**Interfaces :**
- Consomme : `panneau`, `fermerPanneau`, `largeurPanneau`, `setLargeurPanneau` (tâche 2), `PANNEAU_CORPS`, `PANNEAU_TITRES` (tâche 2), `Bulle` (tâche 1).
- Produit : `function PanneauLateral(): JSX.Element | null` — rien si `panneau === null` ; sinon une `Bulle as="aside" scope={panneau}` de largeur `largeurPanneau`, en-tête (titre, compteur optionnel fourni par le panneau, ✕ qui appelle `fermerPanneau`), corps dans un `Suspense`. Poignée de redimensionnement sur le bord gauche. Sous 1100 px de large, la bulle se superpose à la conversation (position absolue, ombre) au lieu de la pousser.
- Contrat de compteur : les panneaux qui affichent un total (soundboard : nombre de sons) l'exposent par `PANNEAU_COMPTEURS: Partial<Record<PanneauId, () => number | null>>` dans `panneaux.ts`, lu par l'en-tête.

- [ ] **Étape 1 : tests qui échouent** :
  - `it("n'affiche rien sans panneau ouvert")`.
  - `it("affiche le titre du panneau et le ferme avec ✕")`.
  - `it("un seul ✕ : le panneau n'en dessine plus")` : soundboard ouvert, un seul bouton dont l'`aria-label` vaut `chat.close` (clé existante, « Fermer »), celui de la bulle.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** écrire `PanneauLateral`, le poser à droite de la conversation dans `MainArea`, retirer titres et ✕ des panneaux. Échap ferme le panneau quand le focus y est.
- [ ] **Étape 4 :** tests → SUCCÈS ; `run-native.sh` : ouvrir chaque panneau depuis l'en-tête ; redimensionner ; réduire la fenêtre à 1000 px : le panneau passe par-dessus.
- [ ] **Étape 5 :** commit `feat(interface): bulle du panneau latéral`.

### Tâche 7 : Soundboard à la maquette

**Fichiers :**
- Modifier : `src/components/chat/SoundboardPanel.tsx` (+ test à créer `SoundboardPanel.test.tsx`)

**Interfaces :**
- Consomme : `soundboardView` / `setSoundboardView` (`useSettingsStore`, inchangés : `mode: "all" | "favorites" | "top"`, `category: string | null`), le volume existant (`setPlaybackVolume`).

- [ ] **Étape 1 : tests qui échouent** :
  - `it("les puces Favoris, Top, Tous puis les catégories filtrent la grille")` : clic sur « Favoris » → `soundboardView.mode === "favorites"` ; clic sur une catégorie → `mode === "all"` et `category` posée.
  - `it("la grille est sur deux colonnes")` : `gridTemplateColumns` vaut `repeat(2, minmax(0, 1fr))`.
  - `it("le volume est en pied de panneau")` : le curseur de volume est le dernier élément de la bulle.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** onglets Sons / Voix / Membres en tête (déjà présents, restylés en soulignement accent) ; champ de recherche + bouton ＋ (ajout) sur une ligne ; puces de filtre en pilules (puce active `var(--color-primary)`) ; cartes de son 2 colonnes, rayon `--sion-carte-rayon`, emoji en haut à gauche, étoile favori en haut à droite, titre en gras, catégorie en petites capitales ; volume + pourcentage en pied.
- [ ] **Étape 4 :** tests → SUCCÈS ; `run-native.sh` en appel : jouer un son, le mettre en favori, filtrer.
- [ ] **Étape 5 :** commit `feat(interface): soundboard en cartes`.

### Tâche 8 : Saisie sur deux lignes et messages

**Fichiers :**
- Modifier : `src/components/chat/ChatInput.tsx` (rendu l. 700-913), `src/components/chat/AttachButton.tsx`, `src/components/chat/Message.tsx` (barre d'actions sous le message)
- Test : `src/components/chat/ChatInput.test.tsx` (à créer)

**Interfaces :**
- Consomme : la logique existante de `ChatInput` (mentions, GIF, emoji, envoi, édition, réponse) — inchangée.

- [ ] **Étape 1 : tests qui échouent** :
  - `it("la saisie est sur la première ligne, les actions sur la seconde")` : le `textarea` précède la rangée d'actions dans le DOM.
  - `it("le bouton Envoyer porte son libellé et est désactivé à vide")` : texte `chat.send` (clé à créer : fr « Envoyer », en « Send »), `disabled` tant que la saisie est vide.
  - `it("@ insère une mention et ouvre la liste")` : clic sur @ → la saisie se termine par « @ » et `mentionQuery` est ouverte.
- [ ] **Étape 2 :** lancer → ÉCHEC.
- [ ] **Étape 3 :** carte arrondie (`--sion-carte-rayon`) en pied de conversation : ligne 1, ＋ (menu `AttachButton` : fichier, vidéo externe, sondage) + `textarea` + GIF + emoji ; ligne 2, @ (mention), 🔗 (lien), 📎 (fichier direct) à gauche ; à droite le bouton **Envoyer** (fond `var(--color-primary)`). Pas de bouton micro : Sion n'envoie pas de message vocal, on ne montre pas d'action qui n'existe pas. `Message.tsx` : la barre de réactions / Répondre / emoji passe sous le texte (comme la maquette) au lieu de flotter au survol, en ligne discrète.
- [ ] **Étape 4 :** tests → SUCCÈS ; `run-native.sh` : envoyer, répondre, éditer, coller un gros texte (bascule en fichier), GIF.
- [ ] **Étape 5 :** commit `feat(interface): saisie sur deux lignes`.

### Tâche 9 : Vérification bout à bout et notes

**Fichiers :**
- Créer : `docs/interface-bulles.md` (ce qui a changé, ce qui a disparu avec la dock, limites connues)
- Modifier : `docs/roadmap-2.0.0.md` (renvoi : interface bulles prévue après la 2.0.0)

- [ ] **Étape 1 :** `bunx tsc -b`, `bun run lint` (0 erreur), `bun run test`, `cd src-tauri && cargo test -j4 --lib` → verts.
- [ ] **Étape 2 :** sous Linux Wayland (`run-native.sh`), parcourir : thème clair d'accent différent, fond animé dans le chat, partage d'écran reçu dans la conversation (coins carrés acceptés), lecteur vidéo plein écran, fenêtre à 1000 px, Ctrl+B, Ctrl+Shift+P. Mesurer le CPU de WebKit au repos comme le 06/10 (sur 60 s) : **pas plus que les 27 % relevés avant la branche**.
- [ ] **Étape 3 :** construire l'APK (`build-scripts/build-android.sh debug`) : l'affichage téléphone est inchangé.
- [ ] **Étape 4 :** sous Windows (flammemob, `C:\sion-client\build-rust.ps1`), vérifier que la surface vidéo HWND se place dans la bulle et que le plein écran du lecteur marche toujours.
- [ ] **Étape 5 :** écrire `docs/interface-bulles.md`, commit `docs: interface en bulles`, pousser la branche (`git push -u origin feat/interface-bulles`). Ne pas fusionner dans `main` avant la 2.0.0.
