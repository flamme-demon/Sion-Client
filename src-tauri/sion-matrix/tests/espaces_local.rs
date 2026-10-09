//! Test d'intégration contre le banc Continuwuity jetable, jamais la production.
use std::{sync::Arc, time::Duration};
use sion_matrix::{CoeurMatrix, CoffreMemoire};
use serde_json::json;

async fn attendre(coeur: &CoeurMatrix, id: &str, invitation: bool) {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if coeur.salons_actuels().iter().any(|s| s.id == id && s.is_space && (s.membership == "invite") == invitation) { break; }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }).await.expect("Espace synchronisé");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "nécessite SION_BANC_SERVEUR et SION_BANC_JETON sur un serveur jetable"]
async fn espaces_isoles_et_invitation_explicite() {
    let serveur = std::env::var("SION_BANC_SERVEUR").expect("serveur du banc");
    assert!(serveur.contains("127.0.0.1") || serveur.contains("localhost"), "ce test doit rester local");
    let jeton = std::env::var("SION_BANC_JETON").expect("jeton du banc");
    let a = tempfile::tempdir().unwrap(); let b = tempfile::tempdir().unwrap();
    let alice = CoeurMatrix::nouveau(a.path().into(), "Test espaces Alice", Arc::new(CoffreMemoire::default()));
    let bob = CoeurMatrix::nouveau(b.path().into(), "Test espaces Bob", Arc::new(CoffreMemoire::default()));
    let nonce = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    let mdp = format!("mdp-banc-{nonce}");
    alice.inscrire(&serveur, &format!("espacesalice{nonce}"), &mdp, Some(&jeton), None).await.unwrap();
    bob.inscrire(&serveur, &format!("espacesbob{nonce}"), &mdp, Some(&jeton), None).await.unwrap();
    let id_bob = bob.client().await.unwrap().user_id().unwrap().to_string();
    let ea = alice.creer_espace("Equipe A", "", false).await.unwrap();
    let eb = alice.creer_espace("Equipe B", "", false).await.unwrap();
    attendre(&alice, &ea, false).await; attendre(&alice, &eb, false).await;
    let ba = alice.creer_salon_dans("Bibliothèque A", false, true, false, Some(&ea), true).await.unwrap();
    let bb = alice.creer_salon_dans("Bibliothèque B", false, true, false, Some(&eb), true).await.unwrap();
    for (e, board) in [(&ea, &ba), (&eb, &bb)] {
        alice.envoyer_etat(e, "m.space.child", board, json!({"via":["sion.test"],"suggested":true})).await.unwrap();
        alice.envoyer_etat(e, "com.sion.space", "", json!({"board_room_id":board})).await.unwrap();
    }
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if alice.salons_actuels().iter().any(|s| s.id == ea && s.board_room_id.as_deref() == Some(ba.as_str())) { break; }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }).await.unwrap();
    alice.envoyer_meme_dans(Some(&ba), vec![1,2,3], "video/mp4", 16, 16, 100, None, "Meme A", None, Some("A")).await.unwrap();
    alice.envoyer_meme_dans(Some(&bb), vec![4,5,6], "video/mp4", 16, 16, 100, None, "Meme B", None, Some("B")).await.unwrap();
    assert_eq!(alice.memes_dans(Some(&ba)).await.unwrap().iter().map(|m| m.label.as_str()).collect::<Vec<_>>(), vec!["Meme A"]);
    assert_eq!(alice.memes_dans(Some(&bb)).await.unwrap().iter().map(|m| m.label.as_str()).collect::<Vec<_>>(), vec!["Meme B"]);
    alice.inviter(&ea, &id_bob).await.unwrap();
    attendre(&bob, &ea, true).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(bob.salons_actuels().iter().any(|s| s.id == ea && s.membership == "invite"));
    assert!(bob.rejoindre_avec_via(&bb, vec!["sion.test".into()]).await.is_err(), "une bibliothèque d'une autre équipe reste fermée");
    bob.rejoindre_espace(&ea, vec!["sion.test".into()]).await.unwrap(); attendre(&bob, &ea, false).await;
    bob.rejoindre_avec_via(&ba, vec!["sion.test".into()]).await.unwrap();
    assert!(bob.rejoindre_avec_via(&bb, vec!["sion.test".into()]).await.is_err());
    let hierarchy = alice.hierarchie_espace(&ea, None).await.unwrap();
    assert!(hierarchy["rooms"].as_array().unwrap().iter().any(|r| r["room_id"] == ba));
    assert!(!hierarchy["rooms"].as_array().unwrap().iter().any(|r| r["room_id"] == bb));
    alice.deconnecter().await.unwrap(); bob.deconnecter().await.unwrap();
}
