//! Espaces Matrix : regroupement des salons existants, sans les recréer.
use matrix_sdk::ruma::api::client::room::create_room::v3::{Request as CreerSalon, RoomPreset};
use matrix_sdk::ruma::events::StateEventType;
use matrix_sdk::ruma::{OwnedRoomOrAliasId, OwnedServerName, serde::Raw};
use serde_json::json;

use crate::coeur::CoeurMatrix;
use crate::gestion::http;
use crate::fonctions_sion::segment_encode;
use crate::{Erreur, Resultat};

fn brut<T>(v: serde_json::Value) -> Resultat<Raw<T>> { Ok(Raw::from_json_string(v.to_string())?) }

impl CoeurMatrix {
    pub async fn rejoindre_avec_via(&self, adresse: &str, via: Vec<String>) -> Resultat<String> {
        let client = self.client().await.ok_or(Erreur::PasDeSession)?;
        let reference: OwnedRoomOrAliasId = adresse.try_into().map_err(|e: matrix_sdk::ruma::IdParseError| Erreur::Autre(e.to_string()))?;
        let via: Vec<OwnedServerName> = via.into_iter().map(|s| s.try_into().map_err(|e: matrix_sdk::ruma::IdParseError| Erreur::Autre(e.to_string()))).collect::<Resultat<_>>()?;
        let salon = Box::pin(client.join_room_by_id_or_alias(&reference, &via)).await?;
        Ok(salon.room_id().to_string())
    }

    pub async fn hierarchie_espace(&self, espace: &str, suivant: Option<&str>) -> Resultat<serde_json::Value> {
        matrix_sdk::ruma::RoomId::parse(espace).map_err(|e| Erreur::Autre(e.to_string()))?;
        let client = self.client().await.ok_or(Erreur::PasDeSession)?;
        let base = client.homeserver().to_string();
        let mut chemin = format!("{}/_matrix/client/v1/rooms/{}/hierarchy?max_depth=1&limit=100", base.trim_end_matches('/'), segment_encode(espace));
        if let Some(s) = suivant { chemin.push_str(&format!("&from={}", segment_encode(s))); }
        let reponse = http("GET", &chemin, client.access_token().as_deref(), None).await?;
        if !(200..300).contains(&reponse.status) { return Err(Erreur::Autre(format!("Impossible de lire les salons de l'Espace (HTTP {})", reponse.status))); }
        Ok(reponse.corps)
    }
    pub async fn creer_espace(&self, nom: &str, sujet: &str, publique: bool) -> Resultat<String> {
        let client = self.client().await.ok_or(Erreur::PasDeSession)?;
        let moi = client.user_id().ok_or(Erreur::PasDeSession)?.to_string();
        let mut requete = CreerSalon::new();
        requete.name = Some(nom.trim().to_owned());
        requete.topic = Some(sujet.trim().to_owned());
        requete.creation_content = Some(brut(json!({ "type": "m.space" }))?);
        requete.preset = Some(if publique { RoomPreset::PublicChat } else { RoomPreset::PrivateChat });
        requete.power_level_content_override = Some(brut(json!({
            "users": { (moi): 100 }, "users_default": 0,
            "events_default": 100, "state_default": 50,
            "invite": 50, "kick": 50, "ban": 100, "redact": 50,
        }))?);
        let salon = Box::pin(client.create_room(requete)).await?;
        Ok(salon.room_id().to_string())
    }

    /// Alias ou ID avec serveurs de routage, y compris les ID opaques v12.
    pub async fn rejoindre_espace(&self, adresse: &str, via: Vec<String>) -> Resultat<String> {
        let client = self.client().await.ok_or(Erreur::PasDeSession)?;
        let reference: OwnedRoomOrAliasId = adresse.try_into().map_err(|e: matrix_sdk::ruma::IdParseError| Erreur::Autre(e.to_string()))?;
        let via: Vec<OwnedServerName> = via.into_iter().map(|s| s.try_into().map_err(|e: matrix_sdk::ruma::IdParseError| Erreur::Autre(e.to_string()))).collect::<Resultat<_>>()?;
        let rejoints: std::collections::HashSet<_> = client.joined_rooms().into_iter().map(|s| s.room_id().to_string()).collect();
        let salon = Box::pin(client.join_room_by_id_or_alias(&reference, &via)).await?;
        let id = salon.room_id().to_string();
        let base = client.homeserver().to_string();
        let chemin = format!("{}/_matrix/client/v3/rooms/{}/state/m.room.create", base.trim_end_matches('/'), segment_encode(&id));
        let reponse = http("GET", &chemin, client.access_token().as_deref(), None).await?;
        if !(200..300).contains(&reponse.status) { return Err(Erreur::Autre(format!("Impossible de vérifier l'Espace (HTTP {})", reponse.status))); }
        if reponse.corps.get("type").and_then(|v| v.as_str()) != Some("m.space") {
            if !rejoints.contains(&id) { let _ = Box::pin(salon.leave()).await; }
            return Err(Erreur::Autre("Cette adresse ne désigne pas un Espace Matrix".into()));
        }
        Ok(id)
    }

    pub(crate) async fn verifier_gestion_espace(&self, espace: &str) -> Resultat<()> {
        let salon = self.salon(espace).await?;
        // createRoom retourne avant que /sync fournisse les niveaux et le type.
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            loop {
                if salon.get_state_event(StateEventType::RoomCreate, "").await?.is_some()
                    && salon.get_state_event(StateEventType::RoomPowerLevels, "").await?.is_some() { break Ok::<_, matrix_sdk::Error>(()); }
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
        }).await.map_err(|_| Erreur::Autre("L'Espace est créé mais sa synchronisation tarde ; réessayez dans quelques instants".into()))??;
        let creation = salon.get_state_event(StateEventType::RoomCreate, "").await?;
        let est_espace = creation.as_ref().and_then(|ev| match ev {
            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(e) => serde_json::from_str::<serde_json::Value>(e.json().get()).ok(),
            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(e) => serde_json::from_str::<serde_json::Value>(e.json().get()).ok(),
        }).is_some_and(|v| v.pointer("/content/type").and_then(|v| v.as_str()) == Some("m.space"));
        if !est_espace { return Err(Erreur::Autre("Espace Matrix introuvable".into())); }
        let d = self.details_salon(espace).await?;
        if d.moi < d.niveau_etat {
            return Err(Erreur::Autre("Seuls les responsables de l'Espace peuvent le modifier".into()));
        }
        Ok(())
    }
}
