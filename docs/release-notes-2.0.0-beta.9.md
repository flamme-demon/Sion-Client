# Sion Client 2.0.0-beta.9

Une nouvelle interface en bulles, des modules que vous pouvez placer à votre
guise et des Espaces Matrix pour organiser vos équipes.

## Interface et modules

- Présentation plus douce, icônes et commandes harmonisées, titres en Outfit
  et texte en Roboto. Les polices sont embarquées dans l’application.
- Plusieurs modules peuvent rester ouverts ensemble, dont la soundboard et
  la memeboard. Déplacez-les avec la poignée à six points : l’aperçu montre
  leur position avant de relâcher, à gauche, à droite, en haut ou en bas.
- Les modules s’adaptent aux bandes étroites et aux petites hauteurs : membres,
  sons, mèmes, épinglés et transcription.
- La maison du rail ouvre les messages privés. Le chat garde Réagir et Répondre
  près des messages ; les autres actions sont dans le menu contextuel.
- Les menus de salons, de messages et d’emojis s’affichent au-dessus des modules.
- Sur téléphone, les mêmes modules restent accessibles dans leur feuille dédiée.

## Espaces Matrix

- Créez ou rejoignez un Espace, invitez des membres et partagez son lien Matrix.
- Chaque Espace regroupe ses salons et peut avoir sa bibliothèque de sons et
  de mèmes. Sa création et sa synchronisation se trouvent dans les réglages de
  l’Espace, pour ses administrateurs.
- Les salons communs sont rejoints dans l’équipe concernée. La validation d’un
  compte serveur reste distincte des invitations et des rôles d’un Espace.
- Vous pouvez quitter un salon ou une conversation via son menu contextuel,
  et quitter un Espace depuis ses réglages. Quitter un Espace conserve les salons
  déjà rejoints ; quitter un salon vocal termine aussi son appel sur cet appareil.
- L’administration serveur distingue les Espaces, salons, messages privés et
  bibliothèques, avec leurs noms et une recherche.
- Le moteur Matrix Rust prend en charge ces fonctions sur ordinateur et Android.
  La bibliothèque historique reste disponible tant que vous n’avez pas migré.

## Membres, sons et mèmes

- Membres regroupés en En vocal, En ligne, AFK et Hors ligne, avec présence
  Matrix, indicateurs et nom du salon vocal. AFK correspond à la sourdine en vocal.
- TOP sur les sons et les mèmes, catégories sur la memeboard, commandes de
  volume et d’édition harmonisées. Les anciens favoris de la soundboard sont retirés.
- Les suppressions utilisent une confirmation intégrée à Sion.

## Fluidité et mémoire

- Les mises à jour des niveaux audio et des messages ne redessinent plus les
  composants qui n’utilisent que les commandes vocales.
- Les chargements simultanés d’un même son partagent un téléchargement et un
  blob. Les anciens fonds de modules sont libérés lorsqu’ils sont remplacés.
- Les détails de salons conservés en mémoire sont plafonnés. Les réponses d’une
  ancienne session ne repeuplent plus le cache du nouveau compte.
- Les rafraîchissements des bibliothèques sont regroupés et les minuteurs
  vocaux restent arrêtés si une déconnexion arrive pendant la connexion.

## Installation

Téléchargez l’AppImage Linux, l’installeur Windows ou l’APK Android attaché à
cette version. Depuis la bêta 8, activez les préversions dans Paramètres →
Avancé pour recevoir aussi les bêtas via la mise à jour intégrée.

La migration de vos salons existants vers un Espace reste une action explicite.
Les anciens clients peuvent encore accéder à leurs salons, mais ne disposent
pas du rail ni des bibliothèques propres aux Espaces.

## Points à suivre

- La revue et les tests de nettoyage ne garantissent pas l’absence de fuite
  après plusieurs jours d’appel ou de partage d’écran ; ce suivi continue.
- Android : les notifications de messages chiffrés en arrière-plan restent
  génériques, et recevoir un partage d’écran peut encore consommer beaucoup.
