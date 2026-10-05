# Sion Client 2.0.0-beta.7

Une beta de tenue : Sion reste utilisable après une nuit de veille ou une
journée entière ouvert, l'appel survit à un rechargement de la page, et les
téléphones dorment de nouveau. Les memes se renomment, comme les sons.

## Memeboard

- **Renommer un meme ou changer son emoji** : survolez-le et cliquez sur le
  crayon, comme pour un son de la soundboard. La vidéo ne change pas, et le
  meme garde sa place chez tout le monde.

## Vocal

- **Après une mise en veille**, vous restez dans l'appel : un PC sorti de
  veille pouvait être écarté de l'appel par tout le monde, lui compris, et
  le rester. Il s'en remet désormais seul en moins de 5 minutes.
- **Après un rechargement de la page**, le micro coupé et la sourdine sont
  repris tels qu'ils étaient. Avant, on pouvait se retrouver sans son ni
  micro, avec des boutons qui faisaient l'inverse de ce qu'ils affichaient.

## Linux

- **Sion ne se recharge plus tout seul après une longue journée** : le
  moteur web finissait par dépasser sa limite de mémoire et était tué
  (8,5 Go mesurés après 22 h ouvert). Sa limite suit maintenant la mémoire de
  la machine.

## Fluidité

- **L'interface travaille beaucoup moins en appel** : les messages ne se
  redessinent plus toutes les 15 secondes sans raison (dix fois moins de
  travail mesuré en appel).
- **Le journal ne se remplit plus** de lignes identiques pendant un appel :
  plus facile à lire quand vous nous le transmettez.

## Administration

- **Les nouveaux inscrits apparaissent aussitôt** dans les comptes en
  attente, au lieu de toutes les 5 minutes. Le salon d'administration ne se
  remplit plus de commandes envoyées automatiquement.
- **Le salon d'administration ne déclenche plus de notifications** sur les
  téléphones des admins (272 inutiles en 35 h relevées sur un téléphone).

## Android

- **La batterie tient de nouveau, Sion fermé** : l'écoute des notifications
  empêchait le téléphone de se mettre en veille profonde. Elle ne le réveille
  plus que le temps de recevoir un avis ou de se reconnecter.

## Installation

Fichier `Sion_Client-2.0.0-beta.7-arm64.apk` ci-dessous, pour les
téléphones 64 bits. Il s'installe par-dessus la beta 6 ou par-dessus
Sion 1.x.

## Problèmes connus

- **Plantage possible à la reconnexion vocale** : s'il vous arrive que Sion
  se ferme en revenant dans un salon vocal, dites-nous l'heure exacte.
- **Android, Sion fermé** : la notification dit « Nouveau message » sans le
  texte ni l'auteur (un poke compris) : ils sont chiffrés, et seul Sion
  ouvert sait les lire. En mode « Mentions », seuls les messages privés
  notifient alors.
- **AV1 affiché en vert** sur certaines cartes AMD sous Linux.
- **Partage d'une zone sous KDE** (choix « Zone » de la fenêtre de KDE) : les
  curseurs des spectateurs ne tombent pas au bon endroit chez celui qui
  partage, KDE ne donnant pas la position de la zone. Le partage d'un écran
  entier n'est pas touché.
- **Android** : pas de mise à jour depuis l'application, téléchargez chaque
  beta ici. Téléphones 64 bits seulement.

## Signaler un problème

Donnez l'heure, votre appareil (Linux, Windows ou Android) et ce que vous
faisiez au moment du problème : c'est ce qui permet de le retrouver dans le
journal.
