# Cycle de vie des modèles locaux

Le TTS et le clonage vocal utilisent le même processus `audiocpp_cli`. Le résumé utilise `llama-completion` ou `llama-cli`. Les poids sont chargés dans ces processus, et ne sont pas conservés dans le processus principal de Sion après une génération. Les fichiers téléchargés restent sur disque pour les utilisations suivantes. Une voix enregistrée est un extrait audio de référence, pas un modèle chargé en permanence.

## Arrêt et concurrence

Les deux moteurs passent par `process_output` : stdin fermé, sorties drainées par des threads rejoints, processus et descendants possédés par Sion. L'arrêt normal, les erreurs, les dépassements de délai et la fermeture de Sion libèrent cette arborescence. Le mécanisme est un groupe de processus sous Unix et un Job Object sous Windows.

Un seul travail est autorisé par moteur, depuis la préparation jusqu'à la fin du nettoyage. Le TTS et le clonage partagent donc la même réservation. Le résumé réserve aussi son état avant la détection ou le téléchargement de ses dépendances : deux appels simultanés ne démarrent plus deux LLM. TTS et résumé peuvent toujours fonctionner simultanément ; cela représente deux charges mémoire légitimes.

Quitter le formulaire de génération ou fermer le panneau vocal annule sa requête TTS exacte. La fermeture ou le rechargement de la webview annule ses inférences actives. Un résultat arrivé après annulation est ignoré. Une annulation reçue avant la commande de démarrage empêche aussi le lancement.

Les plafonds existants sont conservés : 15 minutes et 1 Mio de stdout par tentative TTS, 20 minutes et 2 Mio par résumé. Seuls les derniers 4 Kio de stderr sont retenus ; les diagnostics mémoire GPU restent disponibles pour le repli CPU. Chaque tentative est entièrement arrêtée avant un éventuel nouvel essai. Les sondes des moteurs sont limitées à 10 secondes, les extractions à 120 secondes.

L'ancien minuteur pouvait se bloquer sur le mutex du processus pendant un `wait` qui gardait ce même mutex. Le nouvel arrêt repose sur une attente non bloquante ; un processus qui ferme ses tubes mais reste vivant est toujours interrompu au délai prévu.

## Vérification

Les tests lancent de vrais processus de substitution pour vérifier les arrêts répétés, les descendants, la fermeture des tubes avant la fin du processus, les plafonds de sortie et la réservation du moteur jusqu'à son nettoyage. Les tests frontend couvrent l'annulation exacte, les résultats tardifs, la fermeture de la webview, les doubles résumés et les erreurs suivies d'une relance.

La compilation des modules de possession et de réservation est vérifiée pour Windows. Leur exécution Windows, les pilotes GPU et une génération TTS complète nécessitent encore une validation sur une machine équipée des modèles.
