# Diagnostic avancé

Dans **Paramètres → Avancé → Diagnostic avancé**, deux fonctions sont séparées.

## Journaux détaillés : une heure

Le réglage est coupé par défaut. Son activation ajoute les messages `Debug`
des modules de Sion et une mesure de mémoire résidente toutes les 30 secondes.
Les dépendances restent au niveau `Info` : on n'active pas leurs traces HTTP,
leurs corps de requête ou leurs détails cryptographiques.

L'arrêt est automatique après une heure et peut aussi être demandé immédiatement.
Un redémarrage conserve l'échéance initiale, sans redonner une heure entière.
Le réglage local est enregistré dans `diagnostic.json` du dossier de données
locales de l'application. Il ne fait pas partie du profil exportable.

Quand le mode est coupé, le niveau global revient à `Info`. Le travail de
mesure attend une nouvelle activation sans scruter la mémoire ni les fichiers.
Les journaux ordinaires et les erreurs restent disponibles.

## Rapports de plantage

### Windows

Le réglage **Conserver les rapports de plantage** configure Windows Error
Reporting pour `sion-client.exe` uniquement. Windows demande une confirmation
administrateur : Sion lance le même exécutable dans un mode auxiliaire limité
à cette configuration. Cet auxiliaire termine avant toute création de fenêtre
ou reprise de session. L'application principale conserve ses droits ordinaires.

WER écrit un dump complet uniquement au moment d'un plantage dans
`%LOCALAPPDATA%\com.sion.client\CrashDumps`, et en conserve au maximum deux.
Cette capture peut rester activée indépendamment des journaux détaillés ; elle
n'échantillonne pas la mémoire en fonctionnement normal. Elle permet notamment
de diagnostiquer une corruption de tas, où un gestionnaire de crash exécuté
dans le processus défaillant serait peu fiable.

La clé propre à Sion est
`HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\sion-client.exe`.
Les trois valeurs précédentes sont sauvegardées avant modification, puis
restaurées à la désactivation. Le petit kit `.reg` fourni avant la 2.0.2 est
reconnu et repris, pour que sa capture puisse aussi être arrêtée dans Sion.
Un refus de la confirmation Windows est signalé et ne coche pas le réglage.

La collecte reste soumise aux politiques Windows ; un débogueur automatique
déjà configuré peut empêcher WER de produire un dump.
[Documentation Microsoft](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps).

### Linux

Sion détecte les rapports conservés par `systemd-coredump`, accessibles à
l'utilisateur courant. Le réglage global du système n'est pas modifié.
L'interface indique si cette récupération est disponible.

La recherche s'effectue à l'ouverture des paramètres avancés, au retour dans
leur fenêtre et lors d'un export. Les retours rapides dans la fenêtre sont
regroupés pour éviter de lancer des recherches simultanées. Les requêtes sont limitées à `sion-client`,
à l'UID courant, aux quatorze derniers jours, et aux deux rapports les plus
récents encore accessibles. Les commandes ont un délai et des sorties bornés,
avec le même propriétaire de sous-processus que les imports média.

Les cores choisis sont extraits pendant l'export, dans un répertoire privé
temporaire, puis supprimés après création de l'archive ou en cas d'erreur.
En l'absence de systemd-coredump ou des droits nécessaires, les journaux et
l'export sans mémoire restent disponibles.
[Documentation systemd](https://www.freedesktop.org/software/systemd/man/latest/coredumpctl.html).

## Export et conservation

**Exporter un diagnostic…** ouvre le choix de destination d'un ZIP. L'archive
contient au maximum trois fichiers de journal, ainsi qu'un `diagnostic.json`
avec la version, la plateforme, l'architecture, le PID et l'état du diagnostic.
Les rapports mémoire sont ajoutés seulement si leur case est cochée.
L'application n'ajoute pas ses fichiers de session, bases Matrix ou profils.
Les journaux peuvent néanmoins contenir des identifiants et les dumps des
données de session ; l'interface demande de transmettre la mémoire en privé.
Aucun envoi automatique n'est réalisé par cette fonctionnalité.

La copie d'un journal s'arrête à sa taille relevée avant l'export, même s'il
continue à recevoir des messages. Le ZIP est écrit dans un fichier temporaire
voisin puis renommé une fois terminé. L'export et la compression sont exécutés
hors du fil de l'interface.

Les journaux tournent à 20 Mio par fichier. Le journal actif et jusqu'à trois
archives peuvent être conservés, soit environ 80 Mio au maximum.
Les erreurs du runtime ne sont plus envoyées vers la console de la webview :
un échec d'exécution JavaScript ne peut ainsi pas alimenter sa propre boucle
de journalisation. Les paniques Rust enregistrent aussi leur trace d'appels.

## Symboles de la version livrée

La CI conserve pendant 90 jours deux artefacts supplémentaires, séparés des
installateurs : `windows-symboles` (exécutable et PDB) et `linux-symboles`
(exécutable avec informations de débogage). Ils sont produits par le même
build que la version distribuée. Conserver ces artefacts avant leur expiration
si un diagnostic doit être poursuivi plus longtemps.

Le rapport Windows `c0000374` reçu le 21/10/2026 a confirmé une corruption
mémoire dans Sion 2.0.1, sans pile d'appels exploitable. L'ajout du diagnostic
ne constitue pas à lui seul une correction du déclencheur de ce plantage.
