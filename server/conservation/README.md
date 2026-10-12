# Conservation des conversations Sion

L’onglet **Conservation** se trouve dans **Gérer l’espace**. Le clic droit sur un salon ouvre aussi ses réglages. Les durées proposées sont illimitée, 30, 90, 365 jours ou une durée personnalisée. Un salon avec un seul espace parent canonique peut hériter de cet espace, si les liens Matrix sont réciproques. Les salons avec plusieurs parents restent illimités tant qu’ils n’ont pas leur propre règle.

Les réglages sont des événements d’état `com.sion.retention`, contenant `{"policy":{"mode":"days","days":90}}`, `{"policy":{"mode":"unlimited"}}` ou `{"policy":{"mode":"inherit","parent":"!espace:serveur"}}`. Sans règle, la conservation est illimitée, sauf héritage d’un espace configuré. Une bibliothèque soundboard/memeboard reste protégée, même si un événement de règle a été envoyé depuis un autre client.

Cette extension utilise des règles Sion ; elle n’implémente pas la purge `m.room.retention` de Synapse et ne configure pas un serveur Synapse. Les événements d’état restent des événements Matrix compatibles avec les anciens clients, qui peuvent les ignorer. Pour une future prise en charge de Synapse, il faudra un adaptateur distinct.

## Partie serveur

L’extension est intégrée aux sources **Continuwuity 26.9.1, commit 046074bbc**. Ce n’est pas une option de rétention fournie par la version standard. Elle ajoute une route authentifiée `POST /_continuwuity/sion/conservation/v1` et un service interne. Le client Rust utilise son relais HTTP existant : aucun jeton Matrix natif n’est transmis au JavaScript. Aucun compte bot privilégié ni secret supplémentaire n’est nécessaire.

Cette implémentation a été développée avec l’assistance d’OpenAI Codex. Les règles et les étapes pour proposer une contribution au projet officiel, avec une déclaration explicite de cette assistance, sont consignées dans [UPSTREAM.md](UPSTREAM.md). La version locale doit encore être adaptée et revue humainement avant une telle contribution.

Les actions `read`, `preview` et `save` utilisent le `scopeId` d’un salon ou d’un espace. Les membres peuvent consulter les règles. Leur modification exige des droits administrateur sur chaque salon modifié. L’aperçu fournit une révision liée au compte, au périmètre, aux modifications et aux droits/états actuels ; elle expire après cinq minutes et n’est utilisable qu’une fois. L’enregistrement exige cet aperçu. Les compteurs restent une estimation : de nouveaux messages peuvent arriver après son calcul.

Deux paramètres, désactivés par défaut :

```toml
[global]
sion_conservation_enabled = false
sion_conservation_apply = false
```

Avec `enabled=true` et `apply=false`, les règles peuvent être enregistrées et leur effet calculé. **Aucun message ni média n’est supprimé.** Le service effectue un audit au démarrage puis chaque heure. Sans extension, Sion affiche son indisponibilité et désactive les modifications.

Avec `apply=true`, le service émet des redactions Matrix avec les permissions actuelles de l’auteur local de la règle. Il vérifie à nouveau la règle, les épingles et les droits avant chaque événement. Un auteur parti, désactivé, suspendu, verrouillé ou ayant perdu ses droits cesse de faire appliquer sa règle. Les droits de redaction du salon cible restent nécessaires, même pour une règle héritée de l’espace.

Une redaction retire le contenu du message ; elle conserve l’identifiant et les métadonnées nécessaires au graphe Matrix. Elle n’efface pas une copie déjà téléchargée ou conservée sur un autre serveur fédéré. Les anciens clients continuent d’utiliser les salons et reçoivent ces redactions lorsqu’un nettoyage est activé.

## Protection des médias

L’audit examine les messages de tous les salons connus du homeserver, leurs états et événements historiques, les outliers, les profils locaux et les données de compte. Les bibliothèques sont reconnues par `com.sion.board`, `com.sion.space.board_room_id`, l’alias local `#soundboard` et les événements des cartes. Leur protection est mémorisée pour éviter qu’un renommage ne les expose au nettoyage.

Sont conservés les messages épinglés, les cartes soundboard/memeboard, les événements d’état, les avatars/logos et les fichiers encore référencés. Les médias hébergés ailleurs ne sont jamais supprimés. Si le homeserver possède du contenu chiffré, l’audit ne peut pas prouver l’absence de références dans ce contenu : **les médias restent conservés**. Un fichier classé incertain ou encore utilisé n’entre pas dans la file de suppression.

Seuls des médias locaux provenant de messages expirés et classés supprimables entrent dans cette file. Leur suppression physique exige un délai de grâce de 48 heures, un nouvel audit complet, et l’absence d’écriture de référence entre cet audit et la suppression. Les écritures de timeline, backfill, outliers, profils et données de compte participent à cette vérification. Le service ne lance pas de purge générale du répertoire média.

Chaque passage est limité à 500 redactions et 10 médias. Un audit au-delà de 200 000 éléments ou une erreur de lecture abandonne le passage. La file contient au maximum 5 000 médias ; à saturation, les nouveaux fichiers sont conservés. Ces limites privilégient la conservation face à une référence incertaine ou un audit incomplet.

## Compiler pour Debian 13

Python 3.12+, Docker et une connexion aux sources officielles sont nécessaires. Le script refuse une archive différente de celle vérifiée et refuse de patcher des fichiers déjà modifiés. La compilation se fait dans une image Rust pour Debian 13, avec deux tâches Cargo, sans toucher au serveur actif.

```bash
python3 server/conservation/build.py --output /tmp/sion-conservation-build
```

Un dossier de sortie existant est refusé. `--archive /chemin/source.tar.gz` permet d’utiliser l’archive officielle déjà téléchargée ; `--prepare-only` prépare les sources sans Docker. Le résultat est `artifact/conduwuit` avec `artifact/SHA256SUMS`.

Le binaire n’est exporté qu’après un test complet dans un homeserver local éphémère : authentification, droits, héritage avec les identifiants Matrix v12, aperçu imposé par la CLI, redactions, délai de 48 heures et effacement physique du seul fichier expiré sans référence. Les avatars, fichiers réutilisés, épingles et bibliothèques doivent survivre ; le chiffrement empêche la suppression de médias. `test_clock.c` avance uniquement l’horloge murale de ce processus de test ; cette bibliothèque n’est pas incluse dans le paquet livré.

## Installer uniquement le mode aperçu

L’installateur vise l’unité Debian `conduwuit.service`, dont l’ExecStart vérifié est `/usr/bin/conduwuit --config ${CREDENTIALS_DIRECTORY}/conduwuit.toml`. Il refuse une autre version installée ou une configuration inattendue. Le serveur doit déjà être dans la version 26.9.1 (046074bbc).

Après avoir copié le binaire, son empreinte et `install-preview.py` sur le serveur :

```bash
python3 install-preview.py --binary ./artifact/conduwuit
sudo python3 install-preview.py --binary ./artifact/conduwuit --apply
```

La première commande vérifie uniquement. La seconde nécessite root et redémarre Matrix. Elle conserve `/usr/bin/conduwuit` et les credentials existants, place le nouveau binaire dans `/opt/sion-conservation/<empreinte>/conduwuit` et ajoute `/etc/systemd/system/conduwuit.service.d/90-sion-conservation.conf`. L’override impose `enabled=true`, **`apply=false`**, via les options CLI, même si le TOML ou l’environnement indique autre chose.

Le contrôle HTTP utilise `http://127.0.0.1:6167/_matrix/client/versions` ; `--health-url` l’adapte pour un autre port. L’override précédent est sauvegardé sous `/var/backups/sion-conservation-*` et restauré automatiquement si le démarrage ou le contrôle HTTP échoue. Ce dossier ne contient aucun credential.

Pour revenir au binaire Debian si aucun override n’existait avant l’installation :

```bash
sudo mv /etc/systemd/system/conduwuit.service.d/90-sion-conservation.conf /var/backups/90-sion-conservation.disabled
sudo systemctl daemon-reload
sudo systemctl restart conduwuit
```

S’il existait un override, restaurer celui de la sauvegarde à la place. Désinstaller cette extension n’efface ni les règles enregistrées ni la base de données. L’activation du nettoyage réel est une étape distincte, après validation du mode aperçu et des durées ; cet installateur ne l’active pas.

Une mise à jour officielle de Continuwuity nécessite de porter et revalider l’extension sur les nouvelles sources avant de réinstaller un binaire modifié. Les empreintes et la version imposées par ces outils empêchent leur utilisation silencieuse avec une autre version.

## Validation

```bash
python3 -m unittest discover -s server/conservation -p test_tools.py
cargo test --manifest-path server/conservation/planner-check/Cargo.toml --lib
npx vitest run src/services/conservationService.test.ts src/components/sidebar/ConservationPanel.test.tsx
```

Dans les sources préparées, la compilation de l’ensemble du serveur et de ses routes peut être vérifiée avec `cargo check -p conduwuit --no-default-features --features ring,bindgen-runtime,url_preview,media_thumbnail,systemd`. Le paquet Debian utilise les fonctionnalités standard en release. Les tests du planificateur utilisent uniquement des identifiants fictifs ; aucun test ne supprime de données en production.
