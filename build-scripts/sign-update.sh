#!/usr/bin/env bash
# Sign the final, published file (including custom AppImage contents).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
KEY_ARGS=()
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$PROJECT_DIR/.update-signing/sion.key}"
    if [ ! -f "$KEY_PATH" ]; then
        echo "Clé de mise à jour absente : configure TAURI_SIGNING_PRIVATE_KEY ou TAURI_SIGNING_PRIVATE_KEY_PATH." >&2
        exit 1
    fi
    KEY_ARGS=(--private-key-path "$KEY_PATH")
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
for artifact in "$@"; do
    [ -f "$artifact" ] || { echo "Artefact absent : $artifact" >&2; exit 1; }
    bun run tauri signer sign "${KEY_ARGS[@]}" "$artifact"
done
