"""Protect changed-file lint scope and failure reporting."""
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

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
        (self.root / ".gitignore").write_text("node_modules/\nbin/\nrecord.json\n")
        self.record = self.root / "record.json"

    def run_lint(self, **extra):
        # Exercise real Git discovery and command dispatch without requiring
        # Unix executable-script support from the host running these tests.
        spec = importlib.util.spec_from_file_location("fixture_lint", self.root / "scripts" / SCRIPT.name)
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        original_run = subprocess.run

        def run_command(command, **kwargs):
            if command[0] == "git":
                return original_run(command, **kwargs)
            with self.record.open("a") as record:
                record.write(json.dumps([Path(command[0]).name, *command[1:]]) + "\n")
            return subprocess.CompletedProcess(command, int(extra.get("LINT_FAIL", "0")))

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", [str(self.root / "scripts" / SCRIPT.name), "--base", self.base]), \
                mock.patch.object(runner.shutil, "which", return_value=str(self.root / "bin/ruff")), \
                mock.patch.object(runner.subprocess, "run", side_effect=run_command), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            status = runner.main()
        return subprocess.CompletedProcess(sys.argv, status, stdout.getvalue(), stderr.getvalue())

    def test_changed_and_untracked_sources_are_checked_without_old_or_deleted_files(self):
        (self.root / "changed.js").write_text("changed")
        (self.root / "new file.ts").write_text("new")
        (self.root / "new.py").write_text("new")
        (self.root / "new.swift").write_text("new")
        (self.root / "vendor.min.js").write_text("changed vendor")
        generated = self.root / "plugins/reader-markdown/server.mjs"
        generated.parent.mkdir(parents=True)
        generated.write_text("generated bundle")
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
