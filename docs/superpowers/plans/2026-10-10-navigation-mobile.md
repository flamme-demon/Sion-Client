# Navigation mobile des espaces

Implémentée sur `feat/interface-bulles` le 10 octobre 2026.

- Accueil : espaces et MP dans une colonne de 68 px, salons à côté.
- Conversation : chat plein écran, commandes vocales conservées en bas.
- Retour court : salons et aperçu du chat. Retour long : accueil complet.
- Le geste inverse referme la navigation ; une annulation restaure la vue.
- Le chat reste monté : brouillon et défilement sont conservés. Les messages
  masqués derrière la navigation restent non lus.
- Les fenêtres ouvertes et le plein écran se ferment avant la navigation.
  Le vocal reste connecté pendant les déplacements.

## Android

`MobileNavigationBridge` relaie les phases du retour prédictif AndroidX vers
`useRetourMobile`. Les coordonnées physiques sont converties en pixels CSS.
Le bouton Retour et les versions sans progression utilisent les mêmes paliers.
Le pont est activé après l'écouteur Tauri et désactivé au démontage.

## Partage d'un espace

Le clic droit, la touche Menu et l'appui long ouvrent les mêmes choix :
« Partager l’invitation » et « Gérer l’Espace ». Ouvrir le menu ou partager
conserve l'espace et le salon actifs. Seul le choix de gestion change l'espace.
Retour ferme le menu avant de déplacer la navigation.

Le partage utilise le lien Matrix existant, calculé localement. Sur ordinateur,
il est copié dans le presse-papiers. Sur Android, `PartageBridge` ouvre le
sélecteur système avec un `ACTION_SEND` de texte ; aucune application ni aucun
destinataire ne sont imposés. Le navigateur mobile utilise Web Share, puis la
copie si cette API est absente. Une annulation ne produit pas de notification.

## Fluidité

Les gestes déplacent directement les couches du menu et du chat avec
`translate3d`. Aucune mise à jour du store n'a lieu pendant la progression.
Une variable CSS héritée par tous les messages provoquait trop de recalculs
de styles : elle a été supprimée. La largeur est mémorisée par `ResizeObserver`.

Comparaison sur téléphone, même geste système d'environ une seconde et même
conversation : les recalculs de styles sont passés de 924 ms à 80 ms cumulées ;
le 90e percentile des intervalles entre images est passé de 49,4 ms à 8,3 ms.
Ces valeurs décrivent ce scénario de test, pas une garantie pour tous les appareils.

## Validation

- 29 tests : navigation, capture tactile, annulation, brouillon, non-lus,
  maintien du vocal, fermeture des fenêtres et nettoyage des écouteurs.
- TypeScript et lint des nouveaux composants.
- Gestes tactiles dans Chromium ; vues 320 × 640, 390 × 844, 720 × 360 et
  défilement avec 45 espaces.
- Vérification du placement des modules sur ordinateur.
- Compilation et installation de Sion Dev sur téléphone Android ; gestes
  système courts et longs vérifiés.
- Menu des espaces : 53 tests ciblés passent (partage, navigation mobile,
  menus des espaces et des salons, appui long). Appui long vérifié dans
  Chromium et sur téléphone ; sélecteur Android ouvert puis annulé, espace
  conservé, aucun message envoyé.
