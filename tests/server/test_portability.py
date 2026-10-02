"""Platform-dispatch tests for Phase 3 (server portability).

These pin behaviour on the current platform by mocking sys.platform rather
than requiring an actual Windows or Linux machine, per docs/release-plan.md
section 3 and CONTRIBUTING.md's Portability section. sys.platform is used
(rather than os.name) throughout the source and here for a specific reason:
pathlib's Path() picks WindowsPath vs PosixPath by checking os.name at every
construction, so patching os.name globally on a POSIX test runner breaks
ordinary path handling deep inside the code under test. sys.platform carries
no such side effect.

None of these tests call os.startfile or SHFileOperationW for real -- both
are mocked so the suite stays safe to run anywhere, including this repo's own
macOS CI runner.
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import reader
from reader_backend import DocumentStore, FileAccessPolicy, WorkspaceError


class DefaultDataDirTests(unittest.TestCase):
    """default_data_dir() must keep macOS exactly as it was and give Windows
    and everything else their own conventional per-user data folder."""

    def test_macos_uses_library_application_support(self):
        with patch("reader.sys.platform", "darwin"):
            result = reader.default_data_dir()
        self.assertEqual(result, Path.home() / "Library" / "Application Support" / "Reader")

    def test_windows_uses_appdata_when_set(self):
        with patch("reader.sys.platform", "win32"), \
             patch.dict(os.environ, {"APPDATA": r"C:\Users\test\AppData\Roaming"}):
            result = reader.default_data_dir()
        self.assertEqual(result, Path(r"C:\Users\test\AppData\Roaming") / "Reader")

    def test_windows_falls_back_when_appdata_missing(self):
        env = os.environ.copy()
        env.pop("APPDATA", None)
        with patch("reader.sys.platform", "win32"), \
             patch.dict(os.environ, env, clear=True):
            result = reader.default_data_dir()
        self.assertEqual(result, Path.home() / "AppData" / "Roaming" / "Reader")

    def test_linux_uses_xdg_data_home_when_set(self):
        with patch("reader.sys.platform", "linux"), \
             patch.dict(os.environ, {"XDG_DATA_HOME": "/tmp/xdg-data"}):
            result = reader.default_data_dir()
        self.assertEqual(result, Path("/tmp/xdg-data") / "reader")

    def test_linux_falls_back_to_local_share(self):
        env = os.environ.copy()
        env.pop("XDG_DATA_HOME", None)
        with patch("reader.sys.platform", "linux"), \
             patch.dict(os.environ, env, clear=True):
            result = reader.default_data_dir()
        self.assertEqual(result, Path.home() / ".local" / "share" / "reader")


class OpenWithDefaultAppTests(unittest.TestCase):
    """The open-external route must dispatch on platform without ever
    shelling out to the wrong launcher, and must map every failure mode to
    the same (message-or-None) shape regardless of platform."""

    def test_macos_runs_open(self):
        # str(Path(...)), not a hardcoded literal: on a Windows test runner
        # the same Path renders with backslashes, and this dispatch is being
        # exercised there too (via a mocked sys.platform), so the expected
        # argument must go through the same platform-native conversion the
        # code under test uses.
        target = Path("/tmp/thing.docx")
        completed = subprocess.CompletedProcess(["open"], 0, stdout=b"", stderr=b"")
        with patch("reader.sys.platform", "darwin"), \
             patch("reader.subprocess.run", return_value=completed) as run:
            error = reader.open_with_default_app(target)
        self.assertIsNone(error)
        run.assert_called_once_with(["open", str(target)], capture_output=True, timeout=15)

    def test_macos_reports_stderr_on_failure(self):
        completed = subprocess.CompletedProcess(["open"], 1, stdout=b"", stderr=b"no app")
        with patch("reader.sys.platform", "darwin"), \
             patch("reader.subprocess.run", return_value=completed):
            error = reader.open_with_default_app(Path("/tmp/thing.docx"))
        self.assertEqual(error, "no app")

    def test_windows_uses_os_startfile(self):
        with patch("reader.sys.platform", "win32"), \
             patch("reader.os.startfile", create=True) as startfile:
            error = reader.open_with_default_app(Path(r"C:\Users\test\thing.docx"))
        self.assertIsNone(error)
        startfile.assert_called_once_with(r"C:\Users\test\thing.docx")

    def test_windows_startfile_failure_has_no_stderr_to_read(self):
        """os.startfile has no captured process output, so a failure there
        must still produce the same kind of error message the macOS and
        Linux branches produce -- not a crash from assuming stderr exists."""
        with patch("reader.sys.platform", "win32"), \
             patch("reader.os.startfile", create=True, side_effect=OSError("no association")):
            error = reader.open_with_default_app(Path(r"C:\Users\test\thing.docx"))
        self.assertEqual(error, "no association")

    def test_linux_runs_xdg_open(self):
        target = Path("/tmp/thing.docx")  # see test_macos_runs_open for why
        completed = subprocess.CompletedProcess(["xdg-open"], 0, stdout=b"", stderr=b"")
        with patch("reader.sys.platform", "linux"), \
             patch("reader.subprocess.run", return_value=completed) as run:
            error = reader.open_with_default_app(target)
        self.assertIsNone(error)
        run.assert_called_once_with(["xdg-open", str(target)], capture_output=True, timeout=15)

    def test_linux_missing_xdg_open_is_reported(self):
        with patch("reader.sys.platform", "linux"), \
             patch("reader.subprocess.run", side_effect=FileNotFoundError()):
            error = reader.open_with_default_app(Path("/tmp/thing.docx"))
        self.assertEqual(error, "xdg-open is not installed")


class RecycleBinTrashTests(unittest.TestCase):
    """move_to_trash's Windows path: try the Recycle Bin first via a mocked
    SHFileOperationW, then fall back to a Reader-owned Trash folder inside
    the platform data directory -- which must still pass
    assert_mutation_allowed, exactly like the macOS/XDG Trash folders do."""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="reader-trash-portability-")
        root = Path(self.tempdir.name)
        self.workspace = root / "workspace"
        self.project = root / "reader-project"
        self.home = root / "home"
        # Nested under home, mirroring where default_data_dir() actually
        # lands on every platform (Library/Application Support, AppData, or
        # .local/share are all inside the user's home folder).
        self.data_dir = self.home / "data"
        for folder in (self.workspace, self.project, self.home, self.data_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self.note = self.workspace / "note.md"
        self.note.write_text("trash me", encoding="utf-8")

    def tearDown(self):
        self.tempdir.cleanup()

    def _store(self):
        policy = FileAccessPolicy(self.project, [self.workspace, self.home],
                                   home=self.home, data_dir=self.data_dir)
        return DocumentStore(policy)

    def test_windows_success_uses_recycle_bin_and_skips_the_fallback_folder(self):
        store = self._store()
        fake_windll = MagicMock()
        fake_windll.shell32.SHFileOperationW.return_value = 0

        with patch("reader_backend.sys.platform", "win32"), \
             patch("ctypes.windll", fake_windll, create=True):
            result = store.move_to_trash(self.note)

        # SHFileOperationW is mocked, so it does not actually touch the disk;
        # what this pins is the dispatch, not the OS call's own effect.
        self.assertEqual(result["trashed"], "Recycle Bin")
        fake_windll.shell32.SHFileOperationW.assert_called_once()
        self.assertFalse((self.data_dir / "Trash").exists())

    def test_windows_recycle_bin_failure_falls_back_to_reader_owned_trash(self):
        store = self._store()

        with patch("reader_backend.sys.platform", "win32"), \
             patch.object(DocumentStore, "_trash_via_recycle_bin", return_value=None):
            result = store.move_to_trash(self.note)

        fallback = self.data_dir / "Trash" / "note.md"
        self.assertEqual(Path(result["trashed"]), fallback.resolve())
        self.assertTrue(fallback.exists())
        self.assertFalse(self.note.exists())

    def test_reader_owned_trash_fallback_still_obeys_assert_mutation_allowed(self):
        """The fallback folder is inside data_dir, which this test points at
        a path outside every grant. move_to_trash must still refuse it --
        the fallback is not a bypass of the mutation boundary."""
        outside_data_dir = Path(tempfile.mkdtemp(prefix="reader-outside-data-"))
        try:
            policy = FileAccessPolicy(self.project, [self.workspace],
                                       home=self.home, data_dir=outside_data_dir)
            store = DocumentStore(policy)
            with patch("reader_backend.sys.platform", "win32"), \
                 patch.object(DocumentStore, "_trash_via_recycle_bin", return_value=None):
                with self.assertRaises(WorkspaceError):
                    store.move_to_trash(self.note)
            self.assertTrue(self.note.exists())
            self.assertFalse((outside_data_dir / "Trash").exists())
        finally:
            import shutil
            shutil.rmtree(outside_data_dir, ignore_errors=True)

    def test_recycle_bin_helper_is_a_noop_off_windows(self):
        with patch("reader_backend.sys.platform", "darwin"):
            self.assertIsNone(DocumentStore._trash_via_recycle_bin(self.note))


class TokenAclTests(unittest.TestCase):
    """The Windows ACL tightening after writing the token is best effort and
    must never be attempted, or fail loudly, on a non-Windows platform."""

    def test_icacls_runs_on_windows_after_writing_the_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".reader-token"
            with patch("reader.sys.platform", "win32"), \
                 patch.dict(os.environ, {"USERNAME": "alice"}), \
                 patch("reader.subprocess.run") as run:
                reader._rewrite_token(path, "a-token-value")
            self.assertEqual(path.read_text(encoding="utf-8"), "a-token-value")
            run.assert_called_once()
            args = run.call_args[0][0]
            self.assertEqual(args[0], "icacls")
            self.assertIn(str(path), args)
            self.assertIn("/inheritance:r", args)
            self.assertIn("alice:F", args[-1])

    def test_icacls_is_not_attempted_off_windows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".reader-token"
            with patch("reader.sys.platform", "darwin"), \
                 patch("reader.subprocess.run") as run:
                reader._rewrite_token(path, "a-token-value")
            run.assert_not_called()

    def test_icacls_failure_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".reader-token"
            with patch("reader.sys.platform", "win32"), \
                 patch.dict(os.environ, {"USERNAME": "alice"}), \
                 patch("reader.subprocess.run", side_effect=OSError("no icacls")):
                reader._rewrite_token(path, "a-token-value")  # must not raise
            self.assertEqual(path.read_text(encoding="utf-8"), "a-token-value")


if __name__ == "__main__":
    unittest.main()
