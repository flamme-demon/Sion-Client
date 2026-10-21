# Sion Client 2.0.2

## Vidéos et mèmes

- Le lecteur flottant des vidéos du fil reste correctement positionné pendant
  le défilement, y compris dans les modules de discussion.
- La présentation des images suit leurs horodatages et conserve la dernière
  image jusqu'à la fin du média. Les mèmes gardent aussi leur image jusqu'à
  la fin de leur bande-son.
- Le découpage des mèmes respecte les bornes choisies et la cadence originale.
  Réduire la fin d'une sélection de dix secondes ne déplace plus son début.
- L'éditeur de mèmes propose une vue d'ensemble, une vue zoomée, un curseur
  de lecture et des boutons pour fixer le début ou la fin.

## Soundboard et memeboard

- Les fenêtres d'ajout restent au-dessus des modules et leur contenu défile
  sans masquer les boutons Annuler et Envoyer.
- L'ajout de sons reprend la présentation de l'ajout de mèmes : choix fichier
  ou lien, nom et emoji regroupés, champs et boutons harmonisés.

## Diagnostic dans les paramètres avancés

- Sur Linux et Windows, les journaux détaillés peuvent être activés pour une
  heure, avec arrêt automatique et possibilité de les couper immédiatement.
- Windows propose une option indépendante pour conserver les deux derniers
  rapports mémoire de plantage. Sa modification utilise la confirmation
  administrateur de Windows depuis Sion.
- Linux peut récupérer les rapports de Sion conservés par systemd-coredump
  lorsqu'ils sont disponibles et accessibles au compte courant.
- Un export ZIP rassemble les journaux et les informations techniques. Les
  rapports mémoire sont inclus uniquement sur sélection ; aucun envoi
  automatique n'est effectué.
- La conservation des journaux et la remontée des erreurs de la fenêtre sont
  corrigées pour préserver le contexte d'un incident et empêcher une boucle
  d'erreurs d'affichage de remplir le journal.
