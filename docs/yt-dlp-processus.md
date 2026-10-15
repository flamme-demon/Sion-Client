# Analyses yt-dlp et processus

La bêta 9 possédait déjà l'annulation d'un téléchargement vidéo, introduite le 2 octobre. Elle ne couvrait pas l'analyse du lien, qui attendait sans limite de temps avec `Command::output()`. Fermer la fenêtre pendant « Analyser » ne l'annulait pas. Les vérifications `--version` avaient également une attente sans limite et étaient lancées deux fois depuis l'onglet Avancé. La 2.0.0 finale conserve ces chemins.

Les corrections en préparation ajoutent :

- une seule analyse de lien à la fois, avec remplacement et arrêt de l'ancienne demande ; les demandes remplacées avant leur démarrage ne lancent rien ;
- une annulation par identifiant quand la fenêtre ferme, le composant disparaît ou l'URL change, avec protection contre les résultats tardifs ;
- une limite de 60 secondes pour l'analyse, et de 10 secondes pour les contrôles de version ;
- un contrôle de version partagé entre détection et affichage, mis en cache brièvement et respectant le chemin personnalisé ;
- la propriété des processus fils, un arrêt global à la fermeture de Sion et une sortie de téléchargement audio bornée à 30 minutes ;
- un verrou empêchant deux imports vidéo de se disputer le processus d'annulation.

Sur Windows, le processus démarre suspendu et entre dans un Job Object avant d'être repris. Ses descendants héritent du job, qui les termine lors de sa fermeture, selon le [fonctionnement documenté par Microsoft](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). Cela couvre le processus supplémentaire des exécutables PyInstaller et ffmpeg. Sur Unix, l'arbre dispose de son propre groupe de processus. Les lecteurs stdout/stderr sont bornés en mémoire et rejoints ; le délai englobe aussi les tubes conservés par un descendant après la fin du parent.

Le registre conserve seulement des identifiants et des références de handles, sans posséder les processus. Leur propriétaire retire l'entrée avant de fermer le handle du job. L'arrêt de l'application ferme les arbres encore enregistrés et attend que leurs propriétaires se libèrent.

Les tests lancent de vrais sous-processus : sortie normale, timeout, annulation répétée d'un parent avec son descendant, fermeture globale, vingt relances successives et partage de huit contrôles de version concurrents. Le module Windows est également vérifié avec ses tests en compilation croisée ; son exécution sous Windows reste à valider sur une machine Windows.
