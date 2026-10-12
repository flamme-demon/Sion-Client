use std::{fs::File, os::fd::AsRawFd};

#[derive(Clone, Debug, PartialEq)]
pub struct Mode {
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
}
fn score(mode: &Mode) -> (u32, u32, bool) {
    // La cadence réelle prime sur la résolution, puis la compression USB
    // départage les formats de même qualité.
    (
        (mode.fps.min(30.0) * 100.0) as u32,
        mode.width * mode.height,
        mode.format == "mjpeg",
    )
}
fn best(modes: impl IntoIterator<Item = Mode>) -> Option<Mode> {
    modes.into_iter().max_by_key(score)
}

// Structures V4L2 de videodev2.h, uniquement des champs u32 : mêmes tailles
// sur les architectures Linux prises en charge. Aucun ioctl de configuration.
#[repr(C)]
#[derive(Default)]
struct Format {
    index: u32,
    kind: u32,
    flags: u32,
    description: [u8; 32],
    pixel: u32,
    mbus: u32,
    reserved: [u32; 3],
}
#[repr(C)]
#[derive(Default)]
struct Size {
    index: u32,
    pixel: u32,
    kind: u32,
    values: [u32; 6],
    reserved: [u32; 2],
}
#[repr(C)]
#[derive(Default)]
struct Interval {
    index: u32,
    pixel: u32,
    width: u32,
    height: u32,
    kind: u32,
    values: [u32; 6],
    reserved: [u32; 2],
}
unsafe extern "C" {
    fn ioctl(fd: std::os::raw::c_int, request: std::os::raw::c_ulong, ...) -> std::os::raw::c_int;
}
fn query<T>(file: &File, number: u32, data: &mut T) -> bool {
    let request = 0xc0005600u32 | (std::mem::size_of::<T>() as u32) << 16 | number;
    // SAFETY: les structures #[repr(C)] sont celles du ioctl, initialisées
    // à zéro ; le descripteur reste ouvert pendant cette lecture.
    unsafe {
        ioctl(
            file.as_raw_fd(),
            request as std::os::raw::c_ulong,
            data as *mut T,
        ) >= 0
    }
}
fn fastest(file: &File, pixel: u32, width: u32, height: u32) -> Option<f32> {
    let mut fastest: Option<f32> = None;
    for index in 0..64 {
        let mut interval = Interval {
            index,
            pixel,
            width,
            height,
            ..Default::default()
        };
        if !query(file, 75, &mut interval) {
            break;
        }
        let [n, d, ..] = interval.values;
        if n == 0 || d == 0 {
            continue;
        }
        let fps = if interval.kind == 1 {
            d as f32 / n as f32
        } else {
            (d as f32 / n as f32).min(30.0)
        };
        fastest = Some(fastest.map_or(fps, |old| {
            if (fps - 30.0).abs() < (old - 30.0).abs() {
                fps
            } else {
                old
            }
        }));
        if interval.kind != 1 {
            break;
        }
    }
    fastest
}
pub fn mode(path: &str) -> Option<Mode> {
    let file = File::open(path).ok()?;
    let mut modes = Vec::new();
    for index in 0..32 {
        let mut format = Format {
            index,
            kind: 1,
            ..Default::default()
        };
        if !query(&file, 2, &mut format) {
            break;
        }
        let name = match format.pixel.to_le_bytes() {
            [b'M', b'J', b'P', b'G'] => "mjpeg",
            [b'Y', b'U', b'Y', b'V'] => "yuyv422",
            [b'U', b'Y', b'V', b'Y'] => "uyvy422",
            [b'N', b'V', b'1', b'2'] => "nv12",
            [b'Y', b'U', b'1', b'2'] => "yuv420p",
            _ => continue,
        };
        for index in 0..128 {
            let mut size = Size {
                index,
                pixel: format.pixel,
                ..Default::default()
            };
            if !query(&file, 74, &mut size) {
                break;
            }
            let resolutions = if size.kind == 1 {
                vec![(size.values[0], size.values[1])]
            } else {
                let [min_w, max_w, step_w, min_h, max_h, step_h] = size.values;
                [(1280, 720), (640, 360), (640, 480)]
                    .into_iter()
                    .filter(|&(w, h)| {
                        w >= min_w
                            && w <= max_w
                            && h >= min_h
                            && h <= max_h
                            && (w - min_w) % step_w.max(1) == 0
                            && (h - min_h) % step_h.max(1) == 0
                    })
                    .collect()
            };
            for (width, height) in resolutions {
                if width < 2 || height < 2 || width > 1280 || height > 720 {
                    continue;
                }
                if let Some(fps) = fastest(&file, format.pixel, width, height) {
                    modes.push(Mode {
                        format: name,
                        width,
                        height,
                        fps,
                    });
                }
            }
            if size.kind != 1 {
                break;
            }
        }
    }
    best(modes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chooses_real_30_fps_over_raw_720p_at_ten_fps() {
        let mode = |format, width, height, fps| Mode {
            format,
            width,
            height,
            fps,
        };
        let fast = mode("mjpeg", 1280, 720, 30.0);
        assert_eq!(
            best([
                mode("yuyv422", 1280, 720, 10.0),
                mode("yuyv422", 640, 480, 30.0),
                fast.clone()
            ]),
            Some(fast)
        );
    }
    #[test]
    fn raw_only_cameras_keep_the_fastest_available_resolution() {
        let slow = Mode {
            format: "yuyv422",
            width: 1280,
            height: 720,
            fps: 10.0,
        };
        let fast = Mode {
            format: "yuyv422",
            width: 640,
            height: 480,
            fps: 30.0,
        };
        assert_eq!(best([slow, fast.clone()]), Some(fast));
        assert_eq!(std::mem::size_of::<Format>(), 64);
        assert_eq!(std::mem::size_of::<Size>(), 44);
        assert_eq!(std::mem::size_of::<Interval>(), 52);
    }
}
