# Mises à jour de Sion

Les paramètres avancés proposent un interrupteur « Recevoir les mises à jour expérimentales
(alpha et bêta) », désactivé par défaut. Cette option inclut aussi les versions
candidates. Désactiver l'option ne rétrograde jamais Sion. Les releases sont
triées par SemVer, indépendamment de leur date de publication, et doivent
contenir un paquet compatible avec l'appareil. Un APK absent n'empêche pas
les mises à jour du bureau.

Le bandeau propose Télécharger → progression → Installer et relancer (bureau)
ou Installer (Android). Le téléchargement ne ferme pas Sion. L'installation
reste une action explicite et est bloquée pendant un appel. « Plus tard »
masque le bandeau ; « Vérifier les mises à jour » le réaffiche dans les
paramètres avancés. Les notes sont consultables dans Sion. Les anciennes
releases sans manifeste signé restent en téléchargement manuel.

## Windows et Linux

Le plugin Tauri Updater vérifie la signature du paquet téléchargé. Le paquet
est ensuite conservé dans le cache de Sion ; une empreinte est revérifiée avant
l'installation pour détecter une modification du fichier après téléchargement.

Windows utilise NSIS en mode passive : progression sans les pages de
l'assistant, puis relancement par l'installeur. Une installation pour tous les
utilisateurs peut encore demander l'UAC. Les paramètres NSIS existants
(`installMode: both`) sont conservés pour les nouvelles installations.

Linux remplace l'AppImage au même emplacement, conserve ses droits
et relance Sion. Le dossier doit être accessible en écriture. Une copie
`<nom>.AppImage.previous` conserve la version précédente pour une récupération
manuelle. Un lancement depuis le binaire de développement ou un dossier protégé
propose le téléchargement manuel en cas d'échec. La mise à jour télécharge
l'AppImage entière.

Le paquet prêt à installer est actuellement repris pendant la session Sion.
Après fermeture complète de Sion, il faut relancer le téléchargement ; les
paquets du cache sont remplacés au téléchargement suivant.

## Android hors store

Le téléchargement natif enregistre un APK arm64 dans le cache privé de Sion.
Le pont Kotlin vérifie l'identifiant, la version annoncée, le versionCode
supérieur et le certificat correspondant à l'application installée. Android
vérifie ensuite l'APK lors de l'installation. Les versions de développement
(`com.sion.client.dev`) ne peuvent pas être remplacées par un APK de publication.

La première installation depuis Sion ouvre si nécessaire les paramètres
« Installer des applications inconnues ». Au retour, le parcours reprend si
l'autorisation est accordée. Un refus laisse la mise à jour prête à réessayer.
`PackageInstaller` gère l'installation. Sur Android 12+, Sion demande une
mise à jour de lui-même sans confirmation supplémentaire, avec la permission
`UPDATE_PACKAGES_WITHOUT_USER_ACTION`. Si Android exige une confirmation,
l'installateur système est ouvert. Si Sion est passé en arrière-plan, cette
confirmation attend le prochain clic Installer dans Sion. Une annulation
permet de réessayer. Le relancement automatique Android n'est pas forcé :
il dépend du système, contrairement au parcours du bureau.

## Signature et publication

La clé publique est intégrée dans `src-tauri/tauri.conf.json`. La clé privée
locale est `.update-signing/sion.key`, ignorée par Git, avec un dossier 0700
et un fichier 0600. Elle doit être sauvegardée dans un emplacement sûr : les
futures releases destinées à ces clients devront être signées avec cette clé.
La clé de signature Android existante reste distincte.

Le workflow `.github/workflows/release.yml` utilise le secret GitHub
`TAURI_SIGNING_PRIVATE_KEY` et, si nécessaire,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. La clé générée pour cette intégration
n'a pas de mot de passe. Ne pas afficher sa valeur dans les logs.

Les builds signent **le fichier final distribué** via
`build-scripts/sign-update.sh`. C'est indispensable pour l'AppImage custom qui
embarque ffmpeg et les bibliothèques natives. Le script accepte la clé par
variable d'environnement, par `TAURI_SIGNING_PRIVATE_KEY_PATH` ou depuis
`.update-signing/sion.key` en local. Le build PowerShell signe aussi son
installeur si la clé est disponible.

`build-scripts/create-updater-manifest.py` produit `updater.json` par release,
avec les URLs exactes et signatures Windows/Linux. La CI exige les deux
paquets signés, puis publie fichiers, `.sig` et manifeste ensemble. Le script
local de release applique aussi le marquage prerelease aux tags alpha/bêta/rc.
La sélection du canal consulte la liste des releases GitHub : elle ne dépend
pas de `/releases/latest`, qui exclut les prereleases.

Une première version intégrant ce mécanisme doit être installée manuellement.
Aucune release existante n'est modifiée par l'intégration.

## Vérifications

- Vitest : comparaison SemVer, sélection des canaux et plateformes, échecs
  d'APK, cache, téléchargement puis installation séparée, protection des appels,
  changement de canal et reprise après erreur.
- Tests Rust : rejets des rétrogradations, tags invalides et artefacts externes.
- Tests Python : choix du fichier exact, encodage des URLs, signatures absentes
  et plateformes manquantes.
- Compilation web, `cargo check` Linux et Android arm64, compilation Kotlin
  arm64 sans reconstruire les bibliothèques natives.
- Test de signature sur un fichier temporaire : signature acceptée par la clé
  publique intégrée, rejet après modification du fichier.

L'installation réelle Windows, le remplacement d'une AppImage en cours
d'utilisation et la mise à jour d'un APK signé sur appareil doivent être
validés avec deux versions empaquetées successives avant diffusion générale.

## Sauvegarder ou transférer la clé privée

Le secret `TAURI_SIGNING_PRIVATE_KEY` est déjà configuré dans le dépôt GitHub
`flamme-demon/Sion-Client`. Aucun paramétrage supplémentaire n'est nécessaire
pour les builds GitHub. GitHub ne permet pas de relire la valeur d'un secret :
la copie locale doit donc être conservée.

La clé privée est ici :
`/home/flamme/dev/Sion_Client/.update-signing/sion.key`.
Copier ce fichier dans une sauvegarde chiffrée ou un gestionnaire de mots de
passe capable de stocker un fichier. Ne pas l'ajouter au dépôt, même privé :
une fuite permettrait de signer des mises à jour acceptées par les clients.

Pour la réinstaller sur une autre machine Linux, depuis la racine du projet :

```bash
mkdir -p .update-signing
chmod 700 .update-signing
install -m 600 /chemin/de/la/sauvegarde/sion.key .update-signing/sion.key
```

Pour un build Windows local, copier la même clé dans `.update-signing/sion.key`
ou définir son emplacement dans PowerShell :

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "C:\chemin\sion.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
./build-scripts/build-windows.ps1
```

Ne pas générer une nouvelle clé pour chaque machine : garder la même clé
correspondant à la clé publique intégrée à Sion.

## Frontend rechargé avec un ancien binaire natif

`Command update_platform not found` indique que le frontend récent tourne
avec un exécutable natif qui ne contient pas les nouvelles commandes.
Vite recharge TypeScript/React sans reconstruire Rust. `cargo check` et les
tests Rust ne reconstruisent pas l'exécutable lancé par l'utilisateur.

Sur Linux en développement, reconstruire le binaire puis fermer complètement
Sion et le relancer :

```bash
cd src-tauri
cargo build --locked --bin sion-client
cd ..
./build-scripts/run-native.sh
```

Sur Android, il faut reconstruire et réinstaller l'APK ; recharger la page du
WebView ne met pas à jour le moteur natif.
