//! VAD locale : Silero 6.2 (32 ms), avec repli earshot 1.x (16 ms).

use std::path::Path;
use transcribe_cpp::{Model, VadSession, VadSessionOptions};

pub(super) const FRAME_SAMPLES: usize = 512;

pub(super) struct SpeechDetector {
    silero: Option<VadSession>,
    fallback: Box<earshot::Detector>,
}

impl SpeechDetector {
    pub(super) fn new(path: Option<&Path>) -> Self {
        let silero = path.and_then(|path| {
            super::ensure_backends();
            match Model::load(path)
                .and_then(|model| model.vad_session_with(&VadSessionOptions { n_threads: 1 }))
            {
                Ok(vad) => {
                    log::info!("[Sion][transcribe] VAD Silero 6.2 prête");
                    Some(vad)
                }
                Err(error) => {
                    log::warn!(
                        "[Sion][transcribe] VAD Silero indisponible, repli earshot : {error}"
                    );
                    None
                }
            }
        });
        Self {
            silero,
            fallback: earshot::Detector::default_boxed(),
        }
    }

    pub(super) fn predict(&mut self, frame: &[f32], speaking: bool) -> bool {
        if frame.len() != FRAME_SAMPLES || frame.iter().any(|sample| !sample.is_finite()) {
            return false;
        }
        let pcm: Vec<f32> = frame.iter().map(|sample| sample.clamp(-1.0, 1.0)).collect();
        if let Some(vad) = self.silero.as_mut() {
            match vad.stream_feed(&pcm) {
                Ok(result) => {
                    return result
                        .probs
                        .last()
                        .is_some_and(|score| is_speech(*score, speaking));
                }
                Err(error) => {
                    log::warn!(
                        "[Sion][transcribe] VAD Silero interrompue, repli earshot : {error}"
                    );
                    self.silero = None;
                }
            }
        }
        let score = pcm
            .chunks_exact(256)
            .map(|chunk| self.fallback.predict_f32(chunk))
            .sum::<f32>()
            / 2.0;
        is_speech(score, speaking)
    }

    pub(super) fn reset(&mut self) {
        if let Some(vad) = self.silero.as_mut() {
            vad.stream_reset();
        }
        self.fallback.reset();
    }
}

fn is_speech(score: f32, speaking: bool) -> bool {
    score.is_finite() && score >= if speaking { 0.35 } else { 0.5 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silero_bundled_silence_and_reset() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/silero-vad-v6.2-F32.gguf");
        let mut detector = SpeechDetector::new(Some(&path));
        assert!(detector.silero.is_some(), "le modèle livré doit se charger");
        for _ in 0..40 {
            assert!(!detector.predict(&[0.0; FRAME_SAMPLES], false));
        }
        detector.reset();
        assert!(!detector.predict(&[0.0; FRAME_SAMPLES], false));
    }

    #[test]
    fn fallback_accepts_32ms_without_losing_earshot_frame_contract() {
        let mut detector = SpeechDetector::new(None);
        assert!(!detector.predict(&[0.0; FRAME_SAMPLES], false));
        assert!(!detector.predict(&[f32::NAN; FRAME_SAMPLES], false));
        assert!(!detector.predict(&[0.0; 20], false));
    }

    #[test]
    fn hysteresis_keeps_quiet_word_endings_without_opening_on_them() {
        assert!(!is_speech(0.4, false));
        assert!(is_speech(0.4, true));
        assert!(!is_speech(0.2, true));
        assert!(!is_speech(f32::NAN, true));
    }
}
