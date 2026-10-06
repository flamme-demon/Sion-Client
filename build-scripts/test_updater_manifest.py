import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("manifest", Path(__file__).with_name("create-updater-manifest.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ManifestTests(unittest.TestCase):
    def test_exact_version_and_github_asset_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for version in ["2.0.0-beta.7", "2.0.0-beta.70"]:
                path = folder / f"Sion Client_{version}_x64-setup.exe"
                path.write_bytes(b"installer")
                Path(str(path) + ".sig").write_text("signed")
            manifest = module.create_manifest(folder, "v2.0.0-beta.7")
            url = manifest["platforms"]["windows-x86_64"]["url"]
            # GitHub publishes « Sion Client_… » as « Sion.Client_… » (v2.0.0-beta.7):
            # the URL must name the asset as GitHub stores it, or it is a 404.
            self.assertTrue(url.endswith("/v2.0.0-beta.7/Sion.Client_2.0.0-beta.7_x64-setup.exe"), url)
            self.assertNotIn("beta.70", url)
            # The files themselves are renamed, so what is uploaded is what the URL names.
            self.assertTrue((folder / "Sion.Client_2.0.0-beta.7_x64-setup.exe").is_file())
            self.assertTrue((folder / "Sion.Client_2.0.0-beta.7_x64-setup.exe.sig").is_file())
            self.assertFalse((folder / "Sion Client_2.0.0-beta.7_x64-setup.exe").exists())

    def test_names_github_would_rewrite_unpredictably_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            path = folder / "Sion(1)_2.0.0_x64-setup.exe"
            path.write_bytes(b"installer")
            Path(str(path) + ".sig").write_text("signed")
            with self.assertRaises(ValueError):
                module.create_manifest(folder, "v2.0.0")
            self.assertTrue(path.is_file(), "a refused artifact must be left untouched")

    def test_stable_release_excludes_preview_artifacts(self):
        self.assertTrue(module.artifact_matches(Path("Sion-2.0.0-x86_64.AppImage"), "2.0.0"))
        self.assertFalse(module.artifact_matches(Path("Sion-2.0.0-beta.7-x86_64.AppImage"), "2.0.0"))
        self.assertFalse(module.artifact_matches(Path("Sion-2.0.0-beta.70-arm64.apk"), "2.0.0-beta.7"))

    def test_unsigned_release_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / "Sion-2.0.0-x86_64.AppImage").write_bytes(b"appimage")
            with self.assertRaises(FileNotFoundError):
                module.create_manifest(folder, "v2.0.0")

    def test_missing_desktop_platform_is_rejected_in_ci(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):
                module.create_manifest(Path(temporary), "v2.0.0", True)

if __name__ == "__main__":
    unittest.main()
