//! Controllable local sources mixed into the call AEC reference.
//! The registry retains only weak references: stopping playback releases
//! its queue and decoder even if no later WebRTC callback arrives.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};

pub const LOCAL: u8 = 0;
pub const VOCAL: u8 = 1;
pub const SILENT: u8 = 2;
pub const CAPACITY: usize = 48_000 * 2;

/// Short cues are handed entirely to Rust; feeding them does not depend
/// on timers in a background webview.
pub struct ClipFeeder {
    samples: Vec<i16>,
    channels: usize,
    cursor: Mutex<usize>,
}
impl ClipFeeder {
    pub fn new(samples: Vec<i16>, channels: usize) -> Self {
        Self {
            samples,
            channels,
            cursor: Mutex::new(0),
        }
    }
    pub fn feed(&self, stream: &Stream) -> Result<(), &'static str> {
        let mut cursor = self.cursor.lock().unwrap_or_else(|e| e.into_inner());
        if *cursor == self.samples.len() {
            if self.samples.is_empty() {
                stream.push(&[], self.channels, true)?;
            }
            return Ok(());
        }
        if stream.status().1 >= 48_000 {
            return Ok(());
        }
        let end = (*cursor + 48_000 * self.channels).min(self.samples.len());
        stream.push(
            &self.samples[*cursor..end],
            self.channels,
            end == self.samples.len(),
        )?;
        *cursor = end;
        Ok(())
    }
}

pub trait RenderSource: Send + Sync {
    fn render(&self, left: &mut [f32], right: &mut [f32]);
    fn interrupt(&self) {}
}
static SOURCES: LazyLock<Mutex<Vec<Weak<dyn RenderSource>>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

pub fn register(source: &Arc<dyn RenderSource>) {
    let mut sources = SOURCES.lock().unwrap_or_else(|e| e.into_inner());
    sources.retain(|s| s.strong_count() != 0);
    sources.push(Arc::downgrade(source));
}

pub fn mix_render(left: &mut [f32], right: &mut [f32]) {
    let mut sources = SOURCES.lock().unwrap_or_else(|e| e.into_inner());
    sources.retain(|source| {
        if let Some(source) = source.upgrade() {
            source.render(left, right);
            true
        } else {
            false
        }
    });
}

pub fn interrupt_sources() {
    SOURCES.lock().unwrap_or_else(|e| e.into_inner()).retain(|source| {
        if let Some(source) = source.upgrade() { source.interrupt(); true } else { false }
    });
}

#[derive(Default)]
struct Queue {
    frames: VecDeque<[f32; 2]>,
    phase: f64,
    played: u64,
    eof: bool,
}

pub struct Stream {
    queue: Mutex<Queue>,
    pub route: AtomicU8,
    pub paused: AtomicBool,
    pub stopped: AtomicBool,
    gain: AtomicU32,
    pub discard_on_interrupt: AtomicBool,
}

impl Stream {
    pub fn new(gain: f32) -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(Queue::default()),
            route: AtomicU8::new(LOCAL),
            paused: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            gain: AtomicU32::new(gain.to_bits()),
            discard_on_interrupt: AtomicBool::new(false),
        })
    }

    pub fn push(&self, samples: &[i16], channels: usize, eof: bool) -> Result<(), &'static str> {
        if !(1..=2).contains(&channels) || samples.len() % channels != 0 {
            return Err("format PCM invalide");
        }
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if queue.eof || self.stopped.load(Ordering::Acquire) {
            return Err("lecture terminée");
        }
        if queue.frames.len() + samples.len() / channels > CAPACITY {
            return Err("file audio pleine");
        }
        for frame in samples.chunks_exact(channels) {
            queue.frames.push_back([
                frame[0] as f32 / 32768.0,
                frame[channels - 1] as f32 / 32768.0,
            ]);
        }
        queue.eof = eof;
        Ok(())
    }

    pub fn set_gain(&self, gain: f32) -> Result<(), &'static str> {
        if !gain.is_finite() || !(0.0..=3.0).contains(&gain) {
            return Err("volume audio invalide");
        }
        self.gain.store(gain.to_bits(), Ordering::Release);
        Ok(())
    }

    pub fn status(&self) -> (u64, usize, bool) {
        let queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        (
            queue.played * 1000 / 48_000,
            queue.frames.len(),
            queue.eof && queue.frames.is_empty(),
        )
    }

    /// Call rendering and local output share one cursor. Route changes never
    /// replay samples and preserve the playback position.
    fn consume(&self, rate: u32, route: u8, mut write: impl FnMut(usize, [f32; 2]), frames: usize) {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if self.stopped.load(Ordering::Acquire)
            || self.paused.load(Ordering::Acquire)
            || self.route.load(Ordering::Acquire) != route
        {
            return;
        }
        for i in 0..frames {
            let Some(a) = queue.frames.front().copied() else {
                break;
            };
            let b = queue.frames.get(1).copied().unwrap_or(a);
            let phase = queue.phase as f32;
            let gain = if route == SILENT {
                0.0
            } else {
                f32::from_bits(self.gain.load(Ordering::Acquire))
            };
            write(
                i,
                [
                    (a[0] + (b[0] - a[0]) * phase) * gain,
                    (a[1] + (b[1] - a[1]) * phase) * gain,
                ],
            );
            queue.phase += 48_000.0 / rate as f64;
            while queue.phase >= 1.0 && !queue.frames.is_empty() {
                queue.frames.pop_front();
                queue.played += 1;
                queue.phase -= 1.0;
            }
            if queue.frames.is_empty() {
                queue.phase = 0.0;
            }
        }
    }

    pub fn output(&self, samples: &mut [f32], rate: u32, channels: usize) {
        samples.fill(0.0);
        if channels == 0 || rate == 0 {
            return;
        }
        let route = self.route.load(Ordering::Acquire);
        if route == VOCAL {
            return;
        }
        let frames = samples.len() / channels;
        self.consume(
            rate,
            route,
            |i, frame| {
                for c in 0..channels {
                    samples[i * channels + c] = (if channels == 1 {
                        (frame[0] + frame[1]) * 0.5
                    } else {
                        frame[c.min(1)]
                    })
                    .clamp(-1.0, 1.0);
                }
            },
            frames,
        );
    }
}

impl RenderSource for Stream {
    fn interrupt(&self) {
        if self.discard_on_interrupt.load(Ordering::Acquire) {
            self.stopped.store(true, Ordering::Release);
            self.queue.lock().unwrap_or_else(|e| e.into_inner()).frames.clear();
        }
    }
    fn render(&self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        self.consume(
            48_000,
            VOCAL,
            |i, frame| {
                left[i] += frame[0] * 32768.0;
                right[i] += frame[1] * 32768.0;
            },
            frames,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_device_interruptions_discard_cues_and_release_their_sources() {
        for _ in 0..32 {
            let cue = Stream::new(1.0);
            cue.discard_on_interrupt.store(true, Ordering::Release);
            cue.push(&[1000; 480], 1, true).unwrap();
            let weak = Arc::downgrade(&cue);
            let source: Arc<dyn RenderSource> = cue.clone();
            register(&source);
            interrupt_sources();
            assert!(cue.stopped.load(Ordering::Acquire));
            assert_eq!(cue.status().1, 0);
            drop(source); drop(cue);
            assert!(weak.upgrade().is_none());
        }
        interrupt_sources();
        let media = Stream::new(1.0);
        media.push(&[1000; 480], 1, false).unwrap();
        media.interrupt();
        assert!(!media.stopped.load(Ordering::Acquire));
        assert_eq!(media.status().1, 480);
    }

    #[test]
    fn pause_route_and_stop_preserve_the_cursor_and_stereo() {
        let stream = Stream::new(0.5);
        stream
            .push(&[1000, -2000, 3000, -4000, 5000, -6000], 2, true)
            .unwrap();
        stream.route.store(VOCAL, Ordering::Release);
        let (mut left, mut right) = ([0.0; 1], [0.0; 1]);
        stream.render(&mut left, &mut right);
        assert_eq!((left[0], right[0]), (500.0, -1000.0));
        stream.paused.store(true, Ordering::Release);
        stream.render(&mut left, &mut right);
        assert_eq!(stream.status().1, 2);
        stream.paused.store(false, Ordering::Release);
        stream.route.store(LOCAL, Ordering::Release);
        let mut local = [0.0; 2];
        stream.output(&mut local, 48_000, 2);
        assert_eq!(local, [1500.0 / 32768.0, -2000.0 / 32768.0]);
        stream.stopped.store(true, Ordering::Release);
        stream.output(&mut local, 48_000, 2);
        assert_eq!(stream.status().1, 1);
    }

    #[test]
    fn long_streams_are_bounded_and_finish_only_when_consumed() {
        let stream = Stream::new(1.0);
        for _ in 0..30 {
            // Thirty seconds in chunks, without a 20-second duration cap.
            stream.push(&vec![1000; 48_000], 1, false).unwrap();
            assert!(stream.push(&vec![1000; CAPACITY], 1, false).is_err());
            let mut out = vec![0.0; 48_000];
            stream.output(&mut out, 48_000, 1);
        }
        assert_eq!(stream.status(), (30_000, 0, false));
        stream.push(&[2000], 1, true).unwrap();
        assert!(!stream.status().2);
        stream.output(&mut [0.0], 48_000, 1);
        assert!(stream.status().2);
    }

    #[test]
    fn live_volume_changes_do_not_restart_or_advance_the_source() {
        let stream = Stream::new(1.0);
        stream.push(&[1000, 2000], 1, true).unwrap();
        stream.output(&mut [0.0], 48_000, 1);
        assert!(stream.set_gain(f32::NAN).is_err());
        stream.set_gain(0.25).unwrap();
        let mut output = [0.0];
        stream.output(&mut output, 48_000, 1);
        assert_eq!(output, [500.0 / 32768.0]);
        assert!(stream.status().2);
    }

    #[test]
    fn a_short_clip_keeps_playing_without_frontend_timers() {
        let stream = Stream::new(1.0);
        let feeder = ClipFeeder::new(vec![1000; 48_000 * 5], 1);
        for _ in 0..5 {
            feeder.feed(&stream).unwrap();
            let mut output = vec![0.0; 48_000];
            stream.output(&mut output, 48_000, 1);
            assert!(output.iter().all(|s| *s == 1000.0 / 32768.0));
        }
        assert_eq!(stream.status(), (5000, 0, true));
    }

    #[test]
    fn repeated_registration_success_cancellation_and_partial_init_release_sources() {
        for iteration in 0..100 {
            let stream = Stream::new(1.0);
            let weak = Arc::downgrade(&stream);
            let source: Arc<dyn RenderSource> = stream.clone();
            register(&source);
            if iteration % 3 != 0 {
                stream.push(&[1000, 2000], 1, true).unwrap();
                stream.route.store(VOCAL, Ordering::Release);
                mix_render(&mut [0.0; 2], &mut [0.0; 2]);
            }
            stream.stopped.store(true, Ordering::Release);
            drop(source);
            drop(stream);
            assert!(weak.upgrade().is_none());
        }
        mix_render(&mut [0.0; 2], &mut [0.0; 2]);
        assert!(SOURCES.lock().unwrap().is_empty());
    }
}
