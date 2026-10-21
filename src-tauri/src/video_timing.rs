//! Horodatage des images décodées. `-re` limite la lecture de l'entrée,
//! pas la présentation : les images doivent attendre leur PTS à la sortie.
use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImageTemps {
    pub position: Duration,
    pub duree: Duration,
}

fn nombre(ligne: &str, cle: &str) -> Option<Duration> {
    let valeur = ligne
        .split_once(cle)?
        .1
        .split_whitespace()
        .next()?
        .parse::<f64>()
        .ok()?;
    if !valeur.is_finite() {
        return None;
    }
    // Une image de prélecture peut précéder zéro après un déplacement.
    // Garder son horodatage dans la file pour ne pas décaler les suivantes.
    Duration::try_from_secs_f64(valeur.max(0.0)).ok()
}

fn analyser(ligne: &str) -> Option<ImageTemps> {
    if !ligne.contains("showinfo") {
        return None;
    }
    Some(ImageTemps {
        position: nombre(ligne, " pts_time:")?,
        // Les anciens ffmpeg n'écrivent pas duration_time. La durée du média
        // reste disponible pour maintenir sa dernière image jusqu'au bout.
        duree: nombre(ligne, " duration_time:").unwrap_or_default(),
    })
}

/// Consomme stderr en parallèle de stdout : ffmpeg ne doit jamais attendre
/// que son tube de journal se vide. Le tube des pixels borne l'avance du
/// décodeur et donc le nombre d'horodatages en attente.
pub fn horodatages(flux: impl Read + Send + 'static) -> std::io::Result<Receiver<ImageTemps>> {
    let (envoi, reception) = mpsc::channel();
    std::thread::Builder::new()
        .name("sion-video-pts".into())
        .spawn(move || {
            for ligne in BufReader::new(flux).lines().map_while(Result::ok) {
                if let Some(temps) = analyser(&ligne) {
                    if envoi.send(temps).is_err() {
                        break;
                    }
                } else if ligne.contains("[error]") || ligne.contains("[fatal]") {
                    log::warn!("[Sion][video] ffmpeg : {ligne}");
                }
            }
        })?;
    Ok(reception)
}

/// Horloge de présentation. Le son la recale pendant sa lecture ; elle
/// continue seule après une piste audio plus courte que l'image.
pub struct Horloge {
    position: Duration,
    ancre: Instant,
    en_pause: bool,
}

impl Horloge {
    pub fn new() -> Self {
        Self {
            position: Duration::ZERO,
            ancre: Instant::now(),
            en_pause: false,
        }
    }

    pub fn position(&self) -> Duration {
        self.position
            + if self.en_pause {
                Duration::ZERO
            } else {
                self.ancre.elapsed()
            }
    }

    pub fn synchroniser(&mut self, position: Duration) {
        self.position = position;
        self.ancre = Instant::now();
    }

    pub fn pause(&mut self, en_pause: bool) {
        if self.en_pause != en_pause {
            self.synchroniser(self.position());
            self.en_pause = en_pause;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_pts_et_la_duree_restent_ceux_du_fichier() {
        let t = analyser("[Parsed_showinfo_2 @ 0x123] [info] n: 12 pts: 15015 pts_time:0.5005 duration: 1001 duration_time:0.0333667 fmt:yuv420p").unwrap();
        assert_eq!(t.position, Duration::from_micros(500_500));
        assert_eq!(t.duree, Duration::from_nanos(33_366_700));
        assert!(analyser("[info] Duration: 00:00:02.00").is_none());
        assert!(analyser("[showinfo] pts_time:NaN").is_none());
    }

    #[test]
    fn une_pause_ne_fait_pas_rattraper_le_temps_d_arret() {
        let mut h = Horloge::new();
        h.synchroniser(Duration::from_secs(2));
        h.pause(true);
        let position = h.position();
        h.ancre -= Duration::from_secs(10);
        assert_eq!(h.position(), position);
        h.pause(false);
        assert!(h.position() < position + Duration::from_millis(100));
    }
}
