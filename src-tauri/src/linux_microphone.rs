//! Confirm the actual recording route, including PipeWire's asynchronous links.
//! A successful PulseAudio move alone does not prove that capture is connected.
use serde_json::Value;
use std::{collections::HashSet, process::Command, time::Duration};

trait Backend {
    fn run(&mut self, tool: &str, args: &[&str]) -> Result<String, String>;
    fn wait(&mut self);
}

struct System;
impl Backend for System {
    fn run(&mut self, tool: &str, args: &[&str]) -> Result<String, String> {
        let output = Command::new(tool)
            .args(args)
            .output()
            .map_err(|e| format!("{tool}: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "{tool}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        String::from_utf8(output.stdout).map_err(|e| e.to_string())
    }
    fn wait(&mut self) {
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn number(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .or_else(|| value.as_str()?.parse().ok())
}
fn objects(json: &str) -> Result<Vec<Value>, String> {
    serde_json::from_str(json).map_err(|e| format!("état audio illisible : {e}"))
}
fn ours(stream: &Value, pid: u32) -> bool {
    let props = &stream["properties"];
    props["application.process.binary"] == "sion-client"
        && props["media.name"] == "recStream"
        && number(&props["application.process.id"]) == Some(pid)
}

pub(crate) fn route(target: &str) -> Result<(), String> {
    route_with(&mut System, target, std::process::id())
}

fn route_with(backend: &mut impl Backend, target: &str, pid: u32) -> Result<(), String> {
    let sources = objects(&backend.run("pactl", &["-f", "json", "list", "sources"])?)?;
    let source = sources
        .iter()
        .find(|s| s["name"] == target && !target.ends_with(".monitor"))
        .ok_or_else(|| format!("source microphone indisponible : {target}"))?;
    let source_index = number(&source["index"]).ok_or("index source microphone invalide")?;
    let mut moved = HashSet::new();
    let mut repaired = HashSet::new();
    let mut confirmed = None;
    let mut last_error = "flux microphone WebRTC absent ou sans source".to_string();

    // Await linking rather than report success while the source is still UINT32_MAX.
    // Require three consecutive confirmations to let the new ADM ports settle.
    for attempt in 0..40 {
        let streams = objects(&backend.run("pactl", &["-f", "json", "list", "source-outputs"])?)?;
        let stream = streams
            .iter()
            .filter(|s| ours(s, pid))
            .filter_map(|s| number(&s["index"]).map(|index| (index, s)))
            .max_by_key(|(index, _)| *index);
        if let Some((index, stream)) = stream {
            if number(&stream["source"]) == Some(source_index) {
                let count = match confirmed {
                    Some((old, count)) if old == index => count + 1,
                    _ => 1,
                };
                confirmed = Some((index, count));
                if count == 3 {
                    log::info!(
                        "[Sion][voix-native] micro raccordé source-output={index} source={target}"
                    );
                    return Ok(());
                }
            } else {
                confirmed = None;
                if moved.insert(index) {
                    backend.run("pactl", &["move-source-output", &index.to_string(), target])?;
                } else if attempt >= 10
                    && !repaired.contains(&index)
                    && number(&stream["source"]).is_none_or(|s| s == u32::MAX)
                {
                    repaired.insert(index);
                    // A repeated move to the same target can be a no-op in PipeWire.
                    // Repair only the detached recStream owned by this Sion process.
                    match repair_pipewire(backend, source, stream) {
                        Ok(()) => {
                            log::warn!("[Sion][voix-native] raccordement PipeWire micro réparé source-output={index}");
                        }
                        Err(error) => last_error = error,
                    }
                }
            }
        } else {
            confirmed = None;
        }
        if attempt < 39 {
            backend.wait();
        }
    }
    log::warn!("[Sion][voix-native] raccordement micro échoué source={target}: {last_error}");
    Err(
        "Impossible de raccorder le microphone sélectionné. Réessaie ou choisis un autre micro."
            .into(),
    )
}

fn repair_pipewire(
    backend: &mut impl Backend,
    source: &Value,
    stream: &Value,
) -> Result<(), String> {
    let graph = objects(&backend.run("pw-dump", &["-i", "0"])?)?;
    let node = |pulse: &Value| -> Result<u32, String> {
        let id = number(&pulse["properties"]["object.id"]).ok_or("nœud PipeWire absent")?;
        let serial = number(&pulse["index"]).ok_or("identifiant PulseAudio absent")?;
        graph
            .iter()
            .find(|o| {
                number(&o["id"]) == Some(id)
                    && o["type"] == "PipeWire:Interface:Node"
                    && number(&o["info"]["props"]["object.serial"]) == Some(serial)
            })
            .ok_or("nœud PipeWire remplacé pendant le changement de micro")?;
        Ok(id)
    };
    let source_node = node(source)?;
    let stream_node = node(stream)?;
    if graph.iter().any(|o| {
        o["type"] == "PipeWire:Interface:Link"
            && number(&o["info"]["input-node-id"]) == Some(stream_node)
    }) {
        return Err("le raccordement PipeWire est encore en cours".into());
    }
    let ports = |id: u32, direction: &str| -> Vec<&Value> {
        graph
            .iter()
            .filter(|o| {
                o["type"] == "PipeWire:Interface:Port"
                    && number(&o["info"]["props"]["node.id"]) == Some(id)
                    && o["info"]["direction"] == direction
            })
            .collect()
    };
    let inputs = ports(stream_node, "input");
    let outputs = ports(source_node, "output");
    if inputs.is_empty() {
        return Err("ports microphone PipeWire absents".into());
    }
    let mut pairs = Vec::new();
    for input in inputs {
        let channel = input["info"]["props"]["audio.channel"]
            .as_str()
            .ok_or("canal microphone PipeWire absent")?;
        let matching: Vec<_> = outputs
            .iter()
            .filter(|o| o["info"]["props"]["audio.channel"] == channel)
            .collect();
        if matching.len() != 1 {
            return Err("canaux microphone PipeWire incompatibles".into());
        }
        pairs.push((
            number(&matching[0]["id"]).ok_or("port source invalide")?,
            number(&input["id"]).ok_or("port microphone invalide")?,
        ));
    }
    let mut created: Vec<(u32, u32)> = Vec::new();
    for (output, input) in pairs {
        if let Err(error) = backend.run("pw-link", &["-w", &output.to_string(), &input.to_string()])
        {
            // Roll back only our new links if a later channel fails.
            for (output, input) in created {
                let _ = backend.run("pw-link", &["-d", &output.to_string(), &input.to_string()]);
            }
            return Err(error);
        }
        created.push((output, input));
    }
    // pw-link links linger until either ADM/source port disappears. No helper
    // process or timer survives capture teardown, mute, or voice disconnect.
    Ok(())
}

#[cfg(test)]
#[path = "linux_microphone/tests.rs"]
mod tests;
