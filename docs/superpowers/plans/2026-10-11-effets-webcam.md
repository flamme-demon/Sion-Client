# Effets webcam

La galerie « Effets » est disponible dans l'aperçu privé. Une fois la webcam
publiée, le bouton « Effets » sur la vidéo rouvre ses réglages sans couper
la capture. Les choix se combinent et sont mémorisés sur cet appareil ;
la webcam demande toujours une activation explicite.

- Arrière-plan : flou réglable, image, GIF ou courte vidéo personnelle,
  dégradé animé « Aurore » et fond animé aux couleurs de Sion.
- Filtres : noir et blanc, cinéma, VHS animé et pixels.
- Réglages : correction progressive de la lumière, recadrage doux autour
  du visage et contour de la silhouette dans la couleur d'accentuation.
- Accessoires suivis sur le visage : lunettes, moustache et masque 😂.

## Traitement

Le traitement s'effectue dans Rust avant la source vidéo LiveKit : les
autres participants reçoivent la même vidéo transformée que l'aperçu.
Aucun modèle ne tourne dans la webview et aucune image n'est envoyée à un
service d'effets. Sans effet, le chemin I420 direct est conservé.

Avec des effets, le côté le plus long est limité à 640 pixels. Le rendu
se fait à chaque image ; l'analyse de la silhouette (192 × 192) et du
visage (320 × 320) tourne sur un thread séparé avec une seule requête
en attente. Sa cadence s'adapte à son coût, entre 100 et 600 ms. La
silhouette et le recadrage sont lissés ; un visage perdu masque les
accessoires. Désactiver les effets ou arrêter la capture libère le thread
et les modèles.

Pendant le chargement du détourage, le fond de remplacement couvre toute
l'image et la publication initiale attend que le traitement soit prêt.
Une erreur de modèle est signalée par le moteur de caméra. Un fond invalide
ne remplace pas la configuration qui fonctionnait.

Les modèles OpenCV Zoo PPHumanSeg et YuNet sont embarqués (environ 6 Mo)
et exécutés par Tract. Les poids restent inchangés ; les annotations de
dimensions de YuNet sont recalculées pour une entrée 320 × 320. Sources,
empreintes SHA-256 et licences sont dans
[`camera-NOTICES.txt`](../../../src-tauri/resources/camera-NOTICES.txt),
également distribué avec l'application.

## Fonds personnels

PNG, JPEG, WebP, GIF, MP4, WebM et MOV sont acceptés, jusqu'à 40 Mo. Le
fichier traverse l'IPC une seule fois, en binaire, puis reste dans le cache
local `camera-backgrounds`. Les photos conservent leur rapport de forme
et sont recadrées au centre pour remplir la webcam.

Les vidéos sont normalisées une fois en GIF : six secondes maximum,
10 images/s, côté le plus long de 320 pixels, sans audio. Le bureau utilise
FFmpeg (chemin configuré ou binaire géré), Android utilise
MediaMetadataRetriever puis l'encodeur GIF Rust. Le lecteur borne le
nombre de frames et la taille des images décodées. Les fonds tournent en
boucle ; le fichier vidéo intermédiaire et les frames Android sont supprimés.

## Validation

Tests Rust des deux modèles embarqués, du premier fond masqué pendant
le chargement, du changement de mode, de la libération du traitement, des
cadrages portrait, de l'animation et des filtres. Tests TypeScript des
réglages successifs, du rejet d'un fichier trop lourd, de l'import binaire,
de la restauration des préférences, de la reprise après un fond illisible
et de l'édition d'une caméra publiée.

Rendu natif vérifié sur une image de test publique, sans ouvrir la webcam
de l'utilisateur. Galerie vérifiée dans un navigateur à 1100 et 390 pixels
avec deux webcams et un partage fictifs. Les mesures du test sur cette
machine donnent environ 1 à 15 ms de rendu par image, selon les effets ;
elles ne mesurent pas un appel réel ni les performances du téléphone.
Compilations desktop et Android, et compilation Kotlin du pont Camera2
validées. Import MP4 → GIF vérifié par l'IPC dans Sion dev en conservant
la caméra active. Un essai des effets avec un second participant reste
nécessaire pour confirmer le rendu reçu et les performances en appel.


## Correction de fluidité

La capture bureau vide le flux FFmpeg sur un thread indépendant. Une seule
image peut attendre le traitement ; une image plus récente la remplace et
le buffer est recyclé. Le temps de traitement, la cadence et les images
écartées sont disponibles dans le statut natif pour vérifier la latence.

Le côté de 640 pixels est obtenu en réduisant les plans I420 avec libyuv
avant la conversion RGBA. L'interpolation du masque et son contour sont
réutilisés tant que l'analyse, le cadrage et les dimensions ne changent pas.
La sortie conserve la même résolution qu'avant cette optimisation.

Sous Linux, les formats, tailles et intervalles sont interrogés avec les
ioctls V4L2 de lecture. La cadence native prime sur la résolution. Cela
évite de prendre du YUYV 720p à 10 im/s et de dupliquer ces images à 30 im/s
quand du MJPEG 720p à 30 im/s est disponible. Aucun mode matériel n'est
modifié pendant la détection ; le mode retenu est passé à FFmpeg au démarrage.

Validation de cette correction : 12 tests Rust, contrôle Android et build
desktop. La sonde V4L2 trouve le MJPEG 1280 × 720 à 30 im/s sur la webcam
de développement, sans modifier la capture. Un test 640 × 360 avec flou,
contour et lumière donne 7,82 ms de rendu médian et 17,12 ms au p90 ; ce
test utilise une image synthétique et ne mesure pas la réception distante.
## Accès aux effets sur la vidéo

Le bouton « Effets » est placé en bas à droite de la vignette locale, de la
vidéo agrandie et de l'aperçu avant activation. Le symbole isolé de l'en-tête
est retiré. Les webcams des autres participants gardent leur action
d'agrandissement uniquement. Les boutons restent distincts pour le clavier
et le tactile, et leur calque est pris en compte par les surfaces vidéo natives.

Validation : 9 tests existants caméra/aperçu passent, TypeScript et lint des
composants modifiés passent. Vérification dans Sion dev : bouton visible sur
la vidéo, ouverture des réglages sans interrompre la publication, puis
fermeture de la fenêtre.

La vignette mesure 200 px sur ordinateur et 148 px sur mobile. Son bouton
d'effets affiche seulement le symbole ✦, avec une infobulle et un nom accessible,
dans un carré de 28 px (34 px sur mobile). Le libellé reste affiché dans les
aperçus plus grands.

## Fenêtre et catégories

Les catégories sont accessibles par quatre onglets : arrière-plan, filtres,
réglages et accessoires. L'aperçu reste à gauche sur ordinateur ; sur mobile,
il est placé au-dessus des onglets. Changer d'onglet ne modifie pas les effets.
Les sélections, les boutons et les cadres utilisent les surfaces et bordures
douces de Sion. Les coches utilisent un SVG centré, avec un véritable champ
checkbox accessible au clavier.

La fenêtre ne contient plus de panneau à défilement imbriqué. Une seule zone
de contenu peut défiler si la hauteur disponible l'exige ; l'en-tête et les
actions restent visibles. Validation : 12 tests caméra passent, TypeScript et
lint passent. Vérification visuelle à 1100 et 800 px sans défilement, à 390 px
sans défilement, et à 320 × 640 px avec un seul défilement de contenu. Les
coches sont centrées et l'activation reste explicite dans les quatre vues.
