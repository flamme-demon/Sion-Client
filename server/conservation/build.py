#!/usr/bin/env python3
"""Prépare une compilation Debian 13 sans toucher au homeserver actif."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

from prepare import prepare

HERE = Path(__file__).resolve().parent
SOURCE_URL = "https://forgejo.ellis.link/continuwuation/continuwuity/archive/046074bbc.tar.gz"


def extract(archive, destination):
    manifest = json.loads((HERE / "source-manifest.json").read_text())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["archiveSha256"]:
        raise ValueError("L’archive ne correspond pas au commit officiel vérifié")
    with tarfile.open(archive) as source:
        source.extractall(destination, filter="data")
    candidates = list(destination.glob("*/Cargo.toml"))
    if len(candidates) != 1:
        raise ValueError("Archive source inattendue")
    return candidates[0].parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Nouveau dossier de compilation")
    parser.add_argument("--archive", type=Path, help="Archive du commit officiel déjà téléchargée")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(exist_ok=False, parents=True)
    archive = args.archive
    if archive is None:
        archive = output / "continuwuity-source.tar.gz"
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as remote, archive.open("wb") as local:
            shutil.copyfileobj(remote, local)
    extracted = output / "upstream"
    extracted.mkdir()
    source = extract(archive, extracted)
    prepare(source)
    source.rename(output / "source")
    shutil.copyfile(HERE / "Dockerfile", output / "Dockerfile")
    shutil.copyfile(HERE / "smoke.py", output / "smoke.py")
    shutil.copyfile(HERE / "test_clock.c", output / "test_clock.c")
    if args.prepare_only:
        print(f"Sources vérifiées et préparées : {output}")
        return
    subprocess.run(["docker", "build", "--target", "artifact", "--output", f"type=local,dest={output / 'artifact'}", str(output)], check=True)
    print(f"Binaire Debian 13 et empreinte : {output / 'artifact'}. Rien n’est installé sur le serveur.")


if __name__ == "__main__":
    main()
