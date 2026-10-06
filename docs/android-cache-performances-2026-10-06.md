# Android : caches et relevés du 6 octobre 2026

## Gestion des caches

- Fichiers dans `cache/sion-media` : budget de 250 Mio, expiration après
  24 heures sans consultation, suppression des fichiers les moins récemment
  consultés en premier. Nettoyage au démarrage, chaque minute et après la
  dernière lecture d'un fichier.
- Cache média du SDK Matrix : budget de 250 Mio et même expiration. Les
  fichiers de plus de 32 Mio ne sont pas conservés dans ce deuxième cache,
  pour éviter leur duplication avec le cache du lecteur.
- Le budget cumulé des **contenus média** est donc de 500 Mio, hors fichiers
  protégés pendant leur utilisation et espace de structure des bases SQLite.
  Un fichier en cours de lecture peut temporairement dépasser le budget.
- Les téléchargements, lectures par plage et transcodages conservent un bail
  sur leurs fichiers. Une purge marque les fichiers utilisés pour suppression
  dès la libération du dernier lecteur. Les préparations récentes disposent
  d'un délai de cinq minutes lors du nettoyage automatique.
- Les baux Android couvrent toute la durée du lecteur, même entre deux
  requêtes HTTP. Ils sont libérés à sa fermeture, au changement de vidéo, à
  la fin de lecture et lors d'un rechargement du WebView.
- Le bouton de purge attend le nettoyage des deux caches média puis vide le
  cache IndexedDB des identifiants de messages. La session, les préférences,
  les bases de chiffrement et le magasin d'état Matrix sont conservés.
- Les téléchargements du SDK et ses nettoyages sont sérialisés : une purge
  attend les téléchargements déjà commencés et restaure ensuite la politique
  normale de rétention. Le SDK n'a pas de second ordonnanceur concurrent.

## Vérifications sur le téléphone

Sion Dev, Xiaomi cupid2201123G, connexion USB. APK de développement construit
et installé avec `build-scripts/build-android.sh debug`.

| Contrôle | Résultat |
| --- | --- |
| Ouverture du salon contenant sept cartes vidéo | Aucun lecteur monté et aucune requête `/matrix/` avant le clic |
| Purge des fichiers temporaires | 66 748 Kio → 4 Kio ; sept fichiers supprimés |
| Purge du magasin média SQLite | 90 415 104 octets → 36 864 octets |
| État de session et préférences autour de la purge | Identiques |
| Vidéo de Rabah après installation | Lecture avec son non muet et compteur audio croissant |
| Décodeur vidéo du WebView | `MediaCodecVideoDecoder`, `kIsPlatformVideoDecoder=true`, 1080 × 1920 |

Le SDK SQLite réduit physiquement son fichier lors de ce nettoyage, au lieu
de seulement supprimer des lignes. Les médias seront téléchargés à nouveau
lors d'une prochaine consultation : une purge n'empêche pas le remplissage
normal du cache.

## Performances et limites des relevés

La batterie était à 31,6–33 °C avant les nouveaux tests. Pendant la session
avec appel et réception de partage d'écran, les relevés HAL ont atteint
42,4 °C, puis le service batterie a indiqué 43,2 °C. Le statut thermique Android
est resté à 0, sans bridage signalé lors des relevés.

Un premier échantillon, sans lecteur vidéo de fichier, montrait environ
190 % CPU pour Sion et 116–122 % pour son WebView dans `top` (100 % représente
un cœur, le téléphone en a huit). Le profil JavaScript montre le transport
des images natives, les copies de buffers, `Blob`, `createImageBitmap` et le
rendu du partage sur canvas. Ce chemin JPEG est donc un poste de coût visible
pendant la réception d'un partage ; le compteur de lecteurs HTML vidéo peut
être nul malgré cette activité.

Les états de l'appel ont changé pendant les mesures. Un snapshot déconnecté
a été suivi d'un état connecté dans l'échantillon suivant. Les pourcentages
ne constituent donc pas une comparaison contrôlée du vrai repos et de la
lecture seule. Les tentatives de mesure de Gaetan et certains appels de
diagnostic ont été interrompus ; ils ne sont pas présentés comme des tests
réussis. La chauffe a été mesurée sous charge USB et en compilation Rust de
développement non optimisée : ces résultats ne prédisent pas les performances
d'un APK de publication.

Le pont de partage actuel conserve les réglages du bureau : jusqu'à 2560 px
de large et 25 images/s avant adaptation. Une limite propre à Android ou une
surface vidéo native éviterait une partie de ce coût. Aucun changement de
résolution ou de cadence n'a été appliqué dans cette correction de cache.

## Validation automatisée

- Six tests Rust du cache fichier : LRU, expiration, budgets, protection des
  lecteurs, purge différée et portée des chemins.
- Sept tests du cœur Matrix, dont deux nouveaux avec une vraie base SQLite :
  politique installée à la création du client et purge conservant la session
  et le magasin de chiffrement.
- Vingt-six tests frontend ciblés : lecteur Android, purge et registre du
  lecteur actif ; compilation TypeScript et contrôles de lint ciblés réussis.
- Construction de l'APK Android réussie et `git diff --check` propre.
