# Revue de la bêta 9 — 9 octobre 2026

Portée : branche `feat/interface-bulles`, interface, Espaces Matrix, chargement
des bibliothèques, abonnements et ressources de la voix native. Les modifications
locales indépendantes de `MarkdownRenderer` et `UpdateBanner` dans le checkout
principal ne font pas partie de cette livraison.

## Constats corrigés

- **Cache audio : blob orphelin lors de demandes concurrentes.** Deux lectures
  du même média pouvaient créer deux URL, dont une disparaissait de la Map sans
  être révoquée. Une promesse est maintenant partagée par média ; une substitution
  libère aussi l’ancienne URL. Le cache reste limité à 24 sons.
- **Fonds : anciens blobs conservés après remplacement.** Les URL des chemins
  qui ne figurent plus dans les fonds actifs sont révoquées. Un fichier partagé
  par plusieurs modules n’est libéré qu’après son retrait du dernier. Une lecture
  tardive d’un fond retiré ne crée plus de blob. L’abonnement est nettoyé au HMR.
- **Caches Matrix : détails et versions de salons sans plafond.** Ces deux
  caches sont limités à 128 entrées chacun. Un changement de génération invalide
  les demandes en cours à la déconnexion : une réponse tardive ne repeuple plus
  le cache du compte suivant et ne bloque pas sa propre demande.
- **Voix : heartbeat réinstallé après une fermeture pendant la connexion.**
  Le chemin après connexion vérifie la fermeture de la session avant de restaurer
  son état, son overlay ou ses minuteurs. Les identités connues suivent la liste
  actuelle des participants et ne conservent plus tous les anciens arrivants.
- **Bibliothèques : rafraîchissements concurrents et nettoyage incomplet.**
  Les demandes périodiques ou issues des événements sont regroupées derrière une
  seule lecture. La fermeture annule les relances, y compris sans client JS.
- **Compte : jointures automatiques tardives.** La jointure des salons communs
  cesse si le compte change. Une réponse de l’ancien compte ne modifie pas la liste
  locale des départs volontaires du nouveau.
- **Création de bibliothèque : erreurs d’invitation masquées.** Les invitations
  échouées sont renvoyées et présentées aussi lors de la première création.
- **Test audio instable.** Le test du profil déclenchait les vraies commandes
  natives asynchrones de sourdine, qui pouvaient finir pendant le test suivant.
  Les commandes natives et les sons sont désormais simulés dans ce test d’interface.

## Vérifications

- JavaScript : **601 tests réussis**, 5 tests d’intégration désactivés.
- TypeScript et compilation Vite : réussis ; avertissement de taille de chunk
  déjà présent sur les dépendances lourdes.
- ESLint : **0 erreur**, 34 avertissements ; aucun blocage du contrôle CI.
- Application Rust : **172 tests réussis**, 5 désactivés (conditions natives).
- Cœur Matrix Rust : **147 tests réussis** ; les tests contre serveur jetable
  restent désactivés sans leur configuration dédiée.
- Fenêtres serveur et Espace : composants réels avec services fictifs, Chromium
  isolé ; vues ordinateur et téléphone, recherche, portails et droits de bibliothèque.
- Mémoire des portails : 20 cycles d’échauffement, puis 200 ouvertures et fermetures
  du catalogue serveur avec collecte explicite. Avant / après : **1 document,
  60 nœuds, 296 écouteurs**, sans augmentation. Le tas JS mesuré passe de
  9 945 320 à 10 370 824 octets (+425 504 octets). Ce test vérifie le nettoyage
  des fenêtres, pas la stabilité d’un appel natif de plusieurs jours.
- L’app dev ouverte pendant la revue conserve 908 messages dans 9 salons et
  8 blobs annoncés par le diagnostic. Le RSS WebKit augmente d’environ 1,17 à
  1,33 Gio pendant les changements et HMR ; ces deux relevés ne suffisent pas
  à attribuer cette hausse à une fuite. Les compteurs JS seuls ne mesurent ni
  les textures du GPU, ni les buffers de codecs, ni les allocations internes WebKit.

## Limites du contrôle

Les appels et partages d’écran de l’utilisateur n’ont pas été interrompus pour
forcer des reconnexions. La compilation locale de tests ne comporte pas les
codecs CUDA de la release : leur présence reste contrôlée par le workflow Linux
et Windows avant publication. Le suivi prolongé de la voix, des partages et des
allocations natives reste nécessaire ; la revue ne conclut pas à zéro fuite.
