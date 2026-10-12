import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


prepare = module("prepare_check", "prepare.py")
installer = module("install_check", "install-preview.py")


class PreparationTests(unittest.TestCase):
    def test_bad_source_does_not_change_any_file(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            package = root / "package"
            source = root / "source"
            package.mkdir(); source.mkdir()
            (package / "overlay").mkdir()
            (source / "first.rs").write_text("intact")
            (source / "second.rs").write_text("wrong")
            manifest = {"commit": "verified", "files": [{"path": "first.rs", "sha256": hashlib.sha256(b"intact").hexdigest()}, {"path": "second.rs", "sha256": hashlib.sha256(b"expected").hexdigest()}]}
            (package / "source-manifest.json").write_text(json.dumps(manifest))
            with patch.object(prepare, "HERE", package), patch.object(prepare, "transform", return_value="changed"):
                with self.assertRaisesRegex(ValueError, "Source modifiée"):
                    prepare.prepare(source)
            self.assertEqual((source / "first.rs").read_text(), "intact")
            self.assertEqual((source / "second.rs").read_text(), "wrong")

    def test_existing_extension_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            package = root / "package"; source = root / "source"
            (package / "overlay").mkdir(parents=True); source.mkdir()
            (source / "original.rs").write_text("intact")
            (source / "extension.rs").write_text("already installed")
            (package / "overlay" / "extension.rs").write_text("new extension")
            (package / "source-manifest.json").write_text(json.dumps({"commit": "verified", "files": [{"path":"original.rs", "sha256": hashlib.sha256(b"intact").hexdigest()}]}))
            with patch.object(prepare, "HERE", package), patch.object(prepare, "transform", return_value="changed"):
                with self.assertRaisesRegex(ValueError, "existe déjà"):
                    prepare.prepare(source)
            self.assertEqual((source / "original.rs").read_text(), "intact")
            self.assertEqual((source / "extension.rs").read_text(), "already installed")


class InstallationTests(unittest.TestCase):
    def test_preview_override_keeps_credentials_and_forces_non_destructive_mode(self):
        text = installer.dropin(Path("/opt/sion-conservation/verified/conduwuit"))
        self.assertIn("${CREDENTIALS_DIRECTORY}/conduwuit.toml", text)
        self.assertIn("-O sion_conservation_apply=false", text)
        self.assertEqual(text.count("ExecStart="), 2)

    def test_modified_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            binary = root / "conduwuit"
            binary.write_bytes(b"verified binary")
            expected = hashlib.sha256(binary.read_bytes()).hexdigest()
            (root / "SHA256SUMS").write_text(expected + "  conduwuit\n")
            self.assertEqual(installer.checksum(binary), expected)
            binary.write_bytes(b"modified binary")
            with self.assertRaisesRegex(ValueError, "ne correspond pas"):
                installer.checksum(binary)

    def test_failed_restart_restores_previous_override(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            binary = root / "conduwuit"; binary.write_bytes(b"verified binary")
            dropin = root / "service.d" / "90-sion-conservation.conf"
            dropin.parent.mkdir(); dropin.write_text("previous override\n")
            backups = root / "backups"; backups.mkdir()
            calls = []
            def run(args, **_):
                calls.append(args)
                if len(calls) == 2:
                    raise RuntimeError("restart refused")
            with patch.object(installer, "DROPIN", dropin), patch.object(installer, "INSTALL", root / "install"), patch.object(installer, "BACKUPS", backups), patch.object(installer.os, "geteuid", return_value=0), patch.object(installer.subprocess, "run", side_effect=run):
                with self.assertRaisesRegex(RuntimeError, "restart refused"):
                    installer.install(binary, hashlib.sha256(binary.read_bytes()).hexdigest(), "http://test.invalid")
            self.assertEqual(dropin.read_text(), "previous override\n")
            self.assertEqual(calls[-1], ["systemctl", "restart", "conduwuit"])

    def test_non_root_apply_cannot_write_or_restart(self):
        with patch.object(installer.os, "geteuid", return_value=1000), patch.object(installer.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "nécessite root"):
                installer.install(Path("unused"), "verified", "http://test.invalid")
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
