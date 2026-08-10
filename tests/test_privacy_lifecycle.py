import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from reader_backend import DocumentStore, FileAccessPolicy


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class PrivacyLifecycleTests(unittest.TestCase):
    def test_home_listing_does_not_probe_protected_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            for name in ("Desktop", "Documents", "Downloads", "Music"):
                folder = home / name
                folder.mkdir()
                (folder / "visible.md").write_text("test", encoding="utf-8")
            ordinary = home / "Notes"
            ordinary.mkdir()
            (ordinary / "visible.md").write_text("test", encoding="utf-8")

            store = DocumentStore(FileAccessPolicy(PROJECT_ROOT, [home], home=home))
            names = {item["name"] for item in store.list_dir(home)["entries"]}

            self.assertEqual(names, {"Notes"})
            self.assertEqual(store.list_dir(home / "Documents")["name"], "Documents")
            with self.assertRaises(PermissionError):
                store.policy.resolve(home / "Music")

    def test_packaged_mode_keeps_mutable_state_outside_app_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["READER_DATA_DIR"] = str(Path(tmp) / "Reader State")
            result = subprocess.run(
                [sys.executable, "-c", "import reader; print(reader.PREFS_FILE)"],
                cwd=PROJECT_ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(
                Path(result.stdout.strip()), Path(tmp) / "Reader State" / "preferences.json"
            )


if __name__ == "__main__":
    unittest.main()
