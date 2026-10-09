# Espaces Matrix dans Sion

L’équipe est un véritable salon Matrix de type `m.space`. Son nom et son avatar apparaissent dans le rail, sous l’accueil des MP. Le bouton « + » permet de créer un Espace ou de rejoindre un Espace existant, y compris sur un autre serveur, avec son alias, son identifiant ou un lien `matrix.to`.

Le nom de l’Espace dans le menu et le clic droit sur son avatar ouvrent ses réglages : description, logo, partage, salons, bibliothèque, invitations et rôles. Les membres peuvent explorer et rejoindre les salons ; les responsables de l’Espace peuvent le modifier. Les droits du serveur et ceux d’un Espace restent distincts. La politique de création de salons du serveur Matrix s’applique aussi à la création d’Espaces.

## Salons et admission

Les liens utilisent `m.space.child` dans le parent et `m.space.parent` dans le salon. Un salon commun créé depuis Sion utilise `m.room.join_rules` avec `restricted` et une autorisation `m.room_membership` pour son Espace. Un salon privé reste `invite`. Le champ standard `suggested` indique les salons communs dans la liste locale ; avant de rejoindre ou d’admettre un compte, Sion vérifie aussi la règle d’accès réelle.

Une invitation à un Espace attend une acceptation explicite. Après l’acceptation, ou lors de l’ouverture d’un Espace déjà rejoint, Sion rejoint ses salons publics et ses salons restreints autorisés par cet Espace. Les salons privés et les sous-Espaces demandent une adhésion séparée. La hiérarchie est paginée et les serveurs `via` sont conservés, notamment pour les identifiants opaques des salons Matrix v12.

La validation des comptes du serveur conserve sa première étape : lever la suspension du compte. Sa moulinette ajoute ensuite le compte à l’Espace sélectionné et à ses salons communs, bibliothèque comprise. Elle ne parcourt pas les autres Espaces, les MP ni les salons privés. Il faut être responsable de l’Espace pour cette admission et administrateur du serveur pour valider le compte. Tant qu’aucun Espace n’existe, le comportement historique reste disponible. Dès qu’un Espace existe, les créations et validations exigent une sélection explicite.

Les invitations envoyées depuis les réglages de l’Espace concernent aussi les comptes externes. L’adhésion aux salons communs suit l’acceptation sur un client Sion. D’autres clients Matrix proposent leur propre exploration des salons.

Les rôles Matrix ne s’héritent pas automatiquement. Les changements de rôle effectués dans les réglages Sion de l’Espace sont donc aussi appliqués à ses salons communs accessibles. Un échec partiel est signalé. Quitter l’Espace conserve les adhésions aux salons déjà rejoints ; le dialogue le précise.

Chaque membre peut quitter un salon texte, vocal ou un MP depuis son clic droit (appui long sur téléphone). Le menu et la confirmation Sion sont rendus dans le document, au-dessus des modules. Quitter le salon d’un appel actif raccroche d’abord cet appel ; le vocal d’un autre salon est conservé. Le départ n’est retiré de la liste qu’après réussite de la demande Matrix, et une autre conversation de la vue courante est sélectionnée si nécessaire.

Les salons quittés volontairement sont mémorisés sur cet appareil, par compte (`sion_salons_quittes:<utilisateur>`), pour être ignorés par la jointure automatique des salons communs au redémarrage. Rejoindre explicitement un salon dans les réglages de l’Espace, ou choisir « Rejoindre les salons communs », lève cette exclusion après réussite. Quitter un Espace reste disponible pour un simple membre dans ses réglages, accessibles par clic droit sur son logo.

## Soundboard et memeboard

Les deux panneaux partagent une bibliothèque **par Espace**. L’état `com.sion.space` de l’Espace désigne son `board_room_id`. Une nouvelle bibliothèque est un salon avec l’état `m.room.type = com.sion.board`, accessible aux membres de cet Espace ; les publications exigent le niveau 50.

Tous les appels natifs de lecture, import, modification et suppression reçoivent l’identifiant de cette bibliothèque. Un Espace sans bibliothèque affiche une liste vide, sans reprendre celle d’une autre équipe. Les panneaux se rechargent quand l’Espace ou sa bibliothèque change. Le salon d’un import est capturé avant les opérations asynchrones ; une navigation pendant l’import ne change pas sa destination.

La création et la synchronisation de cette bibliothèque se font dans « Soundboard et memeboard » des réglages de l’Espace. Elles exigent le niveau administrateur de l’Espace (100, y compris le créateur v12), vérifié à nouveau par le service lors de l’action. Un administrateur du serveur qui n’a pas ce rôle dans l’Espace n’obtient pas ces boutons. Les modérateurs conservent leurs autres outils de gestion et de publication. Le raccourci historique de création globale a été retiré du menu serveur.

Dans l’administration du serveur, « Espaces, salons et MP » distingue les Espaces, les salons texte/vocaux, les conversations privées et les bibliothèques. Les noms proviennent de la liste locale, des métadonnées de l’API quand elle en fournit, et de la hiérarchie des Espaces accessibles. Les éléments sans métadonnées restent dans « Autres salons Matrix », identifiés par leur ID. La recherche porte aussi sur les noms des Espaces parents ; les MP restent sans action de suppression globale. La fenêtre Sion est rendue en portail et le panneau d’administration reste ouvert pendant son utilisation.

## Récupérer l’existant

La création du premier Espace propose de sélectionner des salons existants et de récupérer la bibliothèque actuelle. Aucun salon ni événement n’est recréé. Les salons publics sélectionnés deviennent restreints à l’Espace ; leurs membres reçoivent une invitation dans l’Espace. Les salons privés sélectionnés gardent leurs invitations séparées. La bibliothèque conserve son identifiant, ses sons, ses mèmes et leurs catégories.

Cette récupération se déclenche depuis le formulaire, pas au démarrage de l’application. L’accueil serveur garde les salons non rattachés. La bibliothèque récupérée cesse d’y apparaître pour éviter de partager accidentellement la bibliothèque d’une équipe avec une autre.

## Vérification

- TypeScript et lint des fichiers modifiés.
- Tests d’interface, de séparation des listes, de sélection par compte, de routage et de périmètre de validation.
- Tests des bibliothèques : deux Espaces, Espace vide, navigation pendant une résolution, état Matrix reçu avant la liste locale.
- Tests du moteur Rust, dont le classement des Espaces et des bibliothèques.
- Test réel `sion-matrix/tests/espaces_local.rs` sur un serveur Continuwuity local jetable : bibliothèques isolées, invitation explicite, accès restreint et hiérarchie.

## Service vocal d’autres équipes

Le service LiveKit annoncé dans le salon reste prioritaire. Si aucun service n’est annoncé, Sion utilise le `.well-known/matrix/client` du compte, sans emprunter celui d’un autre salon qui pourrait appartenir à une autre équipe. L’adresse WebSocket renvoyée avec le jeton est utilisée lorsqu’elle est valable et ne désigne pas la boucle locale. Le repli via le proxy public reste disponible pour le déploiement Sion qui renvoie une adresse interne de boucle locale.
