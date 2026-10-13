use super::*;

#[test]
fn matte_is_reused_until_segmentation_or_framing_changes() {
    let mut pixels = vec![0.0; PERSON_SIZE * PERSON_SIZE];
    for y in 40..150 {
        for x in 60..120 {
            pixels[y * PERSON_SIZE + x] = 1.0;
        }
    }
    let source = Arc::new(pixels);
    let crop = [0, 0, 2048, 2048];
    let matte = Matte::new(source.clone(), crop, 64, 48, true);
    assert!(matte.matches(&source, crop, 64, 48, true));
    assert!(!matte.matches(&Arc::new((*source).clone()), crop, 64, 48, true));
    assert!(!matte.matches(&source, [10, 0, 2048, 2048], 64, 48, true));
    assert!(!matte.matches(&source, crop, 64, 48, false));
    assert!(matte.pixels.iter().any(|[alpha, _]| *alpha == 1.0));
    assert!(matte.pixels.iter().any(|[_, edge]| *edge > 0.0));
    assert!(matte
        .pixels
        .iter()
        .all(|[alpha, edge]| (0.0..=1.0).contains(alpha) && (0.0..=1.0).contains(edge)));
}

#[test]
fn background_masks_the_room_on_the_first_processed_frame() {
    let control = Arc::new(Control::default());
    control
        .configure(Settings {
            background: BackgroundMode::Aurora,
            ..Default::default()
        })
        .unwrap();
    let mut processor = Processor::new(control.clone());
    let source = RgbaImage::from_pixel(64, 48, image::Rgba([255, 0, 0, 255]));
    let output = processor.process(source.clone());
    assert_ne!(output, source);
    assert!(output.pixels().all(|p| p[0] < 200 && p[3] == 255));
    assert!(control.status.lock().unwrap().ready);
    control.configure(Settings::default()).unwrap();
    assert!(!processor.enabled());
    assert!(processor.worker.is_none());
    assert!(processor.segmenter.is_none());
    assert_eq!(processor.process(source.clone()), source);
}

#[test]
fn face_readiness_requires_a_completed_face_analysis() {
    let control = Arc::new(Control::default());
    control
        .configure(Settings {
            auto_frame: true,
            ..Default::default()
        })
        .unwrap();
    let mut processor = Processor::new(control.clone());
    let worker = Worker::new();
    *worker.result.lock().unwrap() = Analysis {
        finished: Some(Instant::now()),
        ..Default::default()
    };
    processor.worker = Some(worker);
    processor.process(RgbaImage::from_pixel(64, 48, image::Rgba([0, 0, 0, 255])));
    assert!(!control.status.lock().unwrap().ready);
}

#[test]
fn both_bundled_models_produce_finite_results_and_stop() {
    let segmenter = PersonSegmenter::new();
    let mask = segmenter
        .segment(vec![0.0; 3 * PERSON_SIZE * PERSON_SIZE])
        .unwrap();
    assert_eq!(mask.len(), PERSON_SIZE * PERSON_SIZE);
    assert!(mask
        .iter()
        .all(|p| p.is_finite() && (0.0..=1.0).contains(p)));
    assert!(
        mask.iter().all(|p| *p < 0.1),
        "Aucune personne sur une image noire"
    );
    let worker = Worker::new();
    worker.submit(vec![0.0; 3 * 320 * 320]);
    let started = Instant::now();
    let result = loop {
        let result = worker.result.lock().unwrap().clone();
        assert!(result.error.is_none(), "{:?}", result.error);
        if result.finished.is_some() {
            break result;
        }
        assert!(started.elapsed() < Duration::from_secs(30));
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(result.face_analyzed);
    assert!(result.face.is_none(), "Aucun visage sur une image noire");
    let shutdown = Instant::now();
    drop(worker);
    assert!(shutdown.elapsed() < Duration::from_secs(1));
}

#[test]
fn every_background_frame_uses_its_own_segmentation() {
    let control = Arc::new(Control::default());
    control
        .configure(Settings {
            background: BackgroundMode::Aurora,
            ..Default::default()
        })
        .unwrap();
    let mut processor = Processor::new(control.clone());
    let black = RgbaImage::from_pixel(64, 48, image::Rgba([0, 0, 0, 255]));
    processor.process(black);
    assert!(control.status.lock().unwrap().ready);
    let first = processor.matte.as_ref().unwrap().source.clone();
    let green = RgbaImage::from_pixel(64, 48, image::Rgba([0, 255, 0, 255]));
    let output = processor.process(green.clone());
    assert!(control.status.lock().unwrap().ready);
    let second = &processor.matte.as_ref().unwrap().source;
    assert!(
        !Arc::ptr_eq(&first, second),
        "Le masque précédent ne doit pas être réutilisé"
    );
    assert_ne!(
        output, green,
        "Le fond de la nouvelle image doit rester masqué"
    );
    assert!(
        processor.worker.is_none(),
        "Le visage ne doit pas retarder le détourage"
    );
}

#[test]
fn selfie_input_is_rgb_in_zero_one_and_yunet_remains_bgr() {
    let image = RgbaImage::from_pixel(2, 2, image::Rgba([255, 128, 0, 255]));
    let selfie = tensor_input(&image, PERSON_SIZE, true);
    let plane = PERSON_SIZE * PERSON_SIZE;
    assert_eq!(selfie[0], 1.0);
    assert!((selfie[plane] - 128.0 / 255.0).abs() < 0.00001);
    assert_eq!(selfie[plane * 2], 0.0);
    let yunet = tensor_input(&image, 320, false);
    assert_eq!(yunet[0], 0.0);
    assert_eq!(yunet[320 * 320], 128.0);
    assert_eq!(yunet[2 * 320 * 320], 255.0);
}

#[test]
fn invalid_custom_background_keeps_the_previous_effect() {
    let control = Control::default();
    control
        .configure(Settings {
            filter: Filter::Cinema,
            ..Default::default()
        })
        .unwrap();
    assert!(control
        .configure(Settings {
            background: BackgroundMode::Image,
            background_path: "/path/absent/sion-camera.png".into(),
            ..Default::default()
        })
        .is_err());
    assert_eq!(control.settings().filter, Filter::Cinema);
    assert_eq!(control.settings().background, BackgroundMode::None);
    assert!(control.status.lock().unwrap().ready);
}

#[test]
fn portrait_backgrounds_keep_their_aspect_and_animation_timing() {
    let wide = RgbaImage::new(320, 180);
    let crop = cover_coordinates(&wide, 360, 640);
    assert!(crop[0] > 0.3 && crop[2] < 0.4);
    assert_eq!(crop[1], 0.0);
    assert_eq!(crop[3], 1.0);
    let red = RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]));
    let blue = RgbaImage::from_pixel(2, 2, image::Rgba([0, 0, 255, 255]));
    let bg = Background {
        frames: vec![(red.clone(), 100), (blue.clone(), 200)],
        duration: 300,
    };
    assert_eq!(bg.frame(99), &red);
    assert_eq!(bg.frame(100), &blue);
    assert_eq!(bg.frame(300), &red);
}

#[test]
fn face_crop_stays_inside_the_frame_even_at_its_edges() {
    for (x, y) in [(0.0, 0.0), (0.9, 0.9), (-0.1, -0.1)] {
        let face = Face {
            rect: [x, y, 0.2, 0.3],
            points: [[x, y]; 5],
        };
        let crop = face_crop(&face);
        assert!(
            crop[0] >= 0.0
                && crop[1] >= 0.0
                && crop[0] + crop[2] <= 1.0
                && crop[1] + crop[3] <= 1.0
        );
        let source = RgbaImage::from_pixel(32, 48, image::Rgba([50, 60, 70, 255]));
        let output = crop_frame(&source, crop);
        assert_eq!(output.dimensions(), source.dimensions());
        assert_eq!(output, source);
    }
}

#[test]
fn monochrome_preserves_opacity_and_vhs_changes_over_time() {
    let mut image = RgbaImage::from_pixel(24, 24, image::Rgba([160, 80, 20, 255]));
    apply_filter(&mut image, Filter::Mono, 1.0, 0);
    assert!(image
        .pixels()
        .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
    let mut later = image.clone();
    apply_filter(&mut image, Filter::Vhs, 1.0, 0);
    apply_filter(&mut later, Filter::Vhs, 1.0, 100);
    assert_ne!(image, later);
}
