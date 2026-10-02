"""Catch stale public plugin packages and unsafe distribution writes."""
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts import plugin_release as release

URL = "https://github.com/example/Reader"


class PluginReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.plugin = self.root / "built"
        for name in release.FILES:
            path = self.plugin / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"Fixture {name}\n")
        (self.plugin / "plugin.json").write_text(json.dumps({
            "name": "reader-markdown", "version": "2.6.0",
            "extensions": {"com.openai": {"interface": {"displayName": "Reader"}}}}))
        (self.plugin / "mcp.json").write_text(json.dumps({
            "mcpServers": {"reader-markdown": {"command": "node"}}}))
        self.version = self.root / "VERSION"
        self.version.write_text("2.6.0")
        self.repository = self.root / "repository"
        self.repository.mkdir()

    def sync(self):
        return release.sync(self.plugin, self.version, self.repository, URL)

    def check(self):
        return release.check(self.plugin, self.version, self.repository, URL)

    def snapshot(self):
        return {path.relative_to(self.repository).as_posix():
                (path.read_bytes(), path.stat().st_mtime_ns)
                for path in self.repository.rglob("*") if path.is_file()}

    def test_sync_is_idempotent_and_preserves_private_state_and_other_plugins(self):
        for name in (".agents/plugins/installed_plugins.json", "plugins/other/server.js"):
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("unrelated state")
        catalog = self.repository / ".agents/plugins/marketplace.json"
        catalog.write_text('{"name":"reader-local","interface":{"displayName":"Reader Local"},"plugins":[]}')
        self.sync()
        before = self.snapshot()
        self.sync()
        self.check()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(catalog.read_bytes(), release.json_bytes({
            "name": "reader-dev", "interface": {"displayName": "Reader-Dev"},
            "plugins": [{"name": "reader-markdown-dev", "source": {
                "source": "local", "path": "./plugins/reader-markdown"},
                "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                "category": "Productivity"}]}))
        record = release.read_json(self.repository / "plugins/release.json")
        self.assertEqual(set(record), {"version", "repository_url", "files"})
        self.assertEqual(record["version"], "2.6.0")
        self.assertEqual(record["repository_url"], URL)
        for name in (".agents/plugins/installed_plugins.json", "plugins/other/server.js"):
            self.assertEqual((self.repository / name).read_text(), "unrelated state")

    def test_check_rejects_hash_version_catalog_byte_missing_and_extra_drift_without_writes(self):
        mutations = {
            "hash": ("plugins/release.json", b'{"files":{}}'),
            "manifest": ("plugins/reader-markdown/plugin.json", b'{"version":"2.5.0"}'),
            "catalog": (".agents/plugins/marketplace.json", b'{"plugins":[]}'),
            "bytes": ("plugins/reader-markdown/server.mjs", b"tampered"),
            "missing": ("plugins/reader-markdown/LICENSE", None),
            "extra": ("plugins/reader-markdown/.env", b"private"),
        }
        for change, (name, content) in mutations.items():
            with self.subTest(change=change):
                self.sync()
                path = self.repository / name
                original = path.read_bytes() if path.exists() else None
                if content is None:
                    path.unlink()
                else:
                    path.write_bytes(content)
                before = self.snapshot()
                with self.assertRaises((ValueError, FileNotFoundError)):
                    self.check()
                self.assertEqual(before, self.snapshot())
                if original is None:
                    path.unlink()
                else:
                    path.write_bytes(original)

    def test_sync_rejects_unowned_files_in_plugin_before_replacing_any_bytes(self):
        self.sync()
        private = self.repository / "plugins/reader-markdown/.env"
        private.write_text("private")
        (self.plugin / "server.mjs").write_text("new source")
        before = self.snapshot()
        with self.assertRaises(ValueError):
            self.sync()
        self.assertEqual(before, self.snapshot())

    def test_input_private_files_dependencies_and_links_are_rejected(self):
        for name in (".env", "node_modules", ".agents"):
            with self.subTest(name=name):
                path = self.plugin / name
                path.write_text("private")
                with self.assertRaises(ValueError):
                    self.sync()
                self.assertEqual(self.snapshot(), {})
                path.unlink()
        asset = self.plugin / "assets/reader.png"
        asset.unlink()
        asset.symlink_to(self.version)
        with self.assertRaises(ValueError):
            self.sync()
        self.assertEqual(self.snapshot(), {})

    def test_destination_parent_and_owned_file_symlinks_cannot_write_outside_repository(self):
        outside = self.root / "outside"
        outside.mkdir()
        for name in ("plugins", ".agents"):
            with self.subTest(name=name):
                link = self.repository / name
                link.symlink_to(outside, target_is_directory=True)
                with self.assertRaises(ValueError):
                    self.sync()
                self.assertEqual(list(outside.iterdir()), [])
                link.unlink()
        self.sync()
        target = self.repository / "plugins/reader-markdown/server.mjs"
        target.unlink()
        target.symlink_to(self.version)
        with self.assertRaises(ValueError):
            self.sync()
        self.assertEqual(self.version.read_text(), "2.6.0")

    def test_unknown_marketplace_is_not_overwritten(self):
        catalog = self.repository / ".agents/plugins/marketplace.json"
        catalog.parent.mkdir(parents=True)
        for value in ({"name": "user-marketplace", "plugins": []},
                      {**release.marketplace("plugins/reader-markdown"),
                       "plugins": [*release.marketplace("plugins/reader-markdown")["plugins"],
                                   {"name": "other-plugin"}]}):
            with self.subTest(value=value):
                catalog.write_text(json.dumps(value))
                before = self.snapshot()
                with self.assertRaises(ValueError):
                    self.sync()
                self.assertEqual(before, self.snapshot())

    def test_legacy_catalog_label_only_is_migrated_and_extra_settings_are_preserved(self):
        catalog = self.repository / ".agents/plugins/marketplace.json"
        catalog.parent.mkdir(parents=True)
        for interface in ({"displayName": "Reader GitHub"},
                          {"displayName": "Reader - Dev"},
                          {"displayName": "Reader"},
                          {"displayName": "Reader - Dev", "custom": True},
                          {}, None, "Reader - Dev", {"displayName": None}):
            with self.subTest(interface=interface):
                legacy = release.marketplace("plugins/reader-markdown")
                legacy["interface"] = interface
                catalog.write_text(json.dumps(legacy))
                before = self.snapshot()
                if (isinstance(interface, dict) and set(interface) == {"displayName"}
                        and isinstance(interface["displayName"], str)):
                    self.sync()
                    self.check()
                else:
                    with self.assertRaises(ValueError):
                        self.sync()
                    self.assertEqual(before, self.snapshot())

    def test_version_and_manifest_mismatch_fail_before_writes(self):
        self.version.write_text("2.7.0")
        with self.assertRaises(ValueError):
            self.sync()
        self.assertEqual(self.snapshot(), {})

    def test_archive_has_plugin_root_licenses_and_ephemeral_commit_provenance(self):
        output = self.root / "stage"
        archive = release.stage(self.plugin, self.version, "v2.6.0", "a" * 40,
                                URL, output, self.root / "archives")
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
        metadata = release.validate_stage(output)
        self.assertEqual(metadata["source_commit"], "a" * 40)
        catalog = release.read_json(output / ".agents/plugins/marketplace.json")
        local = output / catalog["plugins"][0]["source"]["path"]
        self.assertEqual(local, output / "plugins/reader-markdown")
        self.assertTrue(local.resolve().is_relative_to(output.resolve()))
        self.assertTrue((local / "LICENSE").is_file())
        dispatch_output = self.root / "dispatch-stage"
        release.stage(self.plugin, self.version, None, "b" * 40,
                      URL, dispatch_output, self.root / "dispatch-archives")
        dispatch = release.validate_stage(dispatch_output)
        self.assertIsNone(dispatch["tag"])
        self.assertEqual(dispatch["source_commit"], "b" * 40)

    def test_dev_and_production_have_separate_ids_and_staging_preserves_checkout(self):
        catalog = self.repository / ".agents/plugins/marketplace.json"
        catalog.parent.mkdir(parents=True)
        legacy = release.marketplace("plugins/reader-markdown")
        legacy["interface"]["displayName"] = "Reader - Dev"
        catalog.write_text(json.dumps(legacy))
        self.sync()
        before = self.snapshot()
        source_before = {name: (self.plugin / name).read_bytes() for name in release.FILES}
        output = self.root / "production"
        release.stage(self.plugin, self.version, None, "c" * 40, URL,
                      output, self.root / "archives")
        release.validate_stage(output)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(source_before, release.package_bytes(self.plugin))
        dev = release.read_json(catalog)
        prod = release.read_json(output / ".agents/plugins/marketplace.json")
        self.assertEqual(dev["name"], "reader-dev")
        self.assertEqual(prod["name"], "reader-github")
        self.assertEqual(dev["interface"]["displayName"], "Reader-Dev")
        self.assertEqual(prod["interface"]["displayName"], "Reader")
        self.assertNotEqual(dev["plugins"][0]["name"], prod["plugins"][0]["name"])
        dev_root = self.repository / dev["plugins"][0]["source"]["path"]
        prod_root = output / prod["plugins"][0]["source"]["path"]
        self.assertEqual(release.read_json(dev_root / "plugin.json")["name"], "reader-markdown-dev")
        self.assertEqual(set(release.read_json(dev_root / "mcp.json")["mcpServers"]), {"reader-markdown-dev"})
        self.assertEqual(release.read_json(prod_root / "plugin.json")["name"], "reader-markdown")
        self.assertEqual(set(release.read_json(prod_root / "mcp.json")["mcpServers"]), {"reader-markdown"})
        self.check()
        with self.assertRaises(ValueError):
            release.stage(dev_root, self.version, None, "d" * 40, URL,
                          self.root / "invalid", self.root / "invalid-archives")
        self.assertFalse((self.root / "invalid").exists())

    def test_stage_wrong_tag_and_missing_license_fail_before_writes(self):
        for change in ("tag", "license"):
            with self.subTest(change=change):
                if change == "license":
                    (self.plugin / "LICENSE").unlink()
                with self.assertRaises(ValueError):
                    release.stage(self.plugin, self.version,
                                  "v2.5.0" if change == "tag" else "v2.6.0",
                                  "a" * 40, URL, self.root / "stage", self.root / "archives")
                self.assertFalse((self.root / "stage").exists())

    def test_stage_rejects_existing_and_symlinked_destinations_without_writes(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "keep").write_text("unrelated state")
        link = self.root / "linked"
        link.symlink_to(outside, target_is_directory=True)
        archive_dir = self.root / "archives"
        archive_dir.mkdir()
        archive = archive_dir / "Reader-plugin-2.6.0.zip"
        archive.write_text("existing archive")
        for output, archives in ((outside, self.root / "new-archives"),
                                 (link / "stage", self.root / "new-archives"),
                                 (self.root / "stage", link),
                                 (self.root / "stage", archive_dir)):
            with self.subTest(output=output, archives=archives):
                before = {path.relative_to(self.root): path.read_bytes()
                          for path in self.root.rglob("*") if path.is_file()}
                with self.assertRaises(ValueError):
                    release.stage(self.plugin, self.version, None, "a" * 40,
                                  URL, output, archives)
                after = {path.relative_to(self.root): path.read_bytes()
                         for path in self.root.rglob("*") if path.is_file()}
                self.assertEqual(before, after)
