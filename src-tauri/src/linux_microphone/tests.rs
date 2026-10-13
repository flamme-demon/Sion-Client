use super::*;
use serde_json::json;

const PID: u32 = 1234;
const TARGET: &str = "alsa_input.usb-headset.mono";
fn source() -> Value {
    json!({"index":79,"name":TARGET,"properties":{"object.id":"79"}})
}
fn stream(index: u32, source: u32, pid: u32) -> Value {
    json!({"index":index,"source":source,"properties":{"object.id":"647", "application.process.id":pid.to_string(),"application.process.binary":"sion-client","media.name":"recStream"}})
}
fn node(id: u32, serial: u32) -> Value {
    json!({"id":id,"type":"PipeWire:Interface:Node","info":{"props":{"object.serial":serial}}})
}
fn port(id: u32, node: u32, direction: &str, channel: &str) -> Value {
    json!({"id":id,"type":"PipeWire:Interface:Port","info":{"direction":direction,"props":{"node.id":node,"audio.channel":channel}}})
}
struct Fake {
    streams: Vec<Value>,
    graph: Vec<Value>,
    commands: Vec<(String, Vec<String>)>,
    move_connects: bool,
    link_connects: bool,
    ticks: u32,
    new_stream: Option<Value>,
    delayed_connection: bool,
    fail_input: Option<u32>,
}
impl Fake {
    fn detached() -> Self {
        Self {
            streams: vec![stream(150639, u32::MAX, PID)],
            graph: vec![
                node(79, 79),
                node(647, 150639),
                port(90, 79, "output", "MONO"),
                port(653, 647, "input", "MONO"),
            ],
            commands: vec![],
            move_connects: false,
            link_connects: true,
            ticks: 0,
            new_stream: None,
            delayed_connection: false,
            fail_input: None,
        }
    }
}
impl Backend for Fake {
    fn run(&mut self, tool: &str, args: &[&str]) -> Result<String, String> {
        self.commands
            .push((tool.into(), args.iter().map(|s| s.to_string()).collect()));
        match (tool, args) {
            ("pactl", ["-f", "json", "list", "sources"]) => Ok(json!([source()]).to_string()),
            ("pactl", ["-f", "json", "list", "source-outputs"]) => {
                Ok(json!(self.streams).to_string())
            }
            ("pactl", ["move-source-output", index, _]) => {
                if self.move_connects {
                    self.streams
                        .iter_mut()
                        .find(|s| number(&s["index"]) == index.parse().ok())
                        .unwrap()["source"] = json!(79);
                }
                Ok(String::new())
            }
            ("pw-dump", _) => Ok(json!(self.graph).to_string()),
            ("pw-link", ["-w", _, input]) => {
                if self.fail_input == input.parse().ok() {
                    return Err("link failed".into());
                }
                if self.link_connects {
                    self.streams[0]["source"] = json!(79);
                }
                Ok(String::new())
            }
            ("pw-link", ["-d", _, _]) => Ok(String::new()),
            _ => panic!("unexpected command {tool} {args:?}"),
        }
    }
    fn wait(&mut self) {
        self.ticks += 1;
        if self.ticks == 2 {
            if let Some(stream) = self.new_stream.take() {
                self.streams[0] = stream;
            }
        }
        if self.delayed_connection && self.ticks == 5 {
            self.streams[0]["source"] = json!(79);
        }
    }
}
#[test]
fn false_success_of_pulse_move_repairs_the_detached_recording_link() {
    let mut backend = Fake::detached();
    route_with(&mut backend, TARGET, PID).unwrap();
    assert_eq!(backend.streams[0]["source"], 79);
    assert_eq!(
        backend
            .commands
            .iter()
            .filter(|(tool, _)| tool == "pw-link")
            .collect::<Vec<_>>(),
        vec![&(
            "pw-link".into(),
            vec!["-w".into(), "90".into(), "653".into()]
        )]
    );
}
#[test]
fn normal_pulseaudio_and_delayed_pipewire_linking_need_no_manual_links() {
    for delayed in [false, true] {
        let mut backend = Fake::detached();
        backend.move_connects = !delayed;
        backend.delayed_connection = delayed;
        route_with(&mut backend, TARGET, PID).unwrap();
        assert!(!backend
            .commands
            .iter()
            .any(|(tool, _)| tool.starts_with("pw-")));
    }
}
#[test]
fn stream_recreated_during_republication_is_routed_to_the_same_source() {
    let mut backend = Fake::detached();
    backend.new_stream = Some(stream(150700, u32::MAX, PID));
    backend.delayed_connection = true;
    route_with(&mut backend, TARGET, PID).unwrap();
    let moved: Vec<_> = backend
        .commands
        .iter()
        .filter(|(_, args)| args.first().is_some_and(|a| a == "move-source-output"))
        .map(|(_, args)| args[1].as_str())
        .collect();
    assert_eq!(moved, vec!["150639", "150700"]);
}
#[test]
fn no_other_sion_process_or_non_webrtc_capture_is_rerouted() {
    let mut backend = Fake::detached();
    backend.streams[0]["properties"]["application.process.id"] = json!("5678");
    let mut other = stream(150800, u32::MAX, PID);
    other["properties"]["media.name"] = json!("another recording");
    backend.streams.push(other);
    assert!(route_with(&mut backend, TARGET, PID).is_err());
    assert!(!backend
        .commands
        .iter()
        .any(|(tool, args)| tool == "pw-link"
            || args.first().is_some_and(|a| a == "move-source-output")));
}
#[test]
fn replaced_nodes_and_existing_links_are_not_overwritten() {
    for existing in [false, true] {
        let mut backend = Fake::detached();
        if existing {
            backend.graph.push(
                json!({"id":700,"type":"PipeWire:Interface:Link","info":{"input-node-id":647}}),
            );
        } else {
            backend.graph[1] = node(647, 150900);
        }
        assert!(route_with(&mut backend, TARGET, PID).is_err());
        assert!(!backend.commands.iter().any(|(tool, _)| tool == "pw-link"));
    }
}
#[test]
fn failed_verification_returns_error_even_if_link_command_succeeds() {
    let mut backend = Fake::detached();
    backend.link_connects = false;
    assert!(route_with(&mut backend, TARGET, PID).is_err());
    assert!(backend.ticks <= 39);
}
#[test]
fn incompatible_channels_are_not_connected_and_partial_links_are_rolled_back() {
    let mut backend = Fake::detached();
    backend.graph[2] = port(90, 79, "output", "FL");
    assert!(repair_pipewire(&mut backend, &source(), &stream(150639, u32::MAX, PID)).is_err());
    assert!(!backend.commands.iter().any(|(tool, _)| tool == "pw-link"));
    backend.graph = vec![
        node(79, 79),
        node(647, 150639),
        port(90, 79, "output", "FL"),
        port(91, 79, "output", "FR"),
        port(653, 647, "input", "FL"),
        port(654, 647, "input", "FR"),
    ];
    backend.fail_input = Some(654);
    assert!(repair_pipewire(&mut backend, &source(), &stream(150639, u32::MAX, PID)).is_err());
    assert_eq!(
        backend.commands.last().unwrap(),
        &(
            "pw-link".into(),
            vec!["-d".into(), "90".into(), "653".into()]
        )
    );
}

#[test]
#[ignore = "requires an isolated PipeWire daemon with synthetic audio nodes"]
fn real_pipewire_links_are_active_and_disappear_with_capture() {
    assert_eq!(std::env::var("PIPEWIRE_REMOTE").unwrap(), "sion-mic-test");
    let path = std::env::var("SION_PIPEWIRE_ROUTE_FIXTURE").unwrap();
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut backend = System;
    assert_eq!(fixture["streams"].as_array().unwrap().len(), 3);
    let initial = objects(&backend.run("pw-dump", &["-i", "0"]).unwrap()).unwrap();
    for pulse in std::iter::once(&fixture["source"]).chain(fixture["streams"].as_array().unwrap()) {
        let id = number(&pulse["properties"]["object.id"]).unwrap();
        let name = initial
            .iter()
            .find(|o| number(&o["id"]) == Some(id))
            .unwrap()["info"]["props"]["node.name"]
            .as_str()
            .unwrap();
        assert!(
            name == "test-mic" || name.starts_with("test-rec-"),
            "only synthetic fixture nodes may be changed"
        );
    }
    for stream in fixture["streams"].as_array().unwrap() {
        let id = number(&stream["properties"]["object.id"]).unwrap();
        repair_pipewire(&mut backend, &fixture["source"], stream).unwrap();
        let mut active = false;
        for _ in 0..20 {
            let graph = objects(&backend.run("pw-dump", &["-i", "0"]).unwrap()).unwrap();
            active = graph.iter().any(|o| {
                o["type"] == "PipeWire:Interface:Link"
                    && number(&o["info"]["input-node-id"]) == Some(id)
                    && o["info"]["state"] == "active"
            });
            if active {
                break;
            }
            backend.wait();
        }
        assert!(active, "the repaired recording link must carry audio");
        backend
            .run("pw-cli", &["destroy", &id.to_string()])
            .unwrap();
        backend.wait();
        let graph = objects(&backend.run("pw-dump", &["-i", "0"]).unwrap()).unwrap();
        assert!(
            !graph.iter().any(|o| o["type"] == "PipeWire:Interface:Link"
                && number(&o["info"]["input-node-id"]) == Some(id)),
            "capture teardown must remove the repair link"
        );
    }
}
