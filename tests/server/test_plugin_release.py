"""Exercise release packaging and ordinary Git publication using a local remote."""
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts import plugin_release as release


class PluginReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.plugin = self.root / "plugin"
        for name in release.FILES:
            file = self.plugin / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(f"Fixture {name}\n")
        self.version_file = self.root / "VERSION"
        self.make_version("2.6.0")
        self.remote = self.root / "remote.git"
        subprocess.run(["git", "init", "--bare", "--quiet", str(self.remote)], check=True)

    def make_version(self, version):
        self.version_file.write_text(version)
        (self.plugin / "plugin.json").write_text(json.dumps({
            "name": "reader-markdown", "version": version}))

    def stage(self, name="stage", version="2.6.0", commit="a" * 40):
        directory = self.root / name
        archive = release.stage(self.plugin, self.version_file, f"v{version}", commit,
                                "https://github.com/example/Reader", directory,
                                self.root / f"archives-{name}")
        return directory, archive

    def publish(self, stage, name="checkout"):
        return release.publish(stage, self.root / name, str(self.remote))

    def test_archive_and_catalog_ship_versioned_plugin_and_licenses(self):
        staged, archive = self.stage()
        with zipfile.ZipFile(archive) as bundle:
            self.assertEqual(set(bundle.namelist()), {
                "reader-markdown/plugin.json", "reader-markdown/mcp.json",
                "reader-markdown/server.mjs", "reader-markdown/session.mjs",
                "reader-markdown/viewer.html", "reader-markdown/LICENSE",
                "reader-markdown/assets/reader.png", "reader-markdown/licenses/npm-notices.txt",
                "reader-markdown/licenses/mermaid-LICENSE", "reader-markdown/licenses/marked-LICENSE.md",
                "reader-markdown/licenses/dompurify-LICENSE", "reader-markdown/licenses/highlightjs-LICENSE",
                "reader-markdown/licenses/lora-LICENSE"})
            self.assertEqual(json.loads(bundle.read("reader-markdown/plugin.json"))["version"], "2.6.0")
        catalog = release.read_json(staged / ".agents/plugins/marketplace.json")
        path = catalog["plugins"][0]["source"]["path"]
        self.assertEqual(path, "./versions/2.6.0/plugins/reader-markdown")
        self.assertTrue((staged / path / "server.mjs").is_file())
        self.assertTrue((staged / path).resolve().is_relative_to(staged.resolve()))

    def test_bootstrap_without_tag_and_missing_license_are_checked(self):
        staged = self.root / "bootstrap"
        release.stage(self.plugin, self.version_file, None, "a" * 40,
                      "https://github.com/example/Reader", staged, self.root / "archives")
        self.assertIsNone(release.validate_stage(staged)["tag"])
        self.assertTrue(self.publish(staged))
        (self.plugin / "LICENSE").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.stage()
        self.assertFalse((self.root / "stage").exists())

    def test_version_tag_and_manifest_mismatch_fail_before_writes(self):
        for mismatch in ("tag", "manifest"):
            with self.subTest(mismatch=mismatch):
                self.make_version("2.6.0")
                if mismatch == "manifest":
                    (self.plugin / "plugin.json").write_text('{"name":"reader-markdown","version":"2.5.0"}')
                with self.assertRaises(ValueError):
                    self.stage(version="2.5.0" if mismatch == "tag" else "2.6.0")
                self.assertFalse((self.root / "stage").exists())

    def test_private_dependency_and_symlink_input_fail_closed(self):
        for name in (".env", ".agents/plugins/state.json", "node_modules/library/index.js"):
            with self.subTest(name=name):
                path = self.plugin / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("private")
                with self.assertRaises(ValueError):
                    self.stage()
                if "/" in name:
                    shutil.rmtree(self.plugin / name.split("/")[0])
                else:
                    path.unlink()
        asset = self.plugin / "assets/reader.png"
        asset.unlink()
        asset.symlink_to(self.version_file)
        with self.assertRaises(ValueError):
            self.stage()

    def test_destination_symlink_does_not_write_outside_stage(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.root / "linked").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.stage(name="linked/stage")
        self.assertEqual(list(outside.iterdir()), [])

    def test_first_update_and_rerun_keep_additive_immutable_history(self):
        first, _ = self.stage()
        self.assertTrue(self.publish(first))
        old_head = release.git(self.remote, "rev-parse", "plugin-marketplace")
        self.assertFalse(self.publish(first, "rerun"))
        self.assertEqual(release.git(self.remote, "rev-parse", "plugin-marketplace"), old_head)
        self.make_version("2.7.0")
        second, _ = self.stage("second", "2.7.0", "b" * 40)
        self.assertTrue(self.publish(second, "update"))
        self.assertEqual(release.git(self.remote, "rev-parse", "plugin-marketplace^"), old_head)
        files = release.git(self.remote, "ls-tree", "-r", "--name-only", "plugin-marketplace")
        self.assertIn("versions/2.6.0/plugins/reader-markdown/server.mjs", files)
        self.assertIn("versions/2.7.0/plugins/reader-markdown/server.mjs", files)
        with self.assertRaisesRegex(ValueError, "newer"):
            self.publish(first, "downgrade")

    def test_changed_same_version_source_or_files_are_rejected(self):
        first, _ = self.stage()
        self.publish(first)
        for change in ("source", "files"):
            with self.subTest(change=change):
                if change == "files":
                    (self.plugin / "server.mjs").write_text("changed")
                staged, _ = self.stage(change, commit="b" * 40 if change == "source" else "a" * 40)
                with self.assertRaisesRegex(ValueError, "immutable"):
                    self.publish(staged, f"checkout-{change}")

    def test_tampered_stage_fails_before_git_checkout(self):
        staged, _ = self.stage()
        (staged / "versions/2.6.0/plugins/reader-markdown/server.mjs").write_text("changed")
        with self.assertRaises(ValueError):
            self.publish(staged)
        self.assertFalse((self.root / "checkout").exists())

    def test_concurrent_remote_commit_rejects_non_force_push(self):
        first, _ = self.stage()
        self.publish(first)
        self.make_version("2.7.0")
        second, _ = self.stage("second", "2.7.0", "b" * 40)
        original_git = release.git

        def racing_git(checkout, *arguments):
            if arguments[0] == "push":
                competitor = self.root / "competitor"
                subprocess.run(["git", "clone", "--quiet", "--branch", "plugin-marketplace",
                                str(self.remote), str(competitor)], check=True)
                (competitor / "race.txt").write_text("another release")
                original_git(competitor, "add", "race.txt")
                original_git(competitor, "-c", "user.name=Test", "-c", "user.email=test@example.com",
                             "commit", "--quiet", "-m", "Concurrent commit")
                original_git(competitor, "push", "origin", "plugin-marketplace")
            return original_git(checkout, *arguments)

        with patch.object(release, "git", side_effect=racing_git):
            with self.assertRaises(subprocess.CalledProcessError):
                self.publish(second, "racing")
        files = original_git(self.remote, "ls-tree", "-r", "--name-only", "plugin-marketplace")
        self.assertIn("race.txt", files)
        self.assertNotIn("versions/2.7.0/", files)
