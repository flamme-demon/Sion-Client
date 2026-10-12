#!/usr/bin/env python3
"""Installe l’extension en mode aperçu uniquement ; jamais de nettoyage réel.

Sans --apply : vérifications en lecture seule. Nécessite root pour --apply.
Conserve le binaire fourni par Debian et les credentials du service existant.
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

SERVICE = "conduwuit"
DROPIN = Path("/etc/systemd/system/conduwuit.service.d/90-sion-conservation.conf")
INSTALL = Path("/opt/sion-conservation")
BACKUPS = Path("/var/backups")
MARKER = "046074bbc-sion-conservation-v1"


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def checksum(binary):
    expected_file = binary.parent / "SHA256SUMS"
    expected = expected_file.read_text().strip().split()
    if len(expected) != 2 or expected[1] != "conduwuit" or not re.fullmatch(r"[0-9a-f]{64}", expected[0]):
        raise ValueError("SHA256SUMS inattendu")
    actual = hashlib.sha256(binary.read_bytes()).hexdigest()
    if actual != expected[0]:
        raise ValueError("L’empreinte du binaire ne correspond pas")
    return actual


def dropin(binary):
    return ("[Service]\nExecStart=\n"
            f"ExecStart={binary} --config ${{CREDENTIALS_DIRECTORY}}/conduwuit.toml "
            "-O sion_conservation_enabled=true -O sion_conservation_apply=false\n")


def active(health_url):
    if command("systemctl", "is-active", SERVICE) != "active":
        return False
    with urllib.request.urlopen(health_url, timeout=3) as response:
        return response.status == 200


def install(binary, digest, health_url):
    if os.geteuid() != 0:
        raise ValueError("--apply nécessite root")
    if DROPIN.is_symlink() or INSTALL.is_symlink():
        raise ValueError("Chemin d’installation symbolique inattendu")
    backup = Path(tempfile.mkdtemp(prefix="sion-conservation-", dir=BACKUPS))
    previous = backup / "90-sion-conservation.conf"
    if DROPIN.exists():
        shutil.copy2(DROPIN, previous)
    target = INSTALL / digest / "conduwuit"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binary, target)
    target.chmod(0o755)
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError("L’empreinte du binaire installé a changé pendant la copie")
    # Une seule ligne ExecStart, les credentials et les limites restent dans
    # l’unité originale. L’override CLI impose apply=false sur tout env/TOML.
    DROPIN.parent.mkdir(parents=True, exist_ok=True)
    try:
        DROPIN.write_text(dropin(target))
        DROPIN.chmod(0o644)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "restart", SERVICE], check=True)
        for _ in range(30):
            try:
                if active(health_url):
                    pid = command("systemctl", "show", SERVICE, "--property=MainPID", "--value")
                    if not pid.isdigit() or Path(f"/proc/{pid}/exe").resolve() != target:
                        raise RuntimeError("Le service utilise un autre binaire que l’extension prévue")
                    print(f"Extension installée en mode aperçu ; aucune suppression. Sauvegarde de l’override : {backup}")
                    return
            except (subprocess.CalledProcessError, OSError):
                pass
            time.sleep(1)
        raise RuntimeError("Le contrôle HTTP du service a échoué")
    except BaseException:
        if previous.exists():
            shutil.copy2(previous, DROPIN)
        else:
            DROPIN.unlink(missing_ok=True)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "restart", SERVICE], check=True)
        print("Override précédent restauré. Le binaire Debian /usr/bin/conduwuit est conservé.")
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--health-url", default="http://127.0.0.1:6167/_matrix/client/versions")
    args = parser.parse_args()
    binary = args.binary.resolve()
    digest = checksum(binary)
    version = command(str(binary), "--version")
    if version != f"continuwuity 26.9.1 ({MARKER})":
        raise ValueError("Binaire d’extension ou version inattendus")
    installed_version = command("/usr/bin/conduwuit", "--version")
    if installed_version != "continuwuity 26.9.1 (046074bbc)":
        raise ValueError("Le serveur installé ne correspond pas à Continuwuity 26.9.1 (046074bbc)")
    current = command("systemctl", "show", SERVICE, "--property=ExecStart", "--value")
    expected = "/usr/bin/conduwuit --config ${CREDENTIALS_DIRECTORY}/conduwuit.toml"
    if not DROPIN.exists() and (expected not in current or "; ignore_errors=" not in current):
        raise ValueError("L’ExecStart du service diffère de la configuration vérifiée ; adapter l’installateur avant de continuer")
    print(f"Empreinte et version vérifiées : {version}. Installation prévue en mode aperçu, apply=false.")
    if args.apply:
        install(binary, digest, args.health_url)
    else:
        print("Lecture seule : aucune installation, aucun redémarrage. Ajouter --apply avec root pour installer.")


if __name__ == "__main__":
    main()
