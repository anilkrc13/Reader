"""Keep canonical source ownership and compatible root entrypoints working."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import reader
import reader_backend
from src.reader import backend, server

ROOT = Path(__file__).resolve().parents[2]


class SourceLayoutTests(unittest.TestCase):
    def test_root_imports_return_canonical_modules_and_keep_authorization_root(self):
        self.assertIs(reader, server)
        self.assertIs(reader_backend, backend)
        self.assertEqual(server.APP_DIR, ROOT)
        self.assertEqual(server.STATIC_DIR, ROOT / "src/reader/web")

    def test_resource_tree_launches_and_imports_without_the_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            resource = Path(temporary)
            for name in ("reader.py", "reader_backend.py", "VERSION"):
                shutil.copy(ROOT / name, resource / name)
            shutil.copytree(ROOT / "src", resource / "src")
            result = subprocess.run([sys.executable, str(resource / "reader.py"), "--help"],
                                    cwd=resource, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--no-browser", result.stdout)
            probe = "import reader, reader_backend; from pathlib import Path; assert reader.APP_DIR == Path.cwd(); assert reader.STATIC_DIR.is_dir(); assert reader_backend.DocumentStore"
            result = subprocess.run([sys.executable, "-c", probe], cwd=resource,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
