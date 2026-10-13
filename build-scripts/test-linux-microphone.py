#!/usr/bin/env python3
"""Test recording-route recovery on an isolated PipeWire graph with synthetic audio."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    for tool in ("cargo", "pipewire", "pw-dump", "pw-link", "pw-cli"):
        if not shutil.which(tool):
            raise RuntimeError(f"Missing test dependency: {tool}")
    repo = Path(__file__).resolve().parent.parent
    configuration = """
context.properties = { core.daemon = true core.name = sion-mic-test }
context.spa-libs = {
    support.* = support/libspa-support
    audio.convert.* = audioconvert/libspa-audioconvert
}
context.modules = [
    { name = libpipewire-module-protocol-native }
    { name = libpipewire-module-spa-node-factory }
    { name = libpipewire-module-client-node }
    { name = libpipewire-module-access }
    { name = libpipewire-module-adapter }
    { name = libpipewire-module-link-factory }
]
context.objects = [
    { factory = spa-node-factory args = {
        factory.name = support.node.driver node.name = Dummy-Driver
        node.group = pipewire.dummy priority.driver = 20000
    } }
    { factory = adapter args = {
        factory.name = support.null-audio-sink node.name = test-mic
        media.class = Audio/Source/Virtual audio.channels = 1
        audio.position = [ MONO ] node.always-process = true
        adapter.auto-port-config = { mode = dsp monitor = true position = preserve }
    } }
"""
    for index in range(3):
        configuration += """
    { factory = adapter args = {
        factory.name = support.null-audio-sink node.name = test-rec-%d
        media.class = Stream/Input/Audio audio.channels = 1
        audio.position = [ MONO ] node.always-process = true
        adapter.auto-port-config = { mode = dsp position = preserve }
    } }
""" % index
    configuration += "]\n"
    with tempfile.TemporaryDirectory(prefix="sion-mic-fixture-") as temporary:
        folder = Path(temporary)
        (folder / "fixture.conf").write_text(configuration)
        module = json.dumps(str(repo / "src-tauri/src/linux_microphone.rs"))
        manifest = folder / "Cargo.toml"
        manifest.write_text(f"""[package]
name = "sion-linux-microphone-check"
version = "0.1.0"
edition = "2021"
[lib]
path = {module}
[dependencies]
serde_json = "1"
log = "0.4"
""")
        env = dict(os.environ, XDG_RUNTIME_DIR=temporary,
                   PIPEWIRE_CONFIG_DIR=temporary, PIPEWIRE_REMOTE="sion-mic-test")
        with (folder / "daemon.log").open("w") as log:
            daemon = subprocess.Popen(["pipewire", "-c", "fixture.conf"],
                                      env=env, stdout=log, stderr=log)
            try:
                for _ in range(40):
                    if (folder / "sion-mic-test").exists():
                        break
                    if daemon.poll() is not None:
                        raise RuntimeError((folder / "daemon.log").read_text())
                    time.sleep(0.05)
                # Clients use the installed client.conf, while connecting only
                # to the isolated daemon in this private runtime directory.
                env.pop("PIPEWIRE_CONFIG_DIR")
                graph = json.loads(subprocess.check_output(
                    ["pw-dump", "-i", "0"], env=env, timeout=5))
                nodes = [o for o in graph if o["type"] == "PipeWire:Interface:Node"]
                source = next(o for o in nodes if o["info"]["props"].get("node.name") == "test-mic")
                streams = [o for o in nodes if o["info"]["props"].get("node.name", "").startswith("test-rec-")]

                def pulse(node):
                    return {"index": node["info"]["props"]["object.serial"],
                            "properties": {"object.id": str(node["id"])}}

                fixture = folder / "fixture.json"
                fixture.write_text(json.dumps({"source": pulse(source),
                                               "streams": [pulse(o) for o in streams]}))
                env["SION_PIPEWIRE_ROUTE_FIXTURE"] = str(fixture)
                subprocess.run([
                    "cargo", "test", "--offline", "--manifest-path", str(manifest),
                    "--target-dir", str(repo / "src-tauri/target/microphone-routing-tests"),
                    "--", "--include-ignored",
                ], env=env, check=True, timeout=60)
            finally:
                daemon.terminate()
                try:
                    daemon.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    daemon.kill()
                    daemon.wait()


if __name__ == "__main__":
    main()
