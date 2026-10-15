# Routage audio Android et boutons de casque

Ajout du 14 octobre 2026. Le moteur vocal et le mélange des sons restent
dans Rust. Le service Android possède le routage, la priorité audio et la
session de boutons du casque pendant le vocal.

La barre vocale propose **Automatique**, les casques disponibles,
**Haut-parleur** et **Écouteur du téléphone**. En automatique, un casque
Bluetooth passe devant les sorties filaires ou USB, puis le haut-parleur.
Une sortie choisie reste prioritaire jusqu'à son retrait ou un autre choix.
Débrancher le casque rétablit le mode automatique. Les identifiants de
périphériques restent propres à l'appel, sans être persistés.
Le même sélecteur reste accessible dans la carte de profil en paysage ou
sur tablette, y compris lorsque la barre latérale est réduite.

Sur Android 14 et suivants avec téléphonie, le service déclare un appel
VoIP transactionnel auprès de `TelecomManager`. Android possède alors la
priorité audio, les sorties de l'appel et les commandes téléphoniques HFP
du casque. La notification utilise `CallStyle`. Les demandes de sortie
passent par `CallControl.requestCallEndpointChange` et les confirmations
par `CallEventCallback`. Un appel en attente de création porte aussi un
identifiant : sa réponse tardive ferme uniquement cet ancien appel.

Sur Android 12 et 13, et les appareils sans Telecom, le service utilise `setCommunicationDevice`,
les appareils disponibles pour la communication et le retour
`OnCommunicationDeviceChangedListener`. Une demande acceptée reste indiquée
comme en cours jusqu'à confirmation. Deux tentatives prennent au plus
30 secondes ; un échec permet le repli vers une autre sortie avec une
erreur visible. Les casques Bluetooth classiques et LE Audio utilisent
la même sélection Android. Android choisit également le microphone associé.

Sur Android 8 à 11, le service utilise le profil de casque Bluetooth et
SCO. La confirmation Bluetooth vient de l'état SCO. Le retour vers le
téléphone et la fermeture arrêtent explicitement SCO. L'écouteur ne peut
pas être forcé au-dessus d'un casque filaire branché avec ces anciennes API.
L'autorisation Bluetooth normale est limitée à ces versions ; la voie
moderne ne passe pas par le profil Bluetooth historique.

Le focus et le mode de communication sont acquis après le démarrage du
service de premier plan. Un appel téléphonique ou une perte de focus ferme
une porte audio native indépendante du mute et du push-to-talk : capture,
voix reçue et sons locaux sont silencieux. Leur reprise conserve les choix
de micro de l'utilisateur. Les sorties PCM locales utilisent le flux de
communication pendant le vocal, et le flux média après l'appel.
Les sons courts en cours sont annulés à l'interruption pour ne pas rejouer
une notification devenue ancienne lors de la reprise.
Une perte permanente de priorité audio se reprend par **Reprendre l'audio**,
sans voler automatiquement la priorité à une autre application. Cette
reprise respecte un appel téléphonique encore actif.
Choisir manuellement une sortie reste possible pendant cette suspension et
demande aussi explicitement la reprise. La sélection automatique attend la
reprise avant de changer de sortie.

Les memes reçus sur mobile gardent leur image dans une vidéo muette. Leur
son est décodé dans un `OfflineAudioContext`, puis envoyé au lecteur PCM
natif, avec sa position consommée comme horloge. Leur retrait annule le
chargement et arrête le lecteur, y compris pendant son ouverture. Le
contexte partagé de décodage des sons est lui aussi hors ligne : il
n'ouvre aucune sortie Android. Cela évite qu'un meme ou un simple décodage
prenne le focus du vocal dans Chromium.

Le test du microphone dans les réglages demande l'autorisation Android
avant la capture. Le pont Rust vérifie aussi cette autorisation avant un
test ou une connexion : un refus ne doit pas créer un enregistreur natif
partiellement initialisé.

Sur Android 14 et suivants, raccrocher avec le casque HFP termine l'appel
Telecom et quitte le vocal Sion. Les changements du mute système sont
répercutés dans Rust ; sur Android 15 et suivants, les changements dans
Sion sont aussi envoyés à Telecom. L'état initial « micro ouvert » du
téléphone ne réactive jamais un vocal rejoint avec le micro coupé.

Le mute natif reste la référence pendant une connexion, un retrait ou une
bascule de casque. Un retour du mute système à « ouvert » sur le téléphone
ne peut pas ouvrir le micro Sion. Une demande d'ouverture venant du casque
attend 350 ms, puis vérifie que ce même casque est toujours disponible sur
la même sortie. Un changement de sortie, un nouvel état push-to-talk, une
interruption ou la fermeture annule cette demande, y compris si son ancien
callback s'exécute ensuite.
Sur Android 15 et suivants, l'arrivée d'un casque pendant que Sion est muet
réapplique le mute matériel par une transition système dédiée. Le moteur
natif reste muet tout au long de cette synchronisation ; les confirmations
Android ne sont jamais prises pour des appuis du casque. Les demandes sont
sérialisées et suivent le dernier état demandé par l'utilisateur.

Les touches média transmises par Android passent par une `MediaSession` active
pendant l'appel, ainsi que par l'activité lorsqu'elle reçoit directement
les touches. La répétition et le relâchement ne déclenchent pas de deuxième
action. Les actions arrivent au moteur par JNI, même si l'interface dort.

| Commande Android | Action Sion |
| --- | --- |
| Mute du microphone | Couper ou rétablir le micro |
| Raccrocher HFP, Android 14 et suivants | Quitter le vocal |
| Touche média du casque / lecture-pause | Micro par défaut ; « Quitter le vocal » configurable |
| Lecture | Rétablir le micro |
| Pause | Couper le micro |
| Raccrocher / arrêt | Quitter le vocal |
| Volume, mute du volume | Gérés par Android |

Le choix de la touche média est conservé localement. Une seule tâche
native traite les changements de micro d'un appel ; les appuis rapprochés
sont regroupés. Chaque appel porte un identifiant propre pour empêcher
une ancienne commande d'agir sur un appel suivant. Le raccrochage quitte
l'appartenance MatrixRTC et la session LiveKit.

Un bouton qui coupe le micro directement dans le casque, sans envoyer de
touche à Android, ne peut pas mettre à jour l'indicateur Sion. Certains
boutons HFP sont réservés à la téléphonie par le système ou le constructeur
et ne produisent pas de touche média pour Sion : leur prise en charge
utilise Telecom sur Android 14 et suivants. La compatibilité exacte
de ces boutons nécessite un essai avec le casque concerné.

La fermeture retire les écouteurs audio, la session média, les délais,
le profil Bluetooth historique, le focus et le mode de communication.
La voie Telecom ferme son unique contrôle d'appel et retire son compte.
Les tests couvrent notamment 32 cycles successifs, les confirmations
en retard, le retrait du casque, les refus et délais de bascule,
les interruptions et l'absence de double action des touches.
Les tests du mute couvrent aussi le premier appui après connexion, les
deux ordres possibles entre retrait et remise à zéro du mute système,
le push-to-talk pendant une synchronisation, les refus de transaction et
32 fermetures avec commandes d'ouverture encore différées.

Le 15 octobre, un Xiaomi 12 sous Android 16 avec OpenComm2 by Shokz_II
a confirmé le routage automatique Bluetooth, la sélection manuelle du
haut-parleur puis le retour Bluetooth, et une vidéo locale muette dont
le son décodé passe par le moteur natif sans suspendre le vocal. Les
journaux HFP confirment les commandes de mute système et de raccrochage.
La nouvelle intégration Telecom nécessite encore un essai physique des
boutons avec le nouvel APK.

Validation matérielle complémentaire : casque connecté avant le vocal,
connexion et déconnexion pendant une conversation, sortie choisie
manuellement, écran éteint, boutons mute/décrocher/raccrocher et appel GSM
interrompant le vocal. Les tests automatiques ne remplacent pas ces essais.

Références : [routage de communication Android](https://developer.android.com/develop/connectivity/bluetooth/ble-audio/audio-manager),
[boutons média](https://developer.android.com/media/legacy/media-buttons),
[appels transactionnels](https://developer.android.com/reference/android/telecom/TelecomManager#addCall(android.telecom.CallAttributes,java.util.concurrent.Executor,android.os.OutcomeReceiver,android.telecom.CallControlCallback,android.telecom.CallEventCallback)),
[priorité audio](https://developer.android.com/media/optimize/audio-focus).
