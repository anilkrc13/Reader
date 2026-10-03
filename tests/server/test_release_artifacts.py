"""Release gates catch mismatched products and an unusable browser download."""
import hashlib
import json
import os
import plistlib
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from urllib.request import HTTPCookieProcessor, build_opener, urlopen

from scripts import release_artifacts as release
from scripts.package_runtime import ROOT, package_runtime


def wait_for_url(process, timeout=10):
    """Bound startup even when a live child never writes a complete line."""
    output = queue.Queue()

    def read_output():
        for line in process.stdout:
            output.put(line)
        output.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    deadline = time.monotonic() + timeout
    while True:
        try:
            line = output.get(timeout=max(0, deadline - time.monotonic()))
        except queue.Empty as error:
            raise RuntimeError("Packaged server startup timed out") from error
        if line is None:
            raise RuntimeError("Packaged server exited before announcing its URL")
        if line.strip().startswith("http://127.0.0.1:"):
            return line.strip()


class ReleaseArtifactsTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "build").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / "build")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.version = (ROOT / "VERSION").read_text().strip()
        self.runtime = self.root / "runtime"
        package_runtime(self.runtime)
        self.web = release.archive_web(self.runtime, ROOT / "VERSION", self.root)
        self.native = self.root / f"Reader-{self.version}.zip"
        self.plugin = self.root / f"Reader-plugin-{self.version}.zip"
        self.native_files = {
            "Reader.app/Contents/Info.plist": plistlib.dumps({
                "CFBundleShortVersionString": self.version, "CFBundleVersion": self.version}),
            "Reader.app/Contents/Resources/VERSION": self.version.encode(),
        }
        self.plugin_files = {
            f"reader-markdown/{name}": (ROOT / "plugins/reader-markdown" / name).read_bytes()
            for name in release.PLUGIN_FILES
        }
        self.write_zip(self.native, self.native_files)
        self.write_zip(self.plugin, self.plugin_files)
        self.manifest = self.root / "manifest.json"
        self.write_manifest()

    def write_zip(self, path, files):
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)

    def write_manifest(self):
        self.manifest.write_text(json.dumps({
            "version": self.version, "sha256": hashlib.sha256(self.native.read_bytes()).hexdigest(),
            "size": self.native.stat().st_size,
            "url": f"https://github.com/anilkrc13/Reader/releases/download/v{self.version}/{self.native.name}",
        }))

    def check(self, tag=None):
        return release.check_archives(ROOT / "VERSION", tag or f"v{self.version}", self.root)

    def test_extracted_web_download_runs_without_checkout(self):
        with tempfile.TemporaryDirectory() as outside:
            with zipfile.ZipFile(self.web) as archive:
                archive.extractall(outside)
            runtime = Path(outside) / f"Reader-web-{self.version}"
            state = Path(outside) / "state"
            state.mkdir()
            env = dict(os.environ, READER_DATA_DIR=str(state), PYTHONDONTWRITEBYTECODE="1")
            with socket.socket() as reserved:
                reserved.bind(("127.0.0.1", 0))
                port = reserved.getsockname()[1]
            process = subprocess.Popen(
                [sys.executable, "-u", "scripts/reader.py", "--no-browser", "--port", str(port), outside],
                cwd=runtime, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.addCleanup(process.stdout.close)
            try:
                url = wait_for_url(process)
                with urlopen(url + "api/ping", timeout=5) as response:
                    self.assertEqual(json.load(response)["version"], self.version)
                token = (state / ".reader-token").read_text().strip()
                with build_opener(HTTPCookieProcessor()).open(url + "?t=" + token, timeout=5) as response:
                    self.assertIn(b"<!DOCTYPE html>", response.read())
                self.assertTrue((runtime / "licenses/marked-LICENSE.md").is_file())
                self.assertIn("python3 scripts/reader.py", (runtime / "README.txt").read_text())
            finally:
                process.terminate()
                process.wait(timeout=10)

    def test_silent_live_runtime_fails_promptly_and_is_reaped(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                   stdout=subprocess.PIPE, text=True)
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                wait_for_url(process, timeout=0.1)
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stdout.close()
        self.assertLess(time.monotonic() - started, 5)
        self.assertIsNotNone(process.returncode)

    def test_same_version_in_all_finished_archives_passes(self):
        self.assertEqual(self.check()["version"], self.version)

    def test_tag_disagreement_blocks_publication(self):
        with self.assertRaisesRegex(ValueError, "tag"):
            self.check("v0.0.0")

    def test_each_native_version_field_blocks_publication_when_stale(self):
        for field in ("CFBundleShortVersionString", "CFBundleVersion", "Resources/VERSION"):
            with self.subTest(field=field):
                files = dict(self.native_files)
                if field == "Resources/VERSION":
                    files["Reader.app/Contents/Resources/VERSION"] = b"0.0.0"
                else:
                    info = plistlib.loads(files["Reader.app/Contents/Info.plist"])
                    info[field] = "0.0.0"
                    files["Reader.app/Contents/Info.plist"] = plistlib.dumps(info)
                self.write_zip(self.native, files)
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, "Native"):
                    self.check()

    def test_stale_web_version_blocks_publication(self):
        with zipfile.ZipFile(self.web) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        files[f"Reader-web-{self.version}/VERSION"] = b"0.0.0"
        self.write_zip(self.web, files)
        with self.assertRaisesRegex(ValueError, "Web"):
            self.check()

    def test_missing_or_changed_web_assets_block_publication(self):
        with zipfile.ZipFile(self.web) as archive:
            original = {name: archive.read(name) for name in archive.namelist()}
        asset = f"Reader-web-{self.version}/src/reader/web/index.html"
        for missing in (False, True):
            with self.subTest(missing=missing):
                files = dict(original)
                if missing:
                    del files[asset]
                else:
                    files[asset] = b"broken UI"
                self.write_zip(self.web, files)
                with self.assertRaisesRegex(ValueError, "Web"):
                    self.check()

    def test_stale_or_development_plugin_blocks_publication(self):
        for field, value in (("version", "0.0.0"), ("name", "reader-markdown-dev")):
            with self.subTest(field=field):
                files = dict(self.plugin_files)
                manifest = json.loads(files["reader-markdown/plugin.json"])
                manifest[field] = value
                files["reader-markdown/plugin.json"] = json.dumps(manifest).encode()
                self.write_zip(self.plugin, files)
                with self.assertRaisesRegex(ValueError, "Plugin"):
                    self.check()

    def test_corrupt_updater_digest_blocks_publication(self):
        manifest = json.loads(self.manifest.read_text())
        manifest["sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "manifest"):
            self.check()

    def test_web_packaging_rejects_private_files_stale_versions_and_overwrite(self):
        with self.assertRaisesRegex(ValueError, "already exist"):
            release.archive_web(self.runtime, ROOT / "VERSION", self.root)
        self.web.unlink()
        private = self.runtime / ".env"
        private.write_text("private")
        with self.assertRaisesRegex(ValueError, "Release files differ"):
            release.archive_web(self.runtime, ROOT / "VERSION", self.root)
        private.unlink()
        (self.runtime / "VERSION").write_text("0.0.0")
        with self.assertRaisesRegex(ValueError, "Web"):
            release.archive_web(self.runtime, ROOT / "VERSION", self.root)
        self.assertFalse(self.web.exists())

    def test_archive_traversal_blocks_publication(self):
        with zipfile.ZipFile(self.web, "a") as archive:
            archive.writestr("../outside", "unsafe")
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.check()


if __name__ == "__main__":
    unittest.main()
