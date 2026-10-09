# Interface en bulles — 07/10/2026

Branche : `feat/interface-bulles`. Implémentation du
[plan](superpowers/plans/2026-10-07-interface-bulles.md), d'après la
[maquette](superpowers/plans/2026-10-07-maquette-bulles.png), également fournie
sous `Capture d'écran_20261007_100807.png`.

![Aperçu WebKitGTK avec données fictives](interface-bulles-apercu.png)

## Utilisation

Sur ordinateur, quatre espaces séparés composent la fenêtre : rail de
navigation, salons, conversation et panneau latéral. Les bulles ont un rayon
de 20 px et un écart de 12 px ; les cartes internes utilisent un rayon de 14 px.

Le rail permet de replier les salons, ouvrir le compte et l'administration
(si autorisée). La carte de profil au pied des salons réunit
les commandes audio et le raccrochage lorsqu'un appel est actif. Les avatars
vocaux restent sur la ligne du salon ; un clic les déplie. Paramètres est
affiché dans cette carte lorsque le menu est déployé ; lorsque le menu est
compact ou masqué, le rail prend le relais avec ce même accès.

Les onglets de conversation ouvrent transcription (salon vocal), soundboard
ou memeboard. Plusieurs modules peuvent rester ouverts ensemble, chacun dans
sa bulle, y compris membres et épinglés. Le menu ⋯ réunit les actions de salon autorisées
et les options du partage. Le nom du serveur et son indicateur en ligne
restent visibles ; aucun nombre de présences n'est inventé sans données.
Les libellés des onglets restent visibles sur ordinateur ; l’en-tête passe
sur plusieurs lignes lorsque la largeur disponible ne suffit plus.

Glisser le titre ou les six points d'un module permet de le placer à gauche,
à droite, en haut ou en bas. Dès l'appui, le module s'atténue et une petite
carte suit le pointeur. Pendant le déplacement, un seul aperçu montre la taille
et la position qu'il prendra au relâchement, avec le nom de la destination.
Les bords et les zones déjà occupées servent
de destinations ; viser la première ou la seconde moitié d'un voisin permet
de le placer avant ou après celui-ci. Le petit menu de position dans l'en-tête
offre les mêmes destinations et les actions Avant / Après au clavier.
Les bulles sont empilées sur les côtés et côte à côte en haut et en bas. Fermer une bulle
laisse les autres ouvertes. La position, l'ordre et les dimensions des zones
sont mémorisés.

La largeur de chaque colonne est comprise entre 300 et 520 px, 360 px par défaut.
Les rangées du haut et du bas mesurent indépendamment 100 à 520 px, 280 px
par défaut, et restent limitées à 45 % de la hauteur de la fenêtre. Si les
deux sont occupées, chacune reste limitée à 35 % de la zone centrale pour
conserver de la place au chat.
La poignée accepte le pointeur, les flèches, Origine / Fin et le double-clic
pour réinitialiser. Échap ferme depuis le panneau et restitue le focus à
l'élément qui l'a ouvert. Sous 1100 px, le menu devient compact et les panneaux
se superposent au chat. Cette adaptation ne modifie pas la préférence du menu.
Avec deux colonnes opposées sur une fenêtre plus large, leur largeur affichée
est limitée pour réserver au moins 280 px au fil, sans écraser les dimensions
enregistrées.

Le soundboard affiche deux colonnes, propose Top / Toutes et les catégories,
et place le volume en pied. Les favoris et les étoiles ont été retirés : la
migration `sion-settings` vers la version 2 supprime `soundboardFavorites` du
localStorage et bascule l'ancienne vue Favoris sur Top. Les compteurs TOP et
les autres préférences sont conservés. La saisie desktop utilise deux lignes :
texte, GIF, emoji ; puis mention, import vidéo par lien, fichier, sondage et Envoyer.
Le bouton Envoyer reste désactivé à vide. Les actions des messages passent
sous leur contenu. Sur téléphone, une seule feuille de panneau est affichée
à la fois ; passer à une autre feuille conserve les positions du bureau.

La memeboard propose TOP / Tous, avec les mêmes pilules que la soundboard.
TOP ne garde que les mèmes déjà lancés et les classe par fréquence personnelle
décroissante, puis par nom en cas d'égalité. Le filtre et les compteurs sont
conservés dans les réglages locaux. La recherche fonctionne dans les deux vues.
Les clics refusés par l'anti-rafale ou les erreurs ne sont pas comptés ; un TOP
neuf se remplit avec les prochains lancements réussis.
Les catégories se choisissent à l'import et se modifient ensuite sans changer
le média ou son identifiant. Le même arbre que la soundboard permet de
naviguer dans `Films/Kaamelott` ; la catégorie reste affichée sous le nom du
mème, et la recherche porte sur le nom et la catégorie. Les anciens mèmes sont
rangés dans « Autre ». Les catégories sont partagées dans `com.sion.meme.category`
et reconduites dans les éditions Matrix. Le champ du moteur natif nécessite
le prochain rebuild groupé ; TOP et ses compteurs locaux fonctionnent à chaud.

Les fonds se choisissent dans **Réglages → Apparence**, par portée : chat,
salons et chacun des panneaux. Le thème et l'accent restent personnalisables.
Les pixels du partage et du lecteur natifs gardent un rectangle ; le panneau
CSS superposé entre dans le calcul des zones masquées envoyé à Rust.

## Stockage et compatibilité

`useLayoutStore` persiste `sion-layout` version 7 : `panneaux` garde les modules
ouverts, `positionsPanneaux` leurs zones, et `panneau` le module courant de la
feuille mobile. Les deux largeurs et la hauteur du bas sont indépendantes.
Le partage flottant conserve ses propres réglages.

La migration depuis la version 6 reprend le panneau courant. Depuis une
ancienne dock encore enregistrée, elle reprend les modules valides, leurs
zones et les dimensions. Elle conserve les préférences de sidebar, les fonds
et la disposition du partage. Les identifiants obsolètes, dont `voice`, sont écartés. Les
valeurs hors bornes et une ancienne liste de panneaux abîmée sont réparées.

L'export `.sionprofil` conserve thème, accent, fonds et sons. L'ancienne
section `layout` reste lisible à l'import et est ignorée, sans changer la
largeur ou le panneau courant. Ctrl+B et Ctrl+Maj+P restent disponibles ;
Ctrl+Maj+L et les presets de disposition sont retirés.

## Vérifications du 07/10

- TypeScript et compilation de production : réussis.
- ESLint : 0 erreur, 37 avertissements déjà présents dans le projet.
- Vitest : **440 tests réussis**, 5 ignorés, 66 fichiers réussis.
- Tests Rust : **172 réussis**, 5 ignorés ; sources Rust identiques à `main`,
  exécution dans le dépôt principal pour réutiliser les dépendances compilées.
- Chromium, composants réels avec données fictives : vues à 1600, 1000,
  768 et 390 px ; cinq panneaux, filtres de sons, redimensionnement clavier,
  Échap / focus, activation de l'envoi, thème clair / accent, feuille mobile.
  Aucune erreur React observée.
- WebKitGTK 4.1 sous Wayland : quatre bulles et six cartes de son rendues.
  CPU moyen du WebKitWebProcess : **9,73 % d’un cœur sur 60 s** au repos
  (données fictives, fond statique, sans appel). Cette mesure d’aperçu est
  sous le seuil de 27 % du plan ; elle ne remplace pas une mesure de la
  session Tauri avec un fond animé.
- Android : APK debug ARM64 compilé avec les mêmes moteurs Rust.
  Artefact : `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`
  `app-universal-debug.apk`. Aucun appareil n’a été modifié ; validation
  visuelle sur téléphone réel encore à faire.
- Régression vidéo : test du trou sous un panneau positionné par CSS entre
  les points de contrôle, et exclusion du panneau hors du lecteur plein écran.

Les vérifications réelles en appel (micro / F8, sons, partage reçu), les
transitions du lecteur et le placement HWND Windows restent à effectuer.
Les aperçus avec données fictives ne valident pas ces fonctions matérielles.
La branche ne doit pas être fusionnée dans `main` avant la 2.0.0 finale.

## Retouches après comparaison à la maquette

D’après la capture annotée `Capture d'écran_20261007_133803.png` :

- Contours des bulles, cartes et séparateurs adoucis avec le token de thème
  `color-border`, au lieu de `color-outline-variant`.
- Un seul accès Paramètres visible : profil en mode déployé, rail en mode
  compact ou masqué. L’accès reste disponible dans une fenêtre étroite.
- Recherche commune aux sons et memes, fond `surface-container-high`,
  bouton + vert intégré au champ, affiché selon les mêmes autorisations.
- Fonds `surface-container` du profil et du pied de volume du soundboard.
- Icône de note de musique dans l’onglet Soundboard, comme la référence.
- Couleur d’accent sur les onglets sélectionnés (texte et icône), la croix
  de fermeture des panneaux sur ordinateur et téléphone, et les contours
  de focus clavier des commandes de panneau.

Vérifications : compilation TypeScript, tests concernés, aperçus sombre et
clair ; recherche et filtres, ajout intégré, accès Paramètres unique à
1600 / 1000 / 768 px, feuille téléphone à 390 px. Aperçu WebKitGTK actualisé.
La mesure CPU de 60 secondes ci-dessus est celle de l’implémentation initiale.
L’accent des onglets et de la fermeture a été vérifié dans Chromium avec
violet, vert et orange, en thème clair et sombre ; le focus a également été
contrôlé dans WebKitGTK.

D’après `Capture d'écran_20261007_162434.png` :

- Micro et casque accessibles dans le profil réduit, avec leur état muet /
  sourdine et le raccrochage pendant un appel. Paramètres conserve son accès
  unique dans le rail.
- Bouton d’insertion de lien avec une icône SVG monochrome, au lieu de
  l’emoji coloré qui donnait l’impression d’un bouton sélectionné.
- Libellés Transcription, Soundboard et Memeboard conservés sous 1350 px,
  avec retour à la ligne de l’en-tête si nécessaire.

Compilation de production réussie, commandes audio réduites testées avec
et sans appel, insertion Markdown toujours vérifiée. Rendu contrôlé dans
l’application WebKitGTK ouverte à 1280 px avec le soundboard affiché.

D’après `Capture d'écran_20261007_170710.png` : le + quitte le champ de
message sur ordinateur. L’import vidéo par lien remplace le raccourci
Markdown ; un bouton Sondage ouvre directement la création dans le salon
courant. Le trombone ouvre directement le sélecteur de fichiers. L’import
vidéo conserve son chargement différé et ajoute le fichier au brouillon.
Les actions respectent les autorisations d’envoi ; yt-dlp reste absent sur
Android et le téléphone conserve son menu trombone.

D’après `Capture d'écran_20261007_171041.png` : raccrocher utilise un combiné
téléphonique aux traits rouges sur fond transparent dans la carte de profil,
en mode réduit comme déployé.

D’après `Capture d'écran_20261007_171442.png` : le raccourci CC est retiré de
la carte de profil. L’onglet Transcription de l’en-tête reste disponible
pendant un appel, y compris lorsqu’on consulte un autre salon.

D’après `Capture d'écran_20261007_172108.png` : les réglages de fond ne se
tassent plus dans une capsule à côté du nom du panneau. Un fond configuré
affiche une carte avec le titre et les actions en haut, le mode Voile / Flou
et l’opacité chiffrée sur une ligne, puis une grille de position agrandie.
Les panneaux sans fond conservent une ligne simple pour choisir une image.

![Réglages des fonds à 280 px](interface-bulles-fonds.png)

Aperçu Chromium à 280 px : aucun débordement ; commandes contenues dans la
carte ; bascule Voile / Flou, changement d’opacité, position et retrait du
fond vérifiés. Compilation de production réussie.

Le bouton de partage d’écran possède un fond teinté dans la couleur d’accent,
sans bordure, pour mieux ressortir. Pendant un partage, le fond passe au rouge
pour distinguer l’action d’arrêt.

Les cartouches de la soundboard et de la memeboard ont un fond uni et un fin
contour de 1 px pour mieux les distinguer. Ce liseré intérieur utilise la
couleur de texte à 4 % pour suivre le thème et garder les dimensions des cartes.
Le fond est éclairci de 2 % avec cette même couleur ; le relief vient surtout
du fond des cartes, comme dans la démo, avec un contour discret.
La typographie reprend les polices de la démo : Outfit pour les titres
(serveur, salon, modules et cartes), Roboto pour le corps de texte. Les fichiers
variables WOFF2 sont embarqués dans `public/fonts` avec leurs licences, sans
dépendance aux polices installées ni requête extérieure à l'exécution.
Les noms des cartes font 12 px sur deux lignes au maximum ; les catégories
restent en Roboto de 10 px, en gris (`--color-outline`) pour hiérarchiser les
informations. Roboto est aussi fourni en italique pour les messages.
Les emojis se fondent dans la cartouche, sans pastille de fond distincte,
y compris au survol.
Les boutons Modifier et Supprimer partagent le composant `ActionsCarteBoard` :
crayon puis poubelle en haut à droite, cercles de 24 px, mêmes fonds et couleurs.
Ils apparaissent au survol ou au focus clavier, et restent visibles sur un
écran tactile. Le badge de voix générée est placé près du nom du modèle pour
laisser la zone des actions libre.
La suppression des sons et des mèmes utilise la même confirmation intégrée,
en portail au-dessus des bulles, avec Annuler et Supprimer. Le focus démarre
sur Annuler, reste dans la fenêtre et revient au bouton d'origine. Échap ferme
la confirmation seule ; la requête en cours bloque les doublons et affiche
les erreurs dans la fenêtre pour permettre une nouvelle tentative.
Vérification : 21 tests ciblés réussis, TypeScript et lint sans erreur ; aperçu
Chromium avec données fictives à 880 et 360 px, sans débordement de la fenêtre.

Les commandes micro, sourdine, transcription, soundboard, memeboard,
paramètres, membres, partage, raccrochage, vidéo et sondage utilisent des formes pleines.
Memeboard affiche un visage qui pleure de rire ; l’import vidéo par lien
reprend son ancien pictogramme avec un triangle de lecture. Les icônes suivent
la couleur du bouton, avec le rouge et la barre pour les états audio coupés.
Le volume des deux boards se règle en pied de panneau. Leur bouton d'activation
reprend l'icône du module (note pour soundboard, visage qui pleure de rire pour
memeboard), barrée en rouge quand il est désactivé.
Le combiné de raccrochage est plein, d’un rouge plus vif sur un fond rouge clair.

En menu réduit, la carte de survol des utilisateurs est rendue hors de la
bulle du menu pour passer au-dessus du chat. Le bouton d’envoi conserve
uniquement son icône et son libellé accessible.

Sous les messages, seuls Réagir et Répondre restent visibles. Épingler /
Désépingler, Signaler, Supprimer et Modifier passent dans le menu au clic
droit, avec les mêmes autorisations et la confirmation de suppression.
Un appui long ouvre ce menu sur téléphone ; Maj+F10 l’ouvre au clavier.
Les bulles de message sont conservées.
Sur ordinateur, Réagir et Répondre sont réduits à 14 px avec moins d’espace
autour pour rester discrets sous les bulles.
Le raccourci GIF est retiré de la barre de saisie : seul le bouton smiley
ouvre le sélecteur, qui conserve ses onglets Emoji et GIF.

La liste des membres affiche des avatars de 36 px au lieu de 24 px, avec
des noms et des lignes plus spacieux. La version annoncée et le système
passent dans le menu au clic droit, avec la visibilité réservée aux
administrateurs du salon. Sans annonce, le menu indique « Non annoncée ».
Une version annoncée ne constitue pas une preuve de connexion actuelle.

La liste affiche la présence Matrix, indépendante du vocal : pastille verte
(connecté, y compris `unavailable`) ou grise (hors ligne), avec un libellé au survol
et pour les lecteurs d’écran. Si aucune présence n’est annoncée, aucune
pastille n’est inventée. Les états sont masqués lorsque Sion perd la connexion.
Le moteur JS suit les événements de présence ; le moteur Rust lit le magasin
local alimenté par `/sync`, lors du rafraîchissement des détails toutes les
15 secondes tant que le panneau est ouvert, sans requête réseau par membre.
Ce nouveau champ nécessite le prochain rebuild natif groupé ; les changements
de présentation et de menu sont applicables à chaud au binaire déjà lancé.

Les membres sont regroupés, dans cet ordre, en « En vocal », « En ligne »,
« AFK » et « Hors ligne », avec le compteur de chaque groupe, même vide.
Les groupes vocaux prennent la priorité et regroupent les appels de tous les
salons vocaux visibles, même lorsqu’on consulte un salon texte. « AFK »
correspond à un membre connecté au vocal, en sourdine sur tous ses appareils ;
un micro coupé seul reste « En vocal ». Un appareil encore à l’écoute maintient
le compte dans « En vocal ». Le statut Matrix `unavailable`, hors vocal,
reste « En ligne ». Un membre n’apparaît qu’une fois. Les rôles restent
indiqués par la couleur du nom : accentuation
pour les administrateurs, couleur tertiaire pour les modérateurs et couleur
de texte habituelle pour les membres. Les présences non annoncées sont
rangées en bas, avec « Présence inconnue » et sans pastille hors ligne.

En haut et en bas, les quatre groupes sont présentés côte à côte, avec
défilement indépendant des membres de chaque groupe. La liste conserve sa
disposition verticale sur les côtés et sur téléphone. À 160 px de hauteur
ou moins, les membres de chaque groupe sont présentés sur une seule rangée,
avec avatars de 24 px et pseudos de 12 px. Les salons restent sous les pseudos
et les informations complètes sont disponibles au survol. Les groupes vides
occupent la largeur de leur titre ; les autres partagent la place selon
leur effectif. Les listes longues défilent horizontalement. Le passage entre
les deux vues utilise les dimensions CSS du panneau, sans mise à jour React
à chaque pixel de redimensionnement. Les grands panneaux et la vue latérale
gardent leurs avatars de 36 px.

Les nouveaux libellés ont une valeur de repli lisible ; le panneau recharge
le dictionnaire si une session dev déjà ouverte ne connaît pas ses titres.
Les connectés, y compris en vocal et AFK, ont un point vert. AFK porte le
casque barré de sourdine. Une petite onde indique le vocal et s’anime lorsque
la session audio confirme que la personne parle, en respectant la réduction
des animations. Le nom du salon vocal apparaît sous le pseudo, y compris
pour les AFK ; plusieurs salons sont affichés sans doublon.

Vérification du 08/10 : 490 tests front réussis, 5 ignorés ; TypeScript
réussi et lint des fichiers modifiés sans erreur (6 avertissements existants).
Les bulles simultanées, les déplacements, l'ordre, le stockage et la feuille
mobile sont couverts. Aperçu Chromium avec composants de mise en page réels
et contenus fictifs à 1600, 1440, 1200 et 1000 px : modules empilés à droite,
de chaque côté ou côte à côte en bas, sans débordement horizontal. Les fichiers
sont servis par le Vite dev déjà lancé ; aucun rebuild natif effectué pour
ces ajustements.

TOP et catégories de la memeboard : lint sans erreur, 23 tests Rust ciblés
réussis et `cargo check` réussi avec les fonctions natives activées. Import,
édition d'une catégorie seule, navigation dans l'arbre, classement personnel,
recherche et compatibilité avec les réglages antérieurs sont couverts. Le
binaire natif ouvert attend le prochain rebuild groupé pour le stockage des
catégories dans Matrix.

Typographie Outfit / Roboto : 61 tests ciblés réussis (thèmes, boards et
feuille mobile), TypeScript réussi et lint sans erreur. Aperçu Chromium à
348 px sans débordement : les six fichiers WOFF2 sont effectivement chargés,
y compris les accents, le latin étendu et l'italique de Roboto. Outfit est
appliqué aux titres ; les catégories restent grisées en Roboto. La police
servie par le Vite dev est identique au fichier embarqué, sans rebuild natif.

Saisie lente : les commandes vocales ne s'abonnent plus à l'ensemble des
stores Matrix et LiveKit. App, les boutons des salons et le profil ne
redessinent donc plus leur contenu à chaque événement Matrix ou niveau audio.
Les composants qui affichent les participants conservent leurs abonnements
ciblés. Le test de régression reproduit huit mises à jour vocales puis huit
mises à jour Matrix : aucun nouveau rendu du parent après correction, contre
un rendu par mise à jour auparavant. La connexion native, l'affichage des
participants et le raccrochage restent vérifiés.

Le calcul de hauteur du message ne remet plus le textarea à zéro pour relire
`scrollHeight` à chaque lettre. Un miroir de texte invisible et hors du flux
conserve les retours à la ligne ; `ResizeObserver` ajuste la hauteur uniquement
lorsqu'elle change, avec un plafond de 120 px. La saisie est isolée du calcul
de mise en page de la conversation. Les modules et le fil de messages ont
également leur propre containment ; la disposition des panneaux utilise une
classe explicite au lieu de sélecteurs `:has` sur leur contenu.

Mesures dans la session native du 08/10 : l'insertion des caractères passe
d'environ 50 ms à 2–3 ms ; le délai jusqu'à l'image suivante passe d'environ
65 ms à 15 ms. La fluidité est confirmée par l'utilisateur. Les mesures
temporaires sont retirées du code. 41 tests ciblés réussis, TypeScript réussi
et lint sans erreur (3 avertissements existants). Vérification dans Chromium
à 500 et 1200 px : hauteur de 37 px à vide, 79 px sur trois lignes, plafond de
120 px avec défilement et retour à 37 px après effacement ; aucun débordement.
Aucun rebuild natif pour cette correction.

Navigation gauche, essai du 08/10 : le rail contient maintenant le serveur
et les MP, avec un repère dans la couleur d'accentuation et les compteurs de
non-lus. Les MP sont placés tout en haut avec une maison pleine, puis une
séparation discrète et le serveur « S ». Le bouton de repli de la liste est
rangé en bas avec les outils. La colonne voisine affiche les salons ou les conversations privées.
En mode réduit, son ancien titre « S » et ses deux onglets sont retirés ; en
mode déployé, le titre des MP conserve le nom du serveur comme repère.
Le rail retrouve la dernière conversation consultée dans chaque espace,
sans modifier la connexion vocale. Le profil reste en bas de la liste ;
lorsqu'elle est complètement masquée, un accès au compte apparaît en bas du
rail. L'administration est rangée avec les outils du bas. Sur téléphone,
les deux onglets restent accessibles dans la liste. Le nettoyage des MP
vides conserve son accès par clic droit sur le bouton MP.

30 tests ciblés réussis (navigation, compteurs, mode masqué, téléphone,
profil, vocal et saisie), TypeScript et lint réussis. Rendu réduit vérifié
dans la fenêtre native ouverte ; mise à jour frontend sans rebuild natif.

Réactions et déplacements, correction du 08/10 : le sélecteur d'emojis des
messages est affiché dans un portail au-dessus de la page. Sa position et
sa taille restent dans la fenêtre ; les messages personnels l'alignent
vers la gauche de leur bouton. Le containment du chat reste en place.
La recherche et le défilement de la grille fonctionnent dans le portail ;
Échap, un clic extérieur, le défilement du chat ou un redimensionnement le
ferment.

Les six points utilisent la capture du pointeur, comme les poignées de
redimensionnement, sans déclencher le dépôt de fichiers de la fenêtre.
Les trois zones restent accessibles depuis le bas, la gauche et la droite,
y compris lorsqu'elles sont occupées. Les cibles de gauche et de droite
gardent la même largeur et toute la hauteur, et celle du bas garde sa taille
également. Le dépôt retrouve le module sous la cible pour conserver son
changement d'ordre. Échap, une perte de capture ou de focus et un lâcher hors des
destinations annulent le geste. Les cibles sont détectées par le suivi des
calques au-dessus des vidéos natives.

51 tests ciblés réussis (messages, panneaux, positions et stockage),
TypeScript réussi et lint sans erreur (3 avertissements existants dans
Message). Vérification Chromium à 1200 × 820, 780 × 600 et 500 × 400 :
sélecteur entièrement visible sur messages personnels et tiers, recherche
focalisée et défilement interne. Gestes au pointeur vérifiés à 1600 × 820 :
bas et gauche vers droite occupée, réorganisation en bas et annulation par
Échap. Corrections servies par le Vite dev, sans rebuild natif.

Cibles de dépôt harmonisées : gauche et droite gardent les mêmes dimensions
qu'une zone soit vide ou occupée. 14 tests de panneaux réussis, TypeScript
et lint réussis. Aperçu à 1320 × 1400 : côtés de 316,8 × 1400 px, déplacements
depuis le bas et la gauche vers la droite occupée, réorganisation sous la
cible du bas et annulation par Échap vérifiés. Aucun rebuild natif.

Aperçu de placement du 09/10 : les trois cadres de destination sont remplacés
par une seule bulle au futur emplacement du module. Un layout invisible
réutilise les mêmes contraintes de largeur, hauteur et grille que les panneaux
réels, y compris les colonnes étroites et les zones qui défilent. Le titre
du module apparaît dans cet aperçu ; les corps restent montés pendant le geste.
La destination temporaire ne fait pas partie des préférences persistées.
Échap, la perte de capture ou de focus, et le lâcher hors des destinations
conservent le placement initial. Le menu de position reste disponible au clavier.

33 tests de panneaux et de stockage réussis, TypeScript et lint réussis.
Vérification Chromium de huit placements : rectangle annoncé identique au
rectangle final, y compris deux côtés de largeur limitée et une colonne avec
défilement. Aucun remontage des corps ni changement des préférences pendant
le glissement ; annulation par Échap et lâcher au centre vérifiés.

Complément du 09/10 : le haut est rétabli, avec sa hauteur indépendante et
une carte saisie visible dès l'appui. La destination est nommée dans l'aperçu.
53 tests de panneaux, préférences et membres réussis ; TypeScript et lint des
composants modifiés réussis (avertissement déjà présent dans `MainArea` sur
le montage du partage). Vérification Chromium de 14 placements, sans écart
entre aperçu et rectangle final. Les quatre groupes de membres sont côte à
côte en haut et en bas, et défilent séparément ; la réduction réelle avec la
poignée jusqu'à 120 px laisse un membre entier visible par groupe. Aucun
rebuild natif ; Sion dev reste ouvert.

Vue compacte affinée le 09/10 : hauteur minimale abaissée à 100 px. Aperçu
à 1080 px de largeur reproduisant la capture (2 en vocal, 0 en ligne,
1 AFK et 3 hors ligne) : les six membres sont entièrement visibles sur une
rangée dans leurs groupes. Avatars avec image ou initiale mesurés à 24 px,
clic droit et défilement horizontal des listes longues vérifiés. Le retour
en colonne latérale retrouve ses avatars de 36 px. 53 tests ciblés,
TypeScript et lint réussis ; application mise à jour à chaud.

Adaptation des autres modules le 09/10 : la soundboard et la memeboard
occupent une ligne d'outils et une grille horizontale en haut ou en bas.
À 100 px, les cartes deviennent des rangées compactes avec visuel, nom et
catégorie. Top et toutes les catégories, y compris leurs sous-catégories,
restent accessibles dans un sélecteur ; la recherche et le volume restent
disponibles. Les outils défilent si le module est étroit. La molette permet
de parcourir les cartes horizontalement. Les vues latérales gardent leurs
pilules et leur volume en pied.

Les épinglés deviennent des cartes horizontales avec vignettes d'image ou
de vidéo, auteur, date et aperçu ; le clic rejoint le message entier. Leur
total est placé dans le titre du module. La transcription conserve tout
son texte dans une zone de lecture verticale, avec les commandes à côté
dans les bandes haute et basse. Le direct suit les nouveaux segments et
les changements de hauteur, sauf pendant la relecture d'un ancien passage.
Le retour au direct rétablit le suivi. Les sessions de l'historique se
parcourent horizontalement ; résumé et export restent disponibles. Le menu
de session sort du module par un portail et se place dans la fenêtre.

Tests de filtres, lecture, commandes et suivi de transcription réussis ;
TypeScript réussi et lint sans erreur (avertissements déjà présents dans
les effets de chargement des épinglés et de transcription). Vérification
Chromium des quatre modules en haut et en bas à 100, 150 et 280 px, et en
fenêtre étroite : navigation, défilement, recherche, volume, historique,
résumé, export et actions de session vérifiés avec données fictives.
Le retour aux colonnes latérales est vérifié. Corrections servies à chaud
par Vite ; Sion dev reste ouvert, sans rebuild natif.
