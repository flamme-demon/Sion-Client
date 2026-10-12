use std::sync::{Condvar, Mutex};

struct State<T> {
    next: Option<T>,
    spare: Option<T>,
    closed: bool,
    dropped: u64,
}
/// Une seule image en attente. Le producteur continue à vider la capture
/// pendant le traitement ; les buffers obsolètes sont recyclés.
pub struct Latest<T> {
    state: Mutex<State<T>>,
    wake: Condvar,
}
impl<T> Default for Latest<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                next: None,
                spare: None,
                closed: false,
                dropped: 0,
            }),
            wake: Condvar::new(),
        }
    }
}
impl<T> Latest<T> {
    pub fn push(&self, frame: T) -> Option<T> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.closed {
            return Some(frame);
        }
        let old = state.next.replace(frame);
        if old.is_some() {
            state.dropped += 1;
        }
        let reusable = old.or_else(|| state.spare.take());
        self.wake.notify_one();
        reusable
    }
    pub fn take(&self) -> Option<T> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while !state.closed && state.next.is_none() {
            state = self.wake.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        if state.closed {
            None
        } else {
            state.next.take()
        }
    }
    pub fn recycle(&self, frame: T) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.closed {
            state.spare = Some(frame);
        }
    }
    pub fn dropped(&self) -> u64 {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).dropped
    }
    pub fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        state.next = None;
        state.spare = None;
        self.wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slow_consumer_receives_the_latest_frame_without_a_backlog() {
        let queue = Latest::default();
        queue.push(0);
        assert_eq!(queue.take(), Some(0));
        for i in 1..=1000 {
            queue.push(i);
        }
        assert_eq!(queue.take(), Some(1000));
        assert_eq!(queue.dropped(), 999);
        queue.recycle(1000);
        assert_eq!(queue.push(1001), Some(1000));
        queue.close();
        assert_eq!(queue.take(), None);
        assert_eq!(queue.push(1002), Some(1002));
    }
    #[test]
    fn closing_capture_wakes_an_idle_processor() {
        let queue = std::sync::Arc::new(Latest::<Vec<u8>>::default());
        let consumer = queue.clone();
        let thread = std::thread::spawn(move || consumer.take());
        queue.close();
        assert!(thread.join().unwrap().is_none());
    }
}
