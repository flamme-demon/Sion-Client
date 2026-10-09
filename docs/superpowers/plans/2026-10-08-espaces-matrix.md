# Espaces Matrix — réalisé le 8 octobre 2026

Objectif : remplacer le contexte serveur unique par des équipes Matrix fédérables, sans recréer les salons ni perdre les bibliothèques existantes.

- [x] Détecter les Espaces, leurs invitations, leurs enfants et leur bibliothèque dans les moteurs Rust et JS.
- [x] Créer/rejoindre avec alias, identifiants v12 et liens de partage contenant les serveurs `via`.
- [x] Ajouter les avatars d’Espaces et le bouton « + » au rail, conserver l’accueil des MP.
- [x] Filtrer les salons et la liste des membres par Espace ; mémoriser la sélection par compte.
- [x] Proposer les réglages, le partage, les invitations, les rôles et la création/association des salons.
- [x] Restreindre les salons communs à l’Espace ; préserver les invitations des salons privés.
- [x] Adapter la moulinette de validation des comptes à l’Espace sélectionné et à ses salons communs.
- [x] Créer une bibliothèque soundboard/memeboard par Espace ; transmettre son identifiant aux opérations natives.
- [x] Proposer la récupération des salons et de la bibliothèque lors de la création du premier Espace.
- [x] Écarter le repli LiveKit vers un autre salon et accepter l’adresse publique du SFU renvoyée avec le jeton.
- [x] Vérifier TypeScript, lint, tests ciblés, tests Rust, formulaire bureau/mobile et deux équipes sur un serveur Continuwuity jetable.
- [x] Compiler et relancer Sion dev avec la session habituelle.

La création d’un Espace et la migration de l’existant restent des actions du formulaire. Détails : [Espaces Matrix](../../espaces-matrix.md).
