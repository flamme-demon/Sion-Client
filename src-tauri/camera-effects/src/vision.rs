use anyhow::{anyhow, ensure};
use std::{
    io::Cursor,
    sync::{Arc, Condvar, Mutex},
    thread::JoinHandle,
    time::Instant,
};
use tract_onnx::prelude::*;

type Model = Arc<TypedRunnableModel>;
pub const PERSON_SIZE: usize = 256;
#[derive(Clone, Debug)]
pub struct Face {
    pub rect: [f32; 4],
    pub points: [[f32; 2]; 5],
}
#[derive(Clone, Default)]
pub struct Analysis {
    pub face: Option<Face>,
    pub face_analyzed: bool,
    pub finished: Option<Instant>,
    pub elapsed_ms: f32,
    pub error: Option<String>,
}
struct State {
    next: Option<Vec<f32>>,
    stop: bool,
}
pub struct Worker {
    queue: Arc<(Mutex<State>, Condvar)>,
    pub result: Arc<Mutex<Analysis>>,
    thread: Option<JoinHandle<()>>,
}

fn model(bytes: &[u8], size: usize) -> TractResult<(Model, Vec<String>)> {
    let onnx = tract_onnx::onnx();
    let mut proto = onnx.proto_model_for_read(&mut Cursor::new(bytes))?;
    // Recalculer les annotations : batch symbolique du modèle Selfie et
    // dimensions 640p de YuNet. Les poids restent inchangés.
    {
        let graph = proto
            .graph
            .as_mut()
            .ok_or_else(|| anyhow!("Graphe du modèle absent"))?;
        graph.value_info.clear();
        for value in graph.input.iter_mut().chain(graph.output.iter_mut()) {
            if let Some(tract_onnx::pb::type_proto::Value::TensorType(tensor)) =
                value.r#type.as_mut().and_then(|t| t.value.as_mut())
            {
                tensor.shape = None;
            }
        }
    }
    let graph = onnx
        .model_for_proto_model(&proto)?
        .with_input_fact(0, f32::fact([1, 3, size, size]).into())?;
    let names = graph
        .output_outlets()?
        .iter()
        .map(|o| graph.outlet_label(*o).unwrap_or("").to_owned())
        .collect();
    Ok((graph.into_optimized()?.into_runnable()?, names))
}
fn run(model: &Model, input: Vec<f32>, size: usize) -> TractResult<TVec<TValue>> {
    model.run(tvec!(
        Tensor::from_shape(&[1, 3, size, size], &input)?.into()
    ))
}
fn mask(model: &Model, input: Vec<f32>) -> TractResult<Vec<f32>> {
    let output = run(model, input, PERSON_SIZE)?;
    let values = output[0].to_plain_array_view::<f32>()?;
    ensure!(
        values.shape() == [1, 1, PERSON_SIZE, PERSON_SIZE],
        "Format du modèle de détourage inattendu"
    );
    let data = values
        .as_slice()
        .ok_or_else(|| anyhow!("Masque non contigu"))?;
    ensure!(data.iter().all(|p| p.is_finite()), "Masque invalide");
    Ok(data
        .iter()
        .map(|p| {
            // Transition courte autour de la décision personne/fond. Aucun
            // ancien masque ne doit laisser le fond net après un mouvement.
            let p = ((p - 0.45) / 0.1).clamp(0.0, 1.0);
            p * p * (3.0 - 2.0 * p)
        })
        .collect())
}

pub struct PersonSegmenter {
    model: Result<Model, String>,
}
impl PersonSegmenter {
    pub fn new() -> Self {
        Self {
            model: model(
                include_bytes!("../../resources/camera/person.onnx"),
                PERSON_SIZE,
            )
            .map(|(model, _)| model)
            .map_err(|error| format!("{error:#}")),
        }
    }
    pub fn segment(&self, input: Vec<f32>) -> TractResult<Vec<f32>> {
        let model = self.model.as_ref().map_err(|error| anyhow!("{error}"))?;
        mask(model, input)
    }
}
fn face(model: &Model, names: &[String], input: Vec<f32>) -> TractResult<Option<Face>> {
    let output = run(model, input, 320)?;
    let arrays = output
        .iter()
        .map(|value| value.to_plain_array_view::<f32>())
        .collect::<TractResult<Vec<_>>>()?;
    let mut best: Option<(f32, Face)> = None;
    for stride in [8, 16, 32] {
        let get = |prefix: &str| -> TractResult<&[f32]> {
            let index = names
                .iter()
                .position(|n| n == &format!("{prefix}_{stride}"))
                .ok_or_else(|| anyhow!("Sortie YuNet absente : {prefix}_{stride}"))?;
            arrays[index]
                .as_slice()
                .ok_or_else(|| anyhow!("Sortie YuNet non contiguë"))
        };
        let (cls, obj, bbox, points) = (get("cls")?, get("obj")?, get("bbox")?, get("kps")?);
        let side = 320 / stride;
        for i in 0..side * side {
            let score = (cls[i].clamp(0.0, 1.0) * obj[i].clamp(0.0, 1.0)).sqrt();
            if score < 0.7 {
                continue;
            }
            let (x, y) = ((i % side) as f32, (i / side) as f32);
            let unit = stride as f32 / 320.0;
            let (w, h) = (bbox[i * 4 + 2].exp() * unit, bbox[i * 4 + 3].exp() * unit);
            let weight = score * (w * h).sqrt();
            if best.as_ref().is_some_and(|(old, _)| *old >= weight) {
                continue;
            }
            let mut keypoints = [[0.0; 2]; 5];
            for p in 0..5 {
                keypoints[p] = [
                    (x + points[i * 10 + 2 * p]) * unit,
                    (y + points[i * 10 + 2 * p + 1]) * unit,
                ];
            }
            best = Some((
                weight,
                Face {
                    rect: [
                        (x + bbox[i * 4]) * unit - w / 2.0,
                        (y + bbox[i * 4 + 1]) * unit - h / 2.0,
                        w,
                        h,
                    ],
                    points: keypoints,
                },
            ));
        }
    }
    Ok(best.map(|(_, face)| face))
}

impl Worker {
    pub fn new() -> Self {
        let queue = Arc::new((
            Mutex::new(State {
                next: None,
                stop: false,
            }),
            Condvar::new(),
        ));
        let result = Arc::new(Mutex::new(Analysis::default()));
        let (q, out) = (queue.clone(), result.clone());
        let thread = std::thread::Builder::new()
            .name("sion-camera-face".into())
            .spawn(move || {
                let mut face_model: Option<(Model, Vec<String>)> = None;
                loop {
                    let request = {
                        let (lock, wake) = &*q;
                        let mut state = lock.lock().unwrap_or_else(|e| e.into_inner());
                        while !state.stop && state.next.is_none() {
                            state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
                        }
                        if state.stop {
                            break;
                        }
                        state.next.take().unwrap()
                    };
                    let started = Instant::now();
                    let process = || -> TractResult<Analysis> {
                        if face_model.is_none() {
                            face_model = Some(model(
                                include_bytes!("../../resources/camera/face.onnx"),
                                320,
                            )?);
                        }
                        let (model, names) = face_model.as_ref().unwrap();
                        Ok(Analysis {
                            face: face(model, names, request)?,
                            face_analyzed: true,
                            finished: Some(Instant::now()),
                            elapsed_ms: started.elapsed().as_secs_f32() * 1000.0,
                            error: None,
                        })
                    };
                    match process() {
                        Ok(analysis) => *out.lock().unwrap_or_else(|e| e.into_inner()) = analysis,
                        Err(error) => {
                            out.lock().unwrap_or_else(|e| e.into_inner()).error =
                                Some(format!("Effets webcam : {error}"));
                            break;
                        }
                    }
                }
            })
            .ok();
        if thread.is_none() {
            result.lock().unwrap().error =
                Some("Le traitement du visage n'a pas pu démarrer.".into());
        }
        Self {
            queue,
            result,
            thread,
        }
    }
    pub fn submit(&self, request: Vec<f32>) {
        let (lock, wake) = &*self.queue;
        lock.lock().unwrap_or_else(|e| e.into_inner()).next = Some(request);
        wake.notify_one();
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let (lock, wake) = &*self.queue;
        let mut state = lock.lock().unwrap_or_else(|e| e.into_inner());
        state.stop = true;
        state.next = None;
        drop(state);
        wake.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
