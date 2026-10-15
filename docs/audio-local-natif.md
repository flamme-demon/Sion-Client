# Lecture audio locale

Les sons de messages, l'alerte de parole micro coupé, les cues, la soundboard,
les préécoutes et les pièces jointes audio sont lus par Rust. Le contexte Web
Audio sert au décodage et à l'export des fichiers ; il n'est jamais relié à la
sortie audio pour ces lectures.

`nativeAudioPlayback.ts` transmet des tranches PCM mono ou stéréo à 48 kHz.
La file Rust contient au maximum deux secondes, quelle que soit la durée du
fichier. La position affichée vient des échantillons réellement consommés.
Les clips courts (au plus vingt secondes) sont transmis en une fois ; Rust
alimente ensuite seul leur file, même si les timers de la webview sont suspendus.
Un arrêt annule aussi un démarrage IPC encore en attente et ferme le lecteur
quand son identifiant arrive. Les retours de mute/sourdine remplacent le
précédent, y compris quand son décodage n'est pas terminé.

Les sons automatiques d'arrivée et de départ sont attachés au participant et
à la session vocale qui les ont demandés. Un départ, un retour ou un changement
de salon invalide les anciennes demandes. Une demande restée plus de deux
secondes en préparation est abandonnée ; ce délai ne raccourcit pas les sons
déjà démarrés. Le journal distingue la demande, la disponibilité native et la
confirmation de lecture avec la position consommée, afin qu'un son différé ne
soit plus confondu avec une nouvelle arrivée.

En appel avec un rendu WebRTC actif, `sion-native-audio::playback` mixe chaque
source avant l'analyse inverse AEC. Hors appel, seul dans un salon ou en
sourdine, une sortie native prend le relais : CPAL sur ordinateur, AudioTrack
sur Android. La sélection de route conserve le curseur, la pause et la file.
La politique de sourdine est explicite par source ; les retours d'action et
les préécoutes volontaires restent audibles.

Le registre de rendu conserve des liens faibles. Le propriétaire d'une
lecture possède sa file et le handle de son fil de sortie, qu'il arrête et
rejoint lors de sa destruction. Fermeture de la fenêtre et retrait de la tâche
Android arrêtent également les lectures. Les lectures abandonnées expirent
après trente secondes sans appel de contrôle.

Le lecteur vidéo conserve sa sortie native indépendante. Son processus ffmpeg
fournit directement le format du périphérique et sa position sert d'horloge
audio au lecteur. Il fonctionne sans appel et garde la stéréo, les lectures
longues, la pause et le déplacement. Le faire passer par la file de clips
soundboard (mono, vingt secondes) n'aurait pas respecté ces propriétés. Une
unification future devra brancher son décodage continu sur le registre de
sources, en conservant son horloge et la reprise lors des changements de route.
