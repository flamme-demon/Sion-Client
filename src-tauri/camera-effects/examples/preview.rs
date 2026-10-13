use sion_camera_effects::{Accessory, BackgroundMode, Control, Filter, Processor, Settings};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
fn main() {
    let source = std::env::args().nth(1).expect("image de test");
    let folder = std::env::args().nth(2).expect("dossier de sortie");
    std::fs::create_dir_all(&folder).unwrap();
    let input = image::open(source).unwrap().into_rgba8();
    let control = Arc::new(Control::default());
    let mut processor = Processor::new(control.clone());
    for (name, bg, filter, accessory, outline, auto_frame) in [
        (
            "blur",
            BackgroundMode::Blur,
            Filter::None,
            Accessory::None,
            false,
            false,
        ),
        (
            "aurora",
            BackgroundMode::Aurora,
            Filter::None,
            Accessory::None,
            true,
            false,
        ),
        (
            "glasses",
            BackgroundMode::Sion,
            Filter::Cinema,
            Accessory::Glasses,
            true,
            true,
        ),
        (
            "moustache",
            BackgroundMode::None,
            Filter::Mono,
            Accessory::Moustache,
            false,
            false,
        ),
        (
            "laugh",
            BackgroundMode::Aurora,
            Filter::None,
            Accessory::Laugh,
            false,
            false,
        ),
        (
            "vhs",
            BackgroundMode::None,
            Filter::Vhs,
            Accessory::None,
            false,
            false,
        ),
        (
            "pixels",
            BackgroundMode::None,
            Filter::Pixel,
            Accessory::None,
            false,
            false,
        ),
    ] {
        control
            .configure(Settings {
                background: bg,
                filter,
                accessory,
                outline,
                auto_frame,
                light: true,
                ..Default::default()
            })
            .unwrap();
        let start = Instant::now();
        let mut output = input.clone();
        for _ in 0..80 {
            output = processor.process(input.clone());
            let status = control.status.lock().unwrap().clone();
            if let Some(error) = status.error {
                panic!("{error}")
            }
            if status.ready && start.elapsed() > Duration::from_millis(800) {
                break;
            }
            std::thread::sleep(Duration::from_millis(33));
        }
        assert!(control.status.lock().unwrap().ready, "effets non prêts");
        output.save(format!("{folder}/{name}.png")).unwrap();
        let mut samples = Vec::new();
        let mut render_samples = Vec::new();
        let mut analysis_samples = Vec::new();
        for _ in 0..20 {
            let t = Instant::now();
            processor.process(input.clone());
            samples.push(t.elapsed().as_secs_f32() * 1000.0);
            let status = control.status.lock().unwrap();
            render_samples.push(status.render_ms);
            analysis_samples.push(status.analysis_ms);
        }
        samples.sort_by(f32::total_cmp);
        render_samples.sort_by(f32::total_cmp);
        analysis_samples.sort_by(f32::total_cmp);
        println!(
            "{name}: traitement médian {:.1} ms (rendu {:.1} ms, analyse {:.1} ms)",
            samples[10], render_samples[10], analysis_samples[10]
        );
    }
}
