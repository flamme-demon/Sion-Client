# Sion Client 2.0.0-beta.8

Sion sait désormais se mettre à jour tout seul, le lecteur vidéo Windows ne
saccade plus en plein écran, et le téléphone gagne le plein écran, le
pointage au doigt dans les partages d'écran et un cache qui ne grossit plus.

## Mises à jour depuis Sion

- **Un bandeau propose la nouvelle version** : Télécharger, puis Installer et
  relancer (ordinateur) ou Installer (téléphone). Rien ne s'installe sans
  votre accord, et jamais pendant un appel.
- Les paquets sont **signés** : Sion refuse un fichier modifié, ou qui ne
  vient pas de la page des versions de Sion.
- **Alpha et bêta** : un interrupteur dans Paramètres → Avancé, désactivé par
  défaut. Le couper ne fait jamais revenir à une version plus ancienne.
- **Cette version-ci s'installe à la main**, comme les précédentes : c'est à
  partir de la prochaine que la mise à jour se fera depuis Sion.

## Vidéos

- **Windows, plein écran** : la vidéo ne saccade plus et ne clignote plus.
  Elle redémarrait deux fois par seconde.
- **Téléphone, plein écran** : le bouton plein écran des vidéos fonctionne
  enfin. Une vidéo plus large que haute propose un bouton « Paysage » pour
  tourner l'image ; le retour arrière quitte le plein écran.
- **Téléphone** : une vidéo ne se charge plus qu'au moment où vous la lancez,
  et une seule joue à la fois. Ouvrir un salon plein de vidéos ne télécharge
  plus rien d'avance.

## Partage d'écran sur téléphone

- **Plein écran** des partages, y compris en mosaïque, avec le même bouton
  « Paysage » pour un partage plus large que haut.
- **Pointer au doigt** : glissez le doigt sur un partage pour montrer un
  endroit à celui qui partage, touchez pour faire apparaître une onde, comme
  avec la souris sur ordinateur.

## Cache

- Les vidéos et médias gardés sur l'appareil sont **plafonnés** (250 Mo de
  fichiers et 250 Mo dans le cache Matrix) et oubliés après 24 h sans usage.
  Avant, ils pouvaient s'accumuler.
- **Purger le cache** (Paramètres → Avancé) vide vraiment ces médias, sans
  toucher à la session ni aux clés de chiffrement.

## Installation

Fichier `Sion_Client-2.0.0-beta.8-arm64.apk` ci-dessous, pour les
téléphones 64 bits. Il s'installe par-dessus la beta 7 ou par-dessus
Sion 1.x.

## Problèmes connus

- **Plantage possible à la reconnexion vocale** : s'il vous arrive que Sion
  se ferme en revenant dans un salon vocal, dites-nous l'heure exacte.
- **Téléphone, réception d'un partage d'écran** : le téléphone chauffe et
  consomme beaucoup ; l'image est encore transmise en pleine résolution.
- **Android, Sion fermé** : la notification dit « Nouveau message » sans le
  texte ni l'auteur (un poke compris) : ils sont chiffrés, et seul Sion
  ouvert sait les lire. En mode « Mentions », seuls les messages privés
  notifient alors.
- **AV1 affiché en vert** sur certaines cartes AMD sous Linux.
- **Partage d'une zone sous KDE** (choix « Zone » de la fenêtre de KDE) : les
  curseurs des spectateurs ne tombent pas au bon endroit chez celui qui
  partage. Le partage d'un écran entier n'est pas touché.
- **Linux** : les anciennes AppImages de Sion ne sont plus supprimées
  automatiquement du dossier où vous les rangez.

## Signaler un problème

Donnez l'heure, votre appareil (Linux, Windows ou Android) et ce que vous
faisiez au moment du problème : c'est ce qui permet de le retrouver dans le
journal.
