"""Keep canonical source ownership and compatible root entrypoints working."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import reader
import reader_backend
from scripts.package_runtime import package_runtime
from src.reader import backend, server

ROOT = Path(__file__).resolve().parents[2]


class SourceLayoutTests(unittest.TestCase):
    def test_root_imports_return_canonical_modules_and_keep_authorization_root(self):
        self.assertIs(reader, server)
        self.assertIs(reader_backend, backend)
        self.assertEqual(server.APP_DIR, ROOT)
        self.assertEqual(server.STATIC_DIR, ROOT / "src/reader/web")

    def test_resource_tree_launches_and_imports_without_the_checkout(self):
        (ROOT / "build").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="reader-runtime-test-", dir=ROOT / "build") as temporary:
            resource = Path(temporary) / "resources"
            resource.mkdir()
            environment = {**os.environ, "READER_DATA_DIR": str(Path(temporary) / "state"),
                           "PYTHONDONTWRITEBYTECODE": "1"}
            package_runtime(resource)
            result = subprocess.run([sys.executable, str(resource / "reader.py"), "--help"],
                                    cwd=resource, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--no-browser", result.stdout)
            probe = "import reader, reader_backend; from pathlib import Path; assert reader.APP_DIR == Path.cwd(); assert reader.STATIC_DIR.is_dir(); assert reader_backend.DocumentStore"
            result = subprocess.run([sys.executable, "-c", probe], cwd=resource,
                                    env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((resource / ".reader-token").exists())
            self.assertFalse(list(resource.rglob("__pycache__")))

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

    def test_root_has_no_legacy_source_or_generated_app_outputs(self):
        legacy = [name for name in ("static", "fonts", "builds", "test-results",
                                    "manifest.json") if (ROOT / name).exists()]
        legacy.extend(path.name for pattern in ("Reader-*.zip", "Reader-*.dmg")
                      for path in ROOT.glob(pattern))
        self.assertEqual(legacy, [], "Application source belongs in src; output belongs in build")
