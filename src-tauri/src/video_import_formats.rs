//! Analyse et téléchargement partagent le classement de yt-dlp. Ses formats
//! sont ordonnés du moins au plus préféré : prendre le dernier de chaque
//! résolution évite d'afficher la taille d'un HLS puis de télécharger un DASH.

use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Garder la résolution demandée, puis préférer l'AV1 déjà encodé par la
/// source. yt-dlp conserve ses replis VP9/H.264 quand l'AV1 est absent.
pub const TRI_FORMATS: &str = "res,vcodec:av1,acodec:opus";

fn codec(v: &str) -> &'static str {
    if v.starts_with("av01") || v.starts_with("av1") {
        "AV1"
    } else if v.starts_with("vp9") || v.starts_with("vp09") {
        "VP9"
    } else if v.starts_with("avc") || v.starts_with("h264") {
        "H.264"
    } else {
        "?"
    }
}

fn piste<'a>(format: &'a Value, nom: &str) -> &'a str {
    format.get(nom).and_then(Value::as_str).unwrap_or("none")
}

fn taille(format: &Value, duree: u64, debits: &[&str]) -> u64 {
    for cle in ["filesize", "filesize_approx"] {
        if let Some(n) = format.get(cle).and_then(Value::as_u64).filter(|n| *n > 0) {
            return n;
        }
    }
    for cle in debits {
        if let Some(debit) = format.get(cle).and_then(Value::as_f64).filter(|n| *n > 0.0) {
            return (debit * 1000.0 / 8.0 * duree as f64) as u64;
        }
    }
    0
}

/// Métadonnées de `yt-dlp --dump-json -S TRI_FORMATS`, sans téléchargement.
pub fn resume(metadata: &Value) -> Value {
    let duree = metadata
        .get("duration")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as u64;
    let titre = metadata.get("title").and_then(Value::as_str).unwrap_or("");
    let formats = metadata
        .get("formats")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    // Le même `ba` que celui du téléchargement : ne pas estimer une petite
    // piste Opus si yt-dlp va prendre une piste plus lourde/mieux classée.
    let audio = formats
        .iter()
        .rev()
        .find(|f| piste(f, "vcodec") == "none" && piste(f, "acodec") != "none");
    let taille_audio = audio
        .map(|f| taille(f, duree, &["abr", "tbr"]))
        .unwrap_or(0);

    let mut meilleures = BTreeMap::new();
    for format in formats.iter().rev() {
        let video = piste(format, "vcodec");
        if video == "none" {
            continue;
        }
        let Some(hauteur) = format
            .get("height")
            .and_then(Value::as_u64)
            .filter(|h| *h > 0)
        else {
            continue;
        };
        meilleures.entry(hauteur).or_insert_with(|| {
            let taille_video = taille(format, duree, &["tbr", "vbr"]);
            let separe = piste(format, "acodec") == "none" && audio.is_some();
            // Une piste inconnue ne doit pas être présentée comme une vidéo
            // qui tient dans la limite en comptant seulement l'autre piste.
            let total = if taille_video == 0 || (separe && taille_audio == 0) {
                0
            } else {
                taille_video.saturating_add(if separe { taille_audio } else { 0 })
            };
            json!({
                "height": hauteur,
                "codec": codec(video),
                "ext": format.get("ext").and_then(Value::as_str).unwrap_or("mp4"),
                "size": total,
            })
        });
    }
    let mut options: Vec<Value> = meilleures.into_values().collect();

    // Certains GIF X/Twitter n'ont ni hauteur ni codec renseigné.
    if options.is_empty() {
        if let Some(format) = formats
            .iter()
            .rev()
            .find(|f| f.get("url").and_then(Value::as_str).is_some())
        {
            options.push(json!({
                "height": 0,
                "codec": "?",
                "ext": format.get("ext").and_then(Value::as_str).unwrap_or("mp4"),
                "size": taille(format, duree, &["tbr", "vbr"]),
            }));
        }
    }
    json!({ "duration": duree, "title": titre, "options": options })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_av1_1080p_tient_sans_conversion() {
        // Tailles annoncées pour BrNtULqIUgE (100 s, 1080p60), dans l'ordre
        // retourné par yt-dlp avec TRI_FORMATS. Le HLS VP9 arrivait en premier
        // et l'ancienne analyse conservait son estimation de plus de 60 Mo.
        let info = resume(
            &json!({"duration": 100, "title": "Bande-annonce", "formats": [
                {"vcodec": "none", "acodec": "opus", "filesize": 1690422},
                {"height": 1080, "vcodec": "avc1.64002A", "acodec": "none", "filesize": 50918079},
                {"height": 1080, "vcodec": "vp09.00.41.08", "acodec": "none", "tbr": 5551.848},
                {"height": 1080, "vcodec": "vp9", "acodec": "none", "filesize": 31380505},
                {"height": 1080, "vcodec": "av01.0.09M.08", "acodec": "none", "filesize": 18081423, "ext": "mp4"}
            ]}),
        );
        assert_eq!(info["options"][0]["codec"], "AV1");
        assert_eq!(info["options"][0]["size"], 19771845u64);
        assert!(info["options"][0]["size"].as_u64().unwrap() < 20 * 1024 * 1024);
    }

    #[test]
    fn sans_av1_prend_le_vp9_dash_qui_sera_telecharge() {
        let info = resume(&json!({"duration": 100, "formats": [
            {"vcodec": "none", "acodec": "opus", "filesize": 1000},
            {"height": 720, "vcodec": "avc1", "acodec": "none", "filesize": 5000000},
            {"height": 720, "vcodec": "vp09", "acodec": "none", "tbr": 4000},
            {"height": 720, "vcodec": "vp9", "acodec": "none", "filesize": 3000000}
        ]}));
        assert_eq!(info["options"][0]["codec"], "VP9");
        assert_eq!(info["options"][0]["size"], 3001000);
    }

    #[test]
    fn conserve_le_h264_superieur_quand_av1_nexiste_que_plus_bas() {
        let info = resume(&json!({"formats": [
            {"height": 720, "vcodec": "av1", "acodec": "opus", "filesize": 2000},
            {"height": 1080, "vcodec": "h264", "acodec": "aac", "filesize": 4000}
        ]}));
        assert_eq!(info["options"][0]["height"], 720);
        assert_eq!(info["options"][0]["codec"], "AV1");
        assert_eq!(info["options"][1]["height"], 1080);
        assert_eq!(info["options"][1]["codec"], "H.264");
    }

    #[test]
    fn utilise_la_piste_audio_selectionnee_et_ne_la_compte_pas_deux_fois() {
        let info = resume(&json!({"formats": [
            {"vcodec": "none", "acodec": "opus", "filesize": 1000},
            {"vcodec": "none", "acodec": "opus", "filesize": 2000},
            {"height": 480, "vcodec": "h264", "acodec": "aac", "filesize": 3000},
            {"height": 720, "vcodec": "av01", "acodec": "none", "filesize": 4000}
        ]}));
        assert_eq!(info["options"][0]["size"], 3000);
        assert_eq!(info["options"][1]["size"], 6000);
    }

    #[test]
    fn hls_estime_sur_le_debit_et_taille_inconnue_reste_inconnue() {
        let info = resume(&json!({"duration": 10, "formats": [
            {"vcodec": "none", "acodec": "opus", "abr": 128},
            {"height": 480, "vcodec": "vp9", "acodec": "none", "tbr": 800},
            {"height": 720, "vcodec": "av01", "acodec": "none"}
        ]}));
        assert_eq!(info["options"][0]["size"], 1160000);
        assert_eq!(info["options"][1]["size"], 0);
        let sans_audio_connu = resume(&json!({"formats": [
            {"vcodec": "none", "acodec": "opus"},
            {"height": 720, "vcodec": "av1", "acodec": "none", "filesize": 4000}
        ]}));
        assert_eq!(sans_audio_connu["options"][0]["size"], 0);
    }

    #[test]
    fn gif_sans_metadonnees_et_video_muet_conservent_leur_taille() {
        let gif = resume(
            &json!({"formats": [{"url": "https://example.org/gif", "ext": "mp4", "filesize_approx": 1234}]}),
        );
        assert_eq!(gif["options"][0]["height"], 0);
        assert_eq!(gif["options"][0]["size"], 1234);
        let muet = resume(
            &json!({"formats": [{"height": 720, "vcodec": "av1", "acodec": "none", "filesize": 4321}]}),
        );
        assert_eq!(muet["options"][0]["size"], 4321);
    }
}
