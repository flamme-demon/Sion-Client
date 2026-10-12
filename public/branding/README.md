# Identité Sion

Visuels fournis pour Sion : tête du logo sur fond transparent, logo avec texte,
animations portrait (mobile) et paysage (ordinateur).

Les MP4 sont exportés en H.264, sans son, dans l'ordre inverse des images des
originaux. Les WebP de démarrage correspondent à leur première image et servent
de secours, notamment lorsque les animations sont réduites dans le système.
Le logo avec texte conserve son canal alpha.

Le premier plan Android est réduit à 64 % de sa couche avec des marges
transparentes. Toute la tête tient ainsi dans le cercle protégé de l'icône
adaptative, quelle que soit la forme choisie par le lanceur. Ce cadrage est
aussi utilisé pour le logo du démarrage natif.

Pour régénérer les ressources et les icônes de toutes les plateformes :

```sh
bash build-scripts/preparer-identite.sh "<dossier-des-visuels>"
```

Outils nécessaires : Bun/Tauri et FFmpeg avec libx264/libwebp. La compilation
normale utilise les fichiers présents ici et ne dépend pas du dossier source.
