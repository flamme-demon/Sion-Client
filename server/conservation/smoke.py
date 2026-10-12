#!/usr/bin/env python3
"""Teste un homeserver éphémère isolé, sans accès à un serveur réel.

Le nettoyage réel n'est activé que dans sa base temporaire. test_clock.c
avance son horloge murale pour vérifier l'expiration et le délai de grâce.
"""
import argparse
import json
import os
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOST = "conservation.invalid"
ROUTE = "/_continuwuity/sion/conservation/v1"
CLIENT = "/_matrix/client/v3"


class Homeserver:
    def __init__(self, binary, folder, clock_library=None):
        self.binary = binary
        self.folder = folder
        self.clock_library = clock_library
        self.process = None
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.base = f"http://127.0.0.1:{self.port}"

    def start(self, applying=False, offset=None, preview_override=False):
        self.stop()
        config = self.folder / "server.toml"
        config.write_text(f'''[global]
server_name = "{HOST}"
address = "127.0.0.1"
port = {self.port}
database_path = "{self.folder / 'database'}"
allow_registration = true
registration_token = "inscription-fictive-test-conservation"
force_disable_first_run_mode = true
allow_federation = false
allow_check_for_updates = false
sion_conservation_enabled = true
sion_conservation_apply = {str(applying).lower()}
log = "warn"
''')
        environment = {k:v for k,v in os.environ.items() if not k.startswith(("CONDUWUIT_", "CONTINUWUITY_", "CONDUIT_"))}
        environment.pop("LD_PRELOAD", None)
        environment.pop("SION_TEST_CLOCK_SECONDS", None)
        if offset:
            if not self.clock_library:
                raise ValueError("Le test du vieillissement nécessite --clock-library")
            environment.update(LD_PRELOAD=str(self.clock_library), SION_TEST_CLOCK_SECONDS=str(int(offset[:-1]) * 86400))
        self.log = (self.folder / "server.log").open("a")
        arguments = [str(self.binary), "--config", str(config), "--worker-threads", "2", "--worker-affinity=false"]
        if preview_override:
            arguments += ["-O", "sion_conservation_enabled=true", "-O", "sion_conservation_apply=false"]
        self.process = subprocess.Popen(arguments, env=environment, stdout=self.log, stderr=self.log)
        for _ in range(100):
            if self.process.poll() is not None:
                raise RuntimeError(f"Le homeserver de test s’est arrêté ; journal local : {self.folder / 'server.log'}")
            try:
                self.request("GET", "/_matrix/client/versions")
                return
            except OSError:
                time.sleep(.2)
        raise RuntimeError("Le homeserver de test ne répond pas")

    def stop(self):
        if self.process:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait()
            self.process = None
            self.log.close()

    def request(self, method, path, body=None, token=None, expected=200, raw=False):
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Content-Type"] = "application/octet-stream" if raw else "application/json"
        request = urllib.request.Request(self.base + path, data=body if raw else json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status, data = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, data = error.code, error.read()
        if status != expected:
            # Ne jamais afficher une réponse d'authentification ni son jeton.
            raise AssertionError(f"{method} {path.split('?')[0]} : HTTP {status}, attendu {expected}")
        return data if raw else json.loads(data or b"{}")

    def register(self, name):
        body = {"username": name, "password": "mot-de-passe-fictif-test-conservation"}
        session = self.request("POST", CLIENT + "/register", body, expected=401)["session"]
        body["auth"] = {"type": "m.login.registration_token", "session": session, "token": "inscription-fictive-test-conservation"}
        return self.request("POST", CLIENT + "/register", body)["access_token"]

    def create(self, token, name, content=None):
        return self.request("POST", CLIENT + "/createRoom", {"name": name, "preset": "private_chat", **(content or {})}, token)["room_id"]

    def state(self, token, room, kind, key, content):
        path = f"{CLIENT}/rooms/{urllib.parse.quote(room, safe='')}/state/{kind}/{urllib.parse.quote(key,safe='')}"
        return self.request("PUT", path, content, token)

    def send(self, token, room, content, txn):
        path = f"{CLIENT}/rooms/{urllib.parse.quote(room,safe='')}/send/m.room.message/{txn}"
        return self.request("PUT", path, content, token)["event_id"]

    def event(self, token, room, event):
        return self.request("GET", f"{CLIENT}/rooms/{urllib.parse.quote(room,safe='')}/event/{urllib.parse.quote(event,safe='')}", token=token)

    def conservation(self, token, scope, action="read", changes=None, revision=None, expected=200):
        body = {"scopeId": scope, "action": action}
        if changes is not None:
            body["changes"] = changes
        if revision is not None:
            body["revision"] = revision
        return self.request("POST", ROUTE, body, token, expected)

    def media(self, token, url, expected=200):
        server, media_id = url.removeprefix("mxc://").split("/", 1)
        self.request("GET", f"/_matrix/client/v1/media/download/{server}/{media_id}", token=token, expected=expected, raw=True)

    def file_exists(self, name):
        content = ("fichier fictif " + name).encode()
        return any(file.is_file() and file.read_bytes() == content for file in (self.folder / "database" / "media").iterdir())


def scenario(server, cleanup):
    server.start()
    admin, member, outsider = (server.register(name) for name in ("admin", "membre", "exterieur"))
    space = server.create(admin, "Equipe fictive", {"creation_content": {"type": "m.space"}})
    chat = server.create(admin, "Conversation fictive")
    board = server.create(admin, "Bibliothèque fictive", {"initial_state": [{"type": "m.room.type", "state_key": "", "content": {"type": "com.sion.board"}}]})
    kept = server.create(admin, "Archives conservées")
    for room in (chat, board, kept):
        server.state(admin, space, "m.space.child", room, {"via": [HOST]})
        server.state(admin, room, "m.space.parent", space, {"via": [HOST], "canonical": True})
    for room in (space, chat):
        server.request("POST", f"{CLIENT}/rooms/{urllib.parse.quote(room,safe='')}/invite", {"user_id": f"@membre:{HOST}"}, admin)
        server.request("POST", f"{CLIENT}/join/{urllib.parse.quote(room,safe='')}", {}, member)
    initial = server.conservation(admin, space)
    server.conservation(None, space, expected=401)
    assert initial["available"] and not initial["applying"]
    assert initial["scope"]["editable"]  # Inclut le créateur des salons v12.
    assert initial["scope"]["policy"] == {"mode": "unlimited"}
    assert next(r for r in initial["rooms"] if r["id"] == board)["protected"]
    assert not server.conservation(member, space)["scope"]["editable"]
    server.conservation(outsider, space, expected=403)
    changes = [{"roomId": space, "policy": {"mode": "days", "days": 90}}, {"roomId": kept, "policy": {"mode": "unlimited"}}]
    server.conservation(member, space, "preview", changes, expected=403)
    server.conservation(admin, space, "save", changes, expected=409)
    server.conservation(admin, space, "preview", [{"roomId": board, "policy": {"mode": "days", "days": 1}}], expected=400)
    preview = server.conservation(admin, space, "preview", changes)
    assert preview["messages"] == 0
    saved = server.conservation(admin, space, "save", changes, preview["revision"])
    assert next(r for r in saved["rooms"] if r["id"] == chat)["effectiveDays"] == 90
    server.conservation(admin, space, "save", changes, preview["revision"], expected=409)
    # Les salons v12 ont un identifiant opaque sans suffixe :serveur.
    inherit = [{"roomId": chat, "policy": {"mode": "inherit", "parent": space}}]
    preview = server.conservation(admin, space, "preview", inherit)
    inherited = server.conservation(admin, space, "save", inherit, preview["revision"])
    assert next(r for r in inherited["rooms"] if r["id"] == chat)["effectiveDays"] == 90
    def upload(name):
        return server.request("POST", "/_matrix/media/v3/upload?filename=" + name, body=("fichier fictif " + name).encode(), token=admin, raw=True)
    def upload_url(name):
        return json.loads(upload(name))["content_uri"]
    obsolete, reused, avatar, library = (upload_url(name) for name in ("expire.txt", "reuse.txt", "avatar.txt", "bibliotheque.txt"))
    assert all(server.file_exists(name) for name in ("expire.txt", "reuse.txt", "avatar.txt", "bibliotheque.txt"))
    def file(url):
        return {"msgtype": "m.file", "body": "Fichier fictif", "url": url}
    old = server.send(admin, chat, file(obsolete), "expire")
    shared = server.send(admin, chat, file(reused), "reuse-chat")
    server.send(admin, kept, file(reused), "reuse-archive")
    portrait = server.send(admin, chat, file(avatar), "portrait")
    server.request("PUT", f"{CLIENT}/profile/{urllib.parse.quote('@admin:'+HOST,safe='')}/avatar_url", {"avatar_url": avatar}, admin)
    sound = server.send(admin, board, {**file(library), "com.sion.soundboard": {"name": "Son fictif"}}, "son")
    pin = server.send(admin, chat, {"msgtype": "m.text", "body": "Message épinglé fictif"}, "pin")
    server.state(admin, chat, "m.room.pinned_events", "", {"pinned": [pin]})
    assert "url" in server.event(admin, chat, old)["content"]
    print("API : authentification, droits v12, héritage, bibliothèque protégée et révision obligatoire vérifiés.", flush=True)
    if not cleanup:
        return
    server.start(applying=True, offset="+100d", preview_override=True)
    assert not server.conservation(admin, space)["applying"]
    for _ in range(40):
        if server.conservation(admin, space)["lastRun"] is not None:
            break
        time.sleep(.2)
    assert "url" in server.event(admin, chat, old)["content"]
    changed = [{"roomId": space, "policy": {"mode": "days", "days": 91}}]
    aged = server.conservation(admin, space, "preview", changed)
    assert aged["messages"] == 3 and aged["files"] == 1, aged
    print("Aperçu avec messages expirés : 3 messages, 1 fichier supprimable ; réutilisation, avatar, épingle et bibliothèque conservés.", flush=True)
    server.start(applying=True, offset="+100d")
    for _ in range(100):
        if all("url" not in server.event(admin, chat, event)["content"] for event in (old, shared, portrait)):
            break
        time.sleep(.2)
    assert "url" not in server.event(admin, chat, old)["content"]
    assert "url" not in server.event(admin, chat, shared)["content"]
    assert "url" not in server.event(admin, chat, portrait)["content"]
    assert "url" in server.event(admin, board, sound)["content"]
    assert server.event(admin, chat, pin)["content"]["body"] == "Message épinglé fictif"
    for url in (obsolete, reused, avatar, library):
        server.media(admin, url)  # Aucun fichier supprimé avant les 48 heures.
    assert server.file_exists("expire.txt")
    server.start(applying=True, offset="+103d")
    for _ in range(100):
        if not server.file_exists("expire.txt"):
            break
        time.sleep(.2)
    assert not server.file_exists("expire.txt")
    # La route média amont transforme l'absence de métadonnées en M_UNKNOWN
    # HTTP 400. Vérifier aussi l'effacement physique, pas seulement ce code.
    server.media(admin, obsolete, expected=400)
    server.media(admin, reused); server.media(admin, avatar); server.media(admin, library)
    assert all(server.file_exists(name) for name in ("reuse.txt", "avatar.txt", "bibliotheque.txt"))
    print("Nettoyage éphémère : redactions Matrix, délai de grâce et suppression du seul média expiré sans référence vérifiés.", flush=True)
    # L'état de chiffrement suffit à rendre les références opaques. Le média
    # suivant devra survivre, même une fois son propre message expiré/redacté.
    encrypted = server.create(admin, "Salon chiffré fictif")
    server.state(admin, encrypted, "m.room.encryption", "", {"algorithm": "m.megolm.v1.aes-sha2"})
    uncertain = upload_url("incertain.txt")
    protected = server.send(admin, chat, file(uncertain), "incertain")
    server.start(applying=True, offset="+203d")
    for _ in range(100):
        if "url" not in server.event(admin, chat, protected)["content"]:
            break
        time.sleep(.2)
    assert "url" not in server.event(admin, chat, protected)["content"]
    server.start(applying=True, offset="+206d")
    server.media(admin, uncertain)
    assert server.file_exists("incertain.txt")
    print("Chiffrement : média conservé lorsque ses références ne peuvent pas être prouvées.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--cleanup", action="store_true", help="Tester le nettoyage réel uniquement dans la base temporaire")
    parser.add_argument("--clock-library", type=Path, help="Bibliothèque de test_clock.c, nécessaire pour --cleanup")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="sion-conservation-smoke-") as path:
        server = Homeserver(args.binary.resolve(), Path(path), args.clock_library.resolve() if args.clock_library else None)
        try:
            scenario(server, args.cleanup)
        except BaseException:
            # Le journal ne contient que les données fictives de ce serveur.
            if (server.folder / "server.log").exists():
                print((server.folder / "server.log").read_text()[-4000:])
            raise
        finally:
            server.stop()
