"""Protect changed-file lint scope and failure reporting."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "lint_changed.py"


class FocusedLintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "scripts").mkdir()
        shutil.copy(SCRIPT, self.root / "scripts" / SCRIPT.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        for name in ["old.js", "changed.js", "deleted.py", "vendor.min.js"]:
            (self.root / name).write_text("initial")
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                        "commit", "-qm", "base"], cwd=self.root, check=True)
        self.base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root).decode().strip()
        for name in ("node_modules/.bin/eslint", "bin/ruff", "bin/swiftlint"):
            tool = self.root / name
            tool.parent.mkdir(parents=True, exist_ok=True)
            tool.write_text("#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\nwith Path(os.environ['LINT_RECORD']).open('a') as record:\n record.write(json.dumps([Path(sys.argv[0]).name, *sys.argv[1:]]) + '\\n')\nsys.exit(int(os.environ.get('LINT_FAIL', '0')))\n")
            tool.chmod(0o755)
        (self.root / ".gitignore").write_text("node_modules/\nbin/\nrecord.json\n")
        self.record = self.root / "record.json"

    def run_lint(self, **extra):
        return subprocess.run(["python3", str(self.root / "scripts" / SCRIPT.name),
                               "--base", self.base], cwd=self.root,
                              env={**os.environ, "PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"],
                                   "LINT_RECORD": str(self.record), **extra},
                              capture_output=True, text=True)

    def test_changed_and_untracked_sources_are_checked_without_old_or_deleted_files(self):
        (self.root / "changed.js").write_text("changed")
        (self.root / "new file.ts").write_text("new")
        (self.root / "new.py").write_text("new")
        (self.root / "new.swift").write_text("new")
        (self.root / "vendor.min.js").write_text("changed vendor")
        (self.root / "deleted.py").unlink()
        # Keep the runner itself out of this fixture's changed Python set.
        subprocess.run(["git", "add", "scripts", ".gitignore"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                        "commit", "-qm", "runner"], cwd=self.root, check=True)
        self.base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root).decode().strip()
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stderr)
        recorded = [json.loads(line) for line in self.record.read_text().splitlines()]
        self.assertEqual(recorded, [
            ["eslint", "--config", str(self.root / "config/eslint.config.mjs"),
             "changed.js", "new file.ts"],
            ["ruff", "check", "--config", str(self.root / "config/ruff.toml"), "new.py"],
            ["swiftlint", "lint", "--strict", "--no-cache", "--config",
             str(self.root / "config/.swiftlint.yml"), "new.swift"],
        ])

    def test_a_linter_failure_fails_the_gate(self):
        (self.root / "changed.js").write_text("changed")
        subprocess.run(["git", "add", "scripts", ".gitignore"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                        "commit", "-qm", "runner"], cwd=self.root, check=True)
        self.base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root).decode().strip()
        self.assertEqual(self.run_lint(LINT_FAIL="1").returncode, 1)
