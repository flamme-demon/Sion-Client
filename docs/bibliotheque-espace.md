# Gestion du salon Soundboard et memeboard

La rubrique **Soundboard et memeboard** des paramètres de l’espace lit le salon désigné par `com.sion.space.board_room_id`. Une erreur de lecture laisse l’état indéterminé et ne propose pas de création. En l’absence confirmée de salon, un administrateur peut le créer et inviter les membres de l’espace. Les demandes simultanées partagent la création ; une nouvelle tentative conserve l’identifiant déjà créé si la publication de sa désignation a échoué.

Pour un salon existant, quatre compteurs ouvrent les listes correspondantes : membres présents, invitations en attente, membres de l’espace non invités, membres exclus. La lecture complète des adhésions passe par l’API Matrix `/members`, y compris avec le moteur Rust, pour couvrir les membres chargés à la demande et les changements acceptés avant leur arrivée dans `/sync`. Les membres du salon qui ont quitté l’espace restent visibles dans la liste des présents.

Une synchronisation invite uniquement les membres manquants de cet espace. Elle ignore les adhésions `join`, les invitations `invite`, les bannissements et les expulsions reconnues par un état `leave` émis par un autre utilisateur. Les refus ou départs volontaires peuvent être réinvités explicitement. Les échecs individuels restent signalés ; un changement de compte arrête le lot.

Les actions de modération relisent le salon et ses permissions avant de s’exécuter. Elles respectent les niveaux `kick` et `ban`, l’appartenance du modérateur et la supériorité de son niveau sur la cible, y compris les créateurs de salon v12 de niveau infini. La confirmation propose un motif et une option de bannissement. L’action touche uniquement la bibliothèque ; elle ne modifie ni l’adhésion à l’espace ni ses autres salons. Un exclu peut être rétabli et invité explicitement, avec débannissement préalable si nécessaire.

Une expulsion simple permet un retour selon les règles d’accès du salon. Un bannissement empêche ce retour jusqu’à sa levée, conformément aux [règles d’adhésion Matrix](https://spec.matrix.org/latest/client-server-api/#banning-users-in-a-room).

Les tests couvrent les quatre listes dans les moteurs Rust et JS, les invitations ciblées et partielles, les permissions, les exclusions, la création partagée et sa reprise, et les réponses tardives après navigation. Aucun test n’invite ni n’expulse un utilisateur sur un serveur réel.
