#!/usr/bin/env python3
"""Build a per-release Tauri manifest from the exact signed files being published."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote

REPO = "flamme-demon/Sion-Client"
SAFE_NAME = re.compile(r"[A-Za-z0-9._-]+")


def github_asset_name(name: str) -> str:
    """The name GitHub will store an uploaded asset under.

    GitHub rewrites asset names: « Sion Client_2.0.0-beta.7_x64-setup.exe »
    was published as « Sion.Client_… », so a manifest URL built from the
    local name was a 404. Spaces get the same dot here; any other character
    GitHub might rewrite differently is refused rather than guessed.
    """
    safe = name.replace(" ", ".")
    if not SAFE_NAME.fullmatch(safe):
        raise ValueError(f"Asset name GitHub would rewrite: {name}")
    return safe


def publish_under_github_name(artifact: Path) -> Path:
    """Rename the artifact and its signature to their GitHub name, so the
    files uploaded afterwards are exactly the ones the manifest points at.
    The signature covers the content and the version, not the file name."""
    target = artifact.with_name(github_asset_name(artifact.name))
    if target != artifact:
        Path(str(artifact) + ".sig").rename(str(target) + ".sig")
        artifact.rename(target)
    return target


def artifact_matches(path: Path, version: str) -> bool:
    return bool(not path.is_symlink() and re.search(
        r"(?:^|[_-])" + re.escape(version) +
        r"(?=[_-](?:x86_64|x64|amd64|arm64|aarch64|universal)(?:[_\-.]|$))", path.name))


def create_manifest(folder: Path, tag: str, require_desktop: bool = False) -> dict:
    version = tag.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid release tag")
    platforms = {}
    for suffix, platform in [(".AppImage", "linux-x86_64"), (".exe", "windows-x86_64")]:
        artifacts = [path for path in folder.glob(f"*{suffix}") if artifact_matches(path, version)]
        if len(artifacts) > 1:
            raise ValueError(f"Ambiguous {platform} artifacts: {artifacts}")
        if not artifacts:
            if require_desktop:
                raise ValueError(f"Missing {platform} artifact")
            continue
        signature_path = Path(str(artifacts[0]) + ".sig")
        if not signature_path.is_file():
            raise FileNotFoundError(f"Missing signature: {signature_path}")
        artifact = publish_under_github_name(artifacts[0])
        signature = Path(str(artifact) + ".sig").read_text().strip()
        if not signature:
            raise ValueError(f"Empty signature: {artifact}")
        platforms[platform] = {
            "url": f"https://github.com/{REPO}/releases/download/{quote(tag, safe='')}/{quote(artifact.name, safe='')}",
            "signature": signature,
        }
    if not platforms:
        raise ValueError("No signed desktop artifact for this release")
    return {"version": version, "platforms": platforms}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("tag")
    parser.add_argument("--require-desktop", action="store_true")
    parser.add_argument("--files-list", type=Path, help="Write a NUL-separated list of this release’s artifacts")
    args = parser.parse_args()
    manifest = create_manifest(args.folder, args.tag, args.require_desktop)
    manifest_path = args.folder / "updater.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.files_list:
        files = [manifest_path] + sorted(path for path in args.folder.iterdir()
            if path.is_file() and artifact_matches(path, args.tag.removeprefix("v"))
            and path.name.endswith((".exe", ".AppImage", ".apk", ".msi", ".zip", ".sig")))
        args.files_list.write_bytes(b"\0".join(str(path).encode() for path in files) + b"\0")


if __name__ == "__main__":
    main()
