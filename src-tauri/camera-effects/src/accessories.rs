use crate::{vision::Face, Accessory};
use image::RgbaImage;
use tiny_skia::{Paint, PathBuilder, Pixmap, Stroke, Transform};

fn paint(r: u8, g: u8, b: u8, a: u8) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(r, g, b, a);
    p.anti_alias = true;
    p
}
fn ellipse(
    pixmap: &mut Pixmap,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    color: Paint<'_>,
    transform: Transform,
) {
    if let Some(path) = tiny_skia::Rect::from_xywh(x, y, w, h).and_then(PathBuilder::from_oval) {
        pixmap.fill_path(&path, &color, tiny_skia::FillRule::Winding, transform, None);
    }
}
fn path(
    pixmap: &mut Pixmap,
    p: PathBuilder,
    color: Paint<'_>,
    transform: Transform,
    stroke: Option<f32>,
) {
    if let Some(path) = p.finish() {
        if let Some(width) = stroke {
            pixmap.stroke_path(
                &path,
                &color,
                &Stroke {
                    width,
                    line_cap: tiny_skia::LineCap::Round,
                    ..Default::default()
                },
                transform,
                None,
            );
        } else {
            pixmap.fill_path(&path, &color, tiny_skia::FillRule::Winding, transform, None);
        }
    }
}
pub fn draw(image: &mut RgbaImage, face: &Face, accessory: Accessory) {
    let (w, h) = image.dimensions();
    let Some(mut layer) = Pixmap::new(w, h) else {
        return;
    };
    let eye_a = [face.points[0][0] * w as f32, face.points[0][1] * h as f32];
    let eye_b = [face.points[1][0] * w as f32, face.points[1][1] * h as f32];
    let (left, right) = if eye_a[0] < eye_b[0] {
        (eye_a, eye_b)
    } else {
        (eye_b, eye_a)
    };
    let length = ((right[0] - left[0]).powi(2) + (right[1] - left[1]).powi(2)).sqrt();
    if length < 4.0 || !length.is_finite() {
        return;
    }
    let scale = length / 100.0;
    let angle = (right[1] - left[1]).atan2(right[0] - left[0]);
    let origin = match accessory {
        Accessory::Moustache => [
            face.points[2][0] * w as f32,
            face.points[2][1] * h as f32 + length * 0.18,
        ],
        _ => [(left[0] + right[0]) / 2.0, (left[1] + right[1]) / 2.0],
    };
    let t = Transform::from_row(
        scale * angle.cos(),
        scale * angle.sin(),
        -scale * angle.sin(),
        scale * angle.cos(),
        origin[0],
        origin[1],
    );
    match accessory {
        Accessory::Glasses => {
            ellipse(
                &mut layer,
                -82.0,
                -25.0,
                64.0,
                45.0,
                paint(15, 18, 28, 245),
                t,
            );
            ellipse(
                &mut layer,
                18.0,
                -25.0,
                64.0,
                45.0,
                paint(15, 18, 28, 245),
                t,
            );
            ellipse(
                &mut layer,
                -75.0,
                -21.0,
                50.0,
                33.0,
                paint(54, 106, 130, 190),
                t,
            );
            ellipse(
                &mut layer,
                25.0,
                -21.0,
                50.0,
                33.0,
                paint(54, 106, 130, 190),
                t,
            );
            let mut p = PathBuilder::new();
            p.move_to(-22.0, -9.0);
            p.quad_to(0.0, -18.0, 22.0, -9.0);
            p.move_to(-82.0, -12.0);
            p.line_to(-104.0, -22.0);
            p.move_to(82.0, -12.0);
            p.line_to(104.0, -22.0);
            path(&mut layer, p, paint(20, 24, 34, 255), t, Some(6.0));
        }
        Accessory::Moustache => {
            let mut p = PathBuilder::new();
            p.move_to(0.0, 0.0);
            p.cubic_to(-22.0, -18.0, -39.0, 18.0, -70.0, -4.0);
            p.cubic_to(-62.0, 33.0, -14.0, 32.0, 0.0, 10.0);
            p.cubic_to(14.0, 32.0, 62.0, 33.0, 70.0, -4.0);
            p.cubic_to(39.0, 18.0, 22.0, -18.0, 0.0, 0.0);
            p.close();
            path(&mut layer, p, paint(41, 27, 24, 255), t, None);
        }
        Accessory::Laugh => {
            ellipse(
                &mut layer,
                -108.0,
                -82.0,
                216.0,
                216.0,
                paint(252, 190, 37, 255),
                t,
            );
            ellipse(
                &mut layer,
                -96.0,
                -75.0,
                192.0,
                196.0,
                paint(255, 215, 62, 255),
                t,
            );
            let mut eyes = PathBuilder::new();
            eyes.move_to(-67.0, -5.0);
            eyes.quad_to(-49.0, -29.0, -30.0, -5.0);
            eyes.move_to(30.0, -5.0);
            eyes.quad_to(49.0, -29.0, 67.0, -5.0);
            path(&mut layer, eyes, paint(68, 44, 23, 255), t, Some(11.0));
            let mut mouth = PathBuilder::new();
            mouth.move_to(-57.0, 37.0);
            mouth.quad_to(0.0, 61.0, 57.0, 37.0);
            mouth.cubic_to(45.0, 112.0, -45.0, 112.0, -57.0, 37.0);
            mouth.close();
            path(&mut layer, mouth, paint(82, 37, 35, 255), t, None);
            let mut teeth = PathBuilder::new();
            teeth.move_to(-53.0, 42.0);
            teeth.quad_to(0.0, 60.0, 53.0, 42.0);
            teeth.line_to(45.0, 58.0);
            teeth.quad_to(0.0, 75.0, -45.0, 58.0);
            teeth.close();
            path(&mut layer, teeth, paint(255, 250, 240, 255), t, None);
            for sign in [-1.0, 1.0] {
                let mut tear = PathBuilder::new();
                tear.move_to(sign * 78.0, 3.0);
                tear.cubic_to(sign * 66.0, 24.0, sign * 125.0, 53.0, sign * 132.0, 26.0);
                tear.cubic_to(sign * 135.0, 11.0, sign * 102.0, 14.0, sign * 78.0, 3.0);
                tear.close();
                path(&mut layer, tear, paint(53, 174, 234, 245), t, None);
            }
        }
        Accessory::None => return,
    }
    for (dest, src) in image.pixels_mut().zip(layer.data().chunks_exact(4)) {
        let alpha = src[3] as u32;
        for c in 0..3 {
            dest[c] = (src[c] as u32 + dest[c] as u32 * (255 - alpha) / 255).min(255) as u8;
        }
    }
}
