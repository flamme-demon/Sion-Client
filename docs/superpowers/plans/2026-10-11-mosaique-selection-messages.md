# Mosaïque et sélection des messages

## Regroupement compatible Matrix

Chaque image reste un événement `m.room.message` distinct. Le rendu Sion
regroupe des images consécutives d'un même identifiant Matrix, sans marqueur
spécifique au client d'envoi : cela fonctionne aussi pour Element et les
autres clients. Voir la [spécification m.image](https://spec.matrix.org/latest/client-server-api/#mimage).

Un groupe contient au plus dix images, avec moins d'une minute entre deux
images et moins de trois minutes au total. Le jour, le début des non-lus,
un autre auteur, un texte, une légende, une réponse ou une édition interrompent
le groupe. Les événements d'origine, leurs identifiants, réactions, lectures
et références de réponse restent indépendants.

## Rendu jointif

La capture Telegram fournie sert de référence : un seul cadre arrondi, des
séparations de 2 px, des rangées de deux ou trois images selon leurs proportions
et une heure commune en bas à droite. Les boutons individuels apparaissent
au survol ou au focus, sans réserver une bande sous chaque photo. Sur téléphone,
l'appui long propose les actions de l'image. Un clic ou Entrée ouvre l'original.
Les vignettes continuent d'être déchargées hors de la vue par `ImageDuFil`.
Une URL déchiffrée arrivée après le démontage est immédiatement libérée.

Les moteurs Matrix Rust et JavaScript conservent désormais `filename`, la
légende et la relation de réponse des médias, plutôt que d'assimiler tout
`body` au nom du fichier. Les images accompagnées de texte restent autonomes.

## Suppression multiple

Le clic droit ou l'appui long propose « Sélectionner » et, dans la mosaïque,
« Sélectionner le groupe d'images ». Ensuite un clic sur d'autres messages
complète la sélection. La barre du chat affiche le nombre sélectionné, une
corbeille et une annulation. Une confirmation précède toute requête.

Une requête Matrix de redaction est envoyée par événement. Les droits sont
recontrôlés entre chaque requête : auteur du message ou niveau `redact` du
salon, indépendant du niveau de modification de l'état. Le serveur reste
l'autorité. Seuls les succès sont retirés du fil ; les échecs restent
sélectionnés pour reprise. Une sélection est annulée au changement de salon
ou de compte et n'est pas persistée. Le lot s'arrête si le compte change.
Un événement absent du fil chargé n'est pas présenté comme supprimé.

## Validation

- Tests de regroupement, disposition, légendes et réponses, menus par image,
  références des non-lus, confirmation, droits, échecs partiels, double clic
  et changement de salon/compte.
- 153 tests unitaires du cœur Matrix Rust réussis ; aucun compte réel utilisé.
- Aperçu Chromium avec comptes/images fictifs en 1440×900, 390×844 et 320×640 :
  groupes de 2, 3, 4, 5, 6 et 10 images propres ou reçues, agrandissement,
  réponse individuelle, sélection du groupe, annulation puis suppression
  de seulement deux événements sélectionnés.
- Client Linux existant : neuf mosaïques / 31 images, contours internes
  supprimés, traductions rechargées et vocal connecté. Vérification en lecture
  seule ; aucun message réel supprimé.
- Validation finale : 93 tests frontend, TypeScript et lint ciblé réussis.
  Les deux fichiers de rendu historiques conservent six avertissements de
  hooks sur des lignes préexistantes, sans erreur de lint. Build Linux natif
  terminé ; le client connecté reste sur son processus existant pour conserver
  l'appel. Les corrections Rust seront chargées au prochain lancement.
