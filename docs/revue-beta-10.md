# Vérifications avant la bêta 10

Vérifications effectuées les 11 et 12 octobre 2026 sur la branche
`feat/interface-bulles`, à partir de la bêta 9.

- Construction de production : TypeScript et Vite passent.
- Vitest : 824 tests passent, 5 sont ignorés.
- ESLint : aucune erreur ; 33 avertissements, principalement sur les hooks.
- Rust, application : 188 tests unitaires et le test d'intégration Opus passent ;
  5 tests sont ignorés par défaut.
- Rust, moteur Matrix : 153 tests passent. Le test HTTP d'annuaire utilise un
  serveur local et doit être exécuté avec les permissions réseau appropriées.
- Rust, effets webcam : 12 tests passent.
- Extension de conservation : 6 tests Python et 20 tests Rust du planificateur
  passent. Cela ne remplace pas les tests d'intégration du serveur modifié.
- Gitleaks : aucune détection dans les fichiers texte de la livraison vérifiés.
  Une recherche complémentaire de clés privées, jetons, adresses de réseau privé
  et chemins de comptes locaux n'a produit aucune détection.
- Les empreintes des deux modèles ONNX correspondent aux attributions fournies.
  Leurs licences sont distribuées avec les ressources, y compris dans l'AppImage.

Les notes de version décrivent la nécessité d'une extension Continuwuity
compatible pour appliquer la conservation. La publication du client ne déploie
aucun correctif sur le serveur.

Les modifications locales indépendantes de `MarkdownRenderer` et d'`UpdateBanner`
dans le checkout principal sont conservées hors de cette livraison, comme pour
la bêta 9.

Les tests de durée prolongée en appel et la mesure de mémoire sur les appareils
des utilisateurs restent utiles ; ces contrôles ne garantissent pas l'absence
de défaut dans toutes les configurations.
