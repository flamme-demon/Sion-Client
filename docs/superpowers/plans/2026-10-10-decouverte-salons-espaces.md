# Choisir les salons d’un espace Matrix

Implémentation sur `feat/interface-bulles`, 10 octobre 2026.

L’adhésion à un espace ouvre une liste de ses salons consultables, sans
abonnement automatique. Le bouton « Parcourir les salons » permet de rouvrir
la liste. Chaque salon reste au choix de l’utilisateur ; les salons déjà
rejoints sont indiqués. Les suggestions ne sont pas cochées automatiquement.

La hiérarchie Matrix est paginée et limitée au niveau courant. Les liens
`m.space.child` doivent avoir des serveurs `via`. Les sous-espaces s’explorent
sans y adhérer et les choix restent présents en revenant au niveau précédent.
La jointure emploie les `via` du lien ; le serveur vérifie les autorisations.
Les refus sont présentés par salon et une reprise concerne seulement les
choix encore en échec.

Sur l’espace public Manjaro, Continuwuity retourne 16 salons consultables,
mais omet `join_rule`. Le précédent filtre ne proposait donc aucun salon.
Cette propriété facultative ne sert plus à filtrer les choix affichés.

Les liens parcourus sont conservés par compte pour rattacher un salon rejoint
à l’espace racine, même si un sous-espace intermédiaire n’est pas rejoint.
Le cache persistant contient uniquement les identifiants des liens et garde
au plus 128 espaces. Les listes consultables restent en mémoire pendant une
minute, limitées à 64 espaces ; elles sont vidées au changement de compte et
après une modification des liens. Les appels simultanés partagent une demande.

Les listes de salons, le retour au dernier salon, les compteurs de non-lus,
le choix suivant un départ et la liste des membres prennent en compte les
espaces imbriqués, avec protection contre les cycles. L’état Matrix d’un
espace rejoint prend priorité sur les liens mis en cache.

## Lenteurs et avertissements observés

La première consultation réelle de Manjaro sur Sion Dev Android a pris
environ 5,5 secondes avant d’afficher ses 16 salons. Le cache évite de
redemander la hiérarchie lors des réouvertures rapprochées.

Des messages partageant le même lien lançaient plusieurs demandes d’aperçu
concurrentes. Une seule promesse dessert maintenant toutes leurs cartes,
y compris les reprises et les doubles effets de React en développement.
Les erreurs HTTP permanentes conservent leur temporisation de cinq minutes.
Un changement de lien n’affiche plus temporairement l’aperçu du précédent.

Le moteur Rust regroupe les requêtes d’un même média et format. Il garde les
échecs 30 secondes, avec un maximum de 256 entrées, et journalise le premier
échec. Une miniature indisponible ne bloque pas le téléchargement de son
original. Les verrous inutilisés ne s’accumulent pas.

Une erreur de nombre de hooks React a été relevée pendant un rechargement à
chaud. Le calcul des compteurs demande désormais un remontage propre en dev.
Un redémarrage natif et les rechargements suivants ne la reproduisent pas.

Le réglage global du salon au démarrage prenait auparavant son candidat
uniquement dans l’espace consulté. Après Manjaro, le vocal Sion configuré
était ignoré. Le candidat est maintenant cherché dans les salons rejoints,
puis son espace est sélectionné. L’entrée automatique est respectée. Un
choix manuel intervenu pendant l’initialisation garde priorité.

Vite ignore les tests et leurs fichiers de configuration : l’écriture d’un
test provoquait un rechargement complet, coupant inutilement l’interface et
déclenchant une reprise vocale pendant le développement.

Sur Linux, l’icône du lanceur installé restait celle de l’ancienne version,
malgré les nouvelles ressources embarquées. Le profil de bureau utilise une
copie du nouveau PNG, et le cache de services KDE a été actualisé.

Un autre problème est relevé dans les logs natifs : une collision BUNDLE sur
le payload Opus 111, avec `stereo=1` présent sur une seule description. Le
patch existant de `sprop-stereo` dans libwebrtc ne couvre pas ce paramètre.
Le correctif de `libwebrtc` traite désormais `stereo` et `sprop-stereo`, par
groupe BUNDLE et payload Opus. Les descriptions déjà cohérentes et les
autres codecs ne sont pas modifiés. Le test d'intégration reproduit ces
différences dans une offre WebRTC réelle, puis vérifie la validation native,
la génération et l'application d'une réponse. Détails dans
`src-tauri/vendor/libwebrtc/SION_PATCH.md`.

Le client desktop a été recompilé et relancé avec ce correctif. Connexion au
vocal constatée avec trois participants et deux pistes audio distantes
souscrites ; aucune collision Opus dans les logs de cette connexion. Le
micro coupé a été conservé lors de la reprise, et le réglage d'entrée
automatique rétabli à sa valeur précédente.

## Validation

- 123 tests ciblés côté interface, services, stores, navigation et vocal.
- 8 tests Rust des médias, dont requêtes concurrentes, reprise après
  expiration, indépendance des formats et limitation du cache.
- 8 tests purs de normalisation Opus et 1 test d'intégration WebRTC natif,
  couvrant séparément `stereo`, `sprop-stereo` et les deux ensemble.
- TypeScript et lint des modifications de performances.
- Chromium : 16 salons, recherche, choix unique, aucune jointure automatique,
  fenêtre et boutons visibles en 1440×900, 390×844 et 320×640.
- Sion Dev Android : consultation réelle de Manjaro en lecture seule ; aucun
  salon rejoint par le diagnostic. Vérification du dialogue et de son pied.
- Client Linux compilé et démarré : première ouverture Manjaro en 3,25 s,
  réouverture avec cache en 84 ms, 16 salons, aucune erreur du dialogue.
- Après correction du démarrage, connexion au vocal configuré constatée lors
  des rechargements de dev ; le moteur termine la connexion et publication
  du micro en environ 650 ms.
- Rendu Linux observé sur 2 s : intervalle médian 12 ms, p90 21 ms, maximum
  28 ms. Cette mesure ponctuelle ne garantit pas la fluidité de tous les
  salons ni de toutes les interactions.

Les données du banc visuel sont les métadonnées publiques de l’espace
Manjaro, avec un compte fictif et des jointures simulées. Aucun jeton de
session ni message utilisateur n’est ajouté au dépôt.

## Bibliothèques pendant la navigation (11 octobre)

Les modules soundboard et memeboard suivaient l'espace consulté, même quand
l'utilisateur restait en vocal dans une autre équipe. Passer dans Manjaro,
qui ne déclare pas de bibliothèque Sion, vidait donc les deux modules.

Pendant un appel, les modules utilisent maintenant la bibliothèque de
l'espace contenant le vocal. Hors appel, ils retrouvent celle de l'espace
consulté. Le contexte apparaît dans l'en-tête sur bureau et téléphone.
L'administration et la migration continuent à utiliser l'espace consulté.
Un vocal d'un espace sans bibliothèque ne récupère pas celle d'une autre
équipe. Un vocal encore inconnu attend la synchronisation.

La recherche dans les panneaux reste en place pendant la navigation au
cours d'un appel. Un changement de bibliothèque ou de compte recharge les
cartes. Les mises à jour de présence et de parole ne déclenchent pas de
rendu des consommateurs du contexte.

Validation : 88 tests ciblés, TypeScript, lint et vérification du diff.
Dans Sion dev connecté au vocal, passage temporaire dans Manjaro puis
retour : mêmes panneaux montés, mêmes 19 sons et 66 mèmes, bibliothèque du
vocal disponible et bibliothèque Manjaro absente. Les en-têtes ne débordent
pas à la largeur observée de 298 px. Aucun son ni mème diffusé par le test.

## Départ d'une communauté

La confirmation propose maintenant un départ complet, sélectionné par
défaut, ou le départ de l'espace seul. Les descendants rejoints et la
bibliothèque figurent dans une liste de choix ; les salons partagés avec
une autre communauté rejointe sont décochés, et les MP restent exclus.
La liste défile pendant que les actions restent visibles.

Les salons sont quittés avant les sous-espaces et l'espace principal. Un
échec laisse l'espace rejoint et permet de reprendre les salons restants.
Le vocal concerné est raccroché avant le départ Matrix, y compris si son
entrée est encore en cours. Sa reconnexion, son entrée automatique en
attente et son réglage de démarrage sont annulés lorsqu'il est quitté.
Une navigation ou un changement de compte pendant l'opération est respecté.

Quitter seulement l'espace conserve les adhésions et l'appel. Le contexte
de bibliothèque de cet appel est gardé en mémoire jusqu'à son raccrochage,
sans ajouter de préférence persistante ni modifier l'administration.

Validation : 119 tests ciblés, TypeScript et lint. Dans le client Linux,
confirmation complète vérifiée avec quatre salons et bibliothèque, textes
traduits et actions visibles. Annulation uniquement : aucune adhésion
réelle quittée et vocal conservé.

Sur l'aperçu isolé à données fictives, la confirmation de départ tient aussi
en 390×844 et 320×640 : actions visibles, liste défilante, salon partagé
décoché et annulation sans appel au serveur.
