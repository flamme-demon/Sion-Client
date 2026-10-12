# Identité et démarrage Sion

Implémentation sur `feat/interface-bulles`, 10 octobre 2026.

- Tête du nouveau logo : icônes natives de toutes les plateformes et favicon.
- Logo avec texte : connexion et rubrique des mises à jour.
- Animations inversées : portrait sur mobile, paysage sur ordinateur.
- Ressources embarquées : H.264 sans son, images WebP avec alpha conservé.

Le HTML contient le poster avant même le chargement de JavaScript. Le service
`demarrage` lance ensuite uniquement la vidéo adaptée à la largeur. La session
et l'interface se préparent en parallèle. Leur premier rendu ferme le visuel
avec un fondu de 180 ms ; la durée du clip n'impose aucune attente.

La vidéo est mise en pause en arrière-plan, sans rejouer un clip terminé.
Les animations réduites ne chargent pas de MP4. Une erreur de lecture conserve
le poster. À la fermeture, le lecteur, sa source et ses écouteurs sont libérés.

Android affiche d'abord la tête sur fond sombre via son thème de démarrage,
puis le visuel embarqué dans Sion. Le thème existe aussi en mode nuit.
Le premier plan adaptatif est réduit à 64 % et centré avec un remplissage
transparent : le logo entier reste dans le cercle protégé de 66 dp sur 108 dp.
Cette marge est appliquée après la génération Tauri, car `android_fg_scale`
ne modifie que les icônes Android classiques, pas leur couche adaptative.

`build-scripts/preparer-identite.sh` régénère les ressources à partir du dossier
source fourni : aucune dépendance au dossier personnel lors des builds normaux.

Validation : 9 tests de cycle de vie, TypeScript, lint sans nouvelle erreur,
lecture des deux MP4 et des vues connexion dans Chromium, image fixe et absence
de téléchargement vidéo lorsque les animations sont réduites.
APK de Sion Dev compilé et installé sur téléphone : lecture des deux fichiers
embarqués vérifiée au premier plan, favicon mis à jour, aucun lecteur de
démarrage conservé après l'ouverture de l'interface.

Correction du cadrage Android : les cinq densités ont été vérifiées dans les
sources et dans l'APK. Tous les pixels du premier plan tiennent dans le cercle
protégé. L'APK a été reconstruit avec les bibliothèques natives existantes,
puis installé sur le téléphone ; les oreilles et le menton restent entiers
dans l'icône ronde du lanceur.
