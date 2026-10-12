#!/usr/bin/env python3
"""Ajoute l'extension à une copie vérifiée des sources Continuwuity 26.9.1.

Ne modifie ni le serveur en cours, ni sa configuration, ni sa base de données.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
GUARD = "\t\tlet _sion_media_guard = crate::conservation::MEDIA_BARRIER.read().await;\n\t\tcrate::conservation::MEDIA_EPOCH.fetch_add(1, std::sync::atomic::Ordering::AcqRel);\n"


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Point d’intégration inattendu : {old[:70]!r}")
    return text.replace(old, new, 1)


def transform(path, text):
    if path == "src/core/config/mod.rs":
        return replace_once(text, "pub struct Config {", "pub struct Config {\n\t/// Enable the optional Sion conversation-retention service.\n\t#[serde(default)]\n\tpub sion_conservation_enabled: bool,\n\n\t/// Apply saved retention policies. False keeps the service in preview mode.\n\t#[serde(default)]\n\tpub sion_conservation_apply: bool,\n")
    if path in ("src/api/admin/mod.rs", "src/ruminuwuity/admin/continuwuity/mod.rs"):
        return text + "\npub mod conservation;\n"
    if path == "src/api/router.rs":
        return replace_once(text, ".ruma_route(&admin::rooms::list::list_rooms);", ".ruma_route(&admin::rooms::list::list_rooms)\n\t\t.ruma_route(&admin::conservation::request);")
    if path == "src/service/mod.rs":
        return text + "\npub mod conservation;\n"
    if path == "src/service/services.rs":
        text = replace_once(text, "pub struct Services {", "pub struct Services {\n\tpub conservation: Arc<crate::conservation::Service>,")
        return replace_once(text, "\t\tOk(Arc::new(Self {", "\t\tOk(Arc::new(Self {\n\t\t\tconservation: build!(crate::conservation::Service),")
    if path == "src/service/rooms/timeline/append.rs":
        return replace_once(text, "\t\t// Coalesce database writes for the remainder of this scope.", GUARD + "\n\t\t// Coalesce database writes for the remainder of this scope.")
    if path == "src/service/users/profile.rs":
        return replace_once(text, "\t\tmatch change {", GUARD + "\n\t\tmatch change {")
    if path == "src/service/account_data/mod.rs":
        return replace_once(text, "\t\tlet count = self.services.globals.next_count().unwrap();", GUARD + "\n\t\tlet count = self.services.globals.next_count().unwrap();")
    if path == "src/service/rooms/timeline/backfill.rs":
        return replace_once(text, "\t\t// Insert pdu", GUARD + "\n\t\t// Insert pdu")
    if path == "src/service/rooms/outlier/mod.rs":
        return replace_once(text, "pub fn add_pdu_outlier(&self, event_id: &EventId, pdu: &CanonicalJsonObject) {", "pub async fn add_pdu_outlier(&self, event_id: &EventId, pdu: &CanonicalJsonObject) {\n" + GUARD)
    if path == "src/service/rooms/event_handler/handle_outlier_pdu.rs":
        text = replace_once(text, "pub(super) fn reject_and_persist(", "pub(super) async fn reject_and_persist(")
    text = re.sub(r"(\.add_pdu_outlier\([^;]+?\));", r"\1.await;", text)
    text = re.sub(r"(\.reject_and_persist\([^;]+?\));", r"\1.await;", text)
    if path == "src/service/rooms/membership/mod.rs":
        text = replace_once(text, ".ready_for_each(|(event_id, value)| {", ".for_each(|(event_id, value)| async move {")
    return text


def prepare(source):
    manifest = json.loads((HERE / "source-manifest.json").read_text())
    changes = {}
    for entry in manifest["files"]:
        name, expected = entry["path"], entry["sha256"]
        path = source / name
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError(f"Source modifiée ou mauvaise version : {name}. Utilisez une copie propre du commit {manifest['commit']}.")
        changes[path] = transform(name, raw.decode())
    for path in (HERE / "overlay").rglob("*.rs"):
        target = source / path.relative_to(HERE / "overlay")
        if target.exists():
            raise ValueError(f"L’extension existe déjà : {target}")
        changes[target] = path.read_text()
    for path, text in changes.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    print(f"Extension préparée dans {source} ({len(changes)} fichiers). Le nettoyage reste désactivé par défaut.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source.resolve())
