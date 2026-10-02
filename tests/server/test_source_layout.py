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
            (resource / "src/reader").mkdir(parents=True)
            shutil.copy(ROOT / "src/__init__.py", resource / "src/__init__.py")
            for name in ("__init__.py", "server.py", "backend.py"):
                shutil.copy(ROOT / "src/reader" / name, resource / "src/reader" / name)
            shutil.copytree(ROOT / "src/reader/web", resource / "src/reader/web")
            result = subprocess.run([sys.executable, str(resource / "reader.py"), "--help"],
                                    cwd=resource, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--no-browser", result.stdout)
            probe = "import reader, reader_backend; from pathlib import Path; assert reader.APP_DIR == Path.cwd(); assert reader.STATIC_DIR.is_dir(); assert reader_backend.DocumentStore"
            result = subprocess.run([sys.executable, "-c", probe], cwd=resource,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_source_tree_contains_no_tests_or_generated_artifacts(self):
        tracked = subprocess.check_output(
            ["git", "ls-files", "-z", "src"], cwd=ROOT
        ).decode().split("\0")
        forbidden = {"test", "tests", "build", "dist", "test-results",
                     "playwright-report", "__pycache__", "node_modules"}
        misplaced = []
        for name in filter(None, tracked):
            path = Path(name)
            if (forbidden.intersection(path.parts) or path.name.startswith("test_")
                    or ".test." in path.name or ".spec." in path.name
                    or path.name.startswith("playwright.config.")
                    or path.suffix in {".pyc", ".pyo"}):
                misplaced.append(name)
        self.assertEqual(misplaced, [], "Tests belong under tests; generated files are ignored")
