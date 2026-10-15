# Transcription locale

En vocal, chaque participant transcrit son propre micro. Le moteur utilise le tap post AEC/NS/AGC de la capture Rust existante : aucune seconde capture, aucun PCM vocal dans le WebView. Le tap transmet des trames mono 16 kHz au VAD puis au worker Whisper/Parakeet. Seul le texte produit est publié dans Matrix pour la transcription.

La capture ne bloque pas sur l'ASR : le canal contient au maximum 64 trames de 10 ms. Les segments durent au maximum 12 secondes et la file ASR contient six segments. Une machine en retard perd un segment plutôt que d'accumuler une file sans limite. Les files de sortie WebSocket sont également bornées. La fermeture normale d'une phrase attend 700 ms de silence puis l'inférence : la transcription n'est pas instantanée.

Le mute et la sourdine coupent le tap immédiatement. Le PTT applique sa porte avant le tap. Un désarmement, une sortie du salon, une fin de réunion ou une fermeture du WebSocket invalident aussi un démarrage encore en attente. Les messages tardifs d'une ancienne session sont ignorés.

Le vocal et les fichiers de référence TTS réservent le même moteur avant leur première préparation asynchrone. Le décodage d'un fichier utilise OfflineAudioContext à 16 kHz, sans ouvrir de périphérique audio. Les arrêts natifs sont ordonnés avant le démarrage suivant et libèrent le modèle même après une erreur. Rust annule et joint le worker ASR et celui d'ingestion avant de charger un autre modèle ; ces opérations attendent sur des threads de travail, hors du thread de l'interface. Le chargement d'un modèle déjà commencé peut devoir finir avant sa libération.

Le petit serveur WebSocket local reste ouvert pendant la vie du processus. Les connexions et leurs files sont retirées à l'arrêt du moteur. Un client connecté après le chargement reçoit quand même l'état `ready`. Le lecteur de sortie du vocal ne crée pas son propre VAD ; l'entrée PCM du WebSocket est réservée au mode fichier.
