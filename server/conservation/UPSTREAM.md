# Préparation d’une contribution Continuwuity

Règles vérifiées sur la branche officielle `main` le 10 octobre 2026. Ce dossier est une préparation locale ; aucune issue ni PR n’a été publiée.

## Règles du projet

- [Guide de contribution](https://forgejo.ellis.link/continuwuation/continuwuity/src/branch/main/CONTRIBUTING.md)
- [Modèle de PR et politique sur l’assistance des LLM](https://forgejo.ellis.link/continuwuation/continuwuity/src/branch/main/.forgejo/pull_request_template.md)
- [Guide de style](https://forgejo.ellis.link/continuwuation/continuwuity/src/branch/main/docs/development/code_style.mdx)
- [Modèle de demande de fonctionnalité](https://forgejo.ellis.link/continuwuation/continuwuity/src/branch/main/.forgejo/issue_template/feature_request.yaml)

Le modèle de PR autorise les contributions assistées par des LLM. Le contributeur reste responsable du code et doit le comprendre, le revoir et le tester personnellement. La mention de l’IA ne remplace pas cette responsabilité.

Le modèle de demande de fonctionnalité indique que les descriptions d’issues générées, même partiellement, par une IA sont fermées sans examen. Cette demande doit donc être écrite directement par une personne. Il demande également un accord des mainteneurs avant l’ouverture d’une PR de fonctionnalité. Ne pas copier ce dossier ni un texte généré dans une telle issue. Les recommandations techniques ci-dessous sont destinées au travail local sur la contribution.

## Périmètre à convenir avec les mainteneurs

Le besoin général est une conservation configurable des conversations, sans effacer les médias toujours utilisés. La version locale utilise `com.sion.retention`, une route propre à Sion et des protections propres aux bibliothèques soundboard/memeboard. Elle effectue des redactions Matrix et ne constitue pas une implémentation de la purge de Synapse.

Avant de proposer son intégration, définir avec les mainteneurs :

1. La prise en charge de `m.room.retention` et de [MSC1763](https://github.com/matrix-org/matrix-spec-proposals/pull/1763), ainsi que le comportement de purge ou de redaction attendu.
2. Les permissions, les bornes imposées par l’administrateur du homeserver et les règles applicables aux espaces. L’héritage d’un espace est une fonctionnalité supplémentaire à discuter.
3. Un mécanisme général de protection des salons et médias. Les noms et comportements propres à Sion ne doivent pas imposer une dépendance à ce client.
4. Les garanties pour la fédération, les médias partagés, le chiffrement, les erreurs d’audit et les écritures concurrentes.
5. Le découpage souhaité : rétention des événements, collecte des médias, puis éventuel héritage des espaces et API d’aperçu.

## API et bot d’administration

Le prototype utilise déjà les mécanismes HTTP existants : enregistrement par `ruma_route`, requête et réponse Ruma, authentification `AccessToken`, identité extraite par `expect_sender_user`, erreurs Matrix et service interne pour la logique métier. Il ne crée pas un second serveur HTTP ni un bot externe.

Son contrat reste spécifique à Sion : une route unique avec des actions et des corps JSON génériques. Le contrat définitif, les types des réponses et la distinction entre administration de salon et administration de homeserver restent à adapter au périmètre accepté. L’API doit utiliser les contrôles d’autorisation correspondant à ce périmètre ; un administrateur d’espace n’est pas automatiquement administrateur du serveur.

Les documents consultés décrivent les crates `api`, `admin` et `service` séparément. Ils ne prescrivent pas une commande de bot pour chaque route HTTP. Le prototype ne fournit actuellement aucune commande de conservation au bot d’administration.

Si des commandes d’administration sont retenues, les intégrer au bot **existant** via les sous-commandes Clap et `admin_command_dispatch`, en respectant les sources d’invocation, les permissions d’administration et `Context::bail_restricted` pour les opérations sensibles. Les commandes et l’API devront appeler le même service, avec les mêmes protections et validations, sans dupliquer le moteur de nettoyage. Leur documentation se génère avec les outils du projet.

## Adaptations avant une PR

- Porter la contribution sur le dernier `main` officiel, dans une branche dédiée différente de `main`. Le prototype local cible uniquement 26.9.1, commit `046074bbc`.
- Généraliser les paramètres, événements et API suivant le périmètre accepté. Garder l’interface du client et l’installateur spécifique au serveur Sion dans le dépôt Sion.
- Suivre les conventions du code voisin et le guide de style : noms descriptifs, commentaires/documents en anglais, erreurs explicites, usages de `unwrap` justifiés ou supprimés, portée des verrous conforme aux abstractions du projet et ordre des acquisitions documenté.
- Intégrer les tests du planificateur au workspace officiel et ajouter les tests de protocole adaptés au mécanisme retenu.
- Utiliser le format de commits Conventional Commits, avec un historique lisible.
- Reprendre leur modèle de PR, cibler `main` sur leur Forgejo et conserver le statut draft pendant les travaux restants.
- Ajouter la documentation opérateur dans leur documentation et un fragment Towncrier nommé avec le numéro réel de PR et le type approprié, une fois ce numéro attribué.
- Revoir personnellement la contribution avant de cocher les attestations du modèle de PR. Une revue d’agent ne constitue pas une revue humaine.

## État des validations

Sur le prototype local et sa base de test éphémère :

- [x] Compilation release du serveur modifié pour Debian 13.
- [x] 20 tests Rust du planificateur et 6 tests Python des outils.
- [x] Authentification, droits Matrix v12, héritage et révision d’aperçu obligatoire.
- [x] Vérification que l’override CLI d’installation empêche le nettoyage réel.
- [x] Redaction des messages expirés et effacement physique du seul média sans référence après 48 heures.
- [x] Protection des épingles, avatars, médias réutilisés, bibliothèques et médias incertains en présence de chiffrement.
- [x] Audit des fichiers modifiés sans secret détecté.

Ces résultats concernent le prototype Sion. Ils ne valent pas validation d’une future branche adaptée à l’amont.

À effectuer sur cette future branche :

- [ ] Accord des mainteneurs sur le périmètre.
- [ ] Contrat d’API accepté et nécessité des commandes du bot clarifiée ; implémentation et tests de celles retenues.
- [ ] Revue humaine du code et de la description.
- [ ] `cargo +nightly fmt --check` avec leur configuration.
- [ ] `prek --all-files` ou leurs vérifications pre-commit équivalentes.
- [ ] `cargo test`.
- [ ] `cargo check --workspace --features full`.
- [ ] `cargo clippy --workspace --features full`.
- [ ] Tests Complement pertinents et examen des éventuelles régressions.
- [ ] Compilation de la documentation et fragment de changelog.
- [ ] Passage des workflows `Checks` de leur CI.

## Déclaration d’assistance par IA pour la PR

Le terme « vibecoding » décrit l’origine du travail mais ne précise pas le niveau de validation. La déclaration doit nommer l’outil, expliquer sa contribution et distinguer les tests automatisés de la revue humaine. Texte possible pour une **PR**, à actualiser selon les validations réellement effectuées :

> This implementation and parts of this pull request description were generated with assistance from OpenAI Codex. Automated checks were executed by the coding agent. Independent human review and upstream validation are still pending. The checks reported here describe the runs actually performed; they do not imply maintainer approval.

Lorsque la revue humaine aura réellement eu lieu, décrire son périmètre et les tests effectués personnellement. Ne pas déclarer cette revue ni cocher les attestations avant qu’elles soient réalisées.
