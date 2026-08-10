import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import reader
from reader_backend import MAX_TEXT_BYTES, DocumentStore, FileAccessPolicy


class SaveAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="reader-save-tests-")
        root = Path(self.tempdir.name)
        self.workspace = root / "workspace"
        self.project = self.workspace / "reader-project"
        self.outside = root / "outside"
        self.workspace.mkdir()
        self.project.mkdir()
        self.outside.mkdir()

        self.allowed = self.workspace / "notes.md"
        self.allowed.write_text("before", encoding="utf-8")
        self.protected = self.project / "reader.py"
        self.protected.write_text("print('protected')\n", encoding="utf-8")
        self.unsupported = self.workspace / "notes.pdf"
        self.out_of_scope = self.outside / "notes.md"

        policy = FileAccessPolicy(self.project, [self.workspace], home=root / "home")
        self.server = reader.Server(("127.0.0.1", 0), reader.Handler)
        self.server.documents = DocumentStore(policy)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.tempdir.cleanup()

    def post_save(self, path: Path, text: str):
        body = json.dumps({"path": str(path), "text": text}).encode("utf-8")
        request = Request(
            self.base_url + "/api/save",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Reader-Token": reader.TOKEN,
            },
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                return error.code, json.loads(error.read().decode("utf-8"))
            finally:
                error.close()

    def test_allowed_text_save_is_written(self):
        status, result = self.post_save(self.allowed, "after")

        self.assertEqual(status, 200)
        self.assertEqual(Path(result["path"]), self.allowed.resolve())
        self.assertEqual(self.allowed.read_text(encoding="utf-8"), "after")

    def test_protected_project_target_is_rejected(self):
        original = self.protected.read_text(encoding="utf-8")

        status, result = self.post_save(self.protected, "overwritten")

        self.assertEqual(status, 403)
        self.assertEqual(result["error"], "permission denied")
        self.assertEqual(self.protected.read_text(encoding="utf-8"), original)

    def test_unsupported_type_is_rejected(self):
        status, result = self.post_save(self.unsupported, "not a PDF")

        self.assertEqual(status, 400)
        self.assertIn("supported text document", result["error"])
        self.assertFalse(self.unsupported.exists())

    def test_out_of_scope_target_is_rejected(self):
        status, result = self.post_save(self.out_of_scope, "outside")

        self.assertEqual(status, 403)
        self.assertEqual(result["error"], "permission denied")
        self.assertFalse(self.out_of_scope.exists())

    def test_symlink_cannot_reach_protected_project_file(self):
        link = self.workspace / "linked.md"
        link.symlink_to(self.protected)

        status, result = self.post_save(link, "through the link")

        self.assertEqual(status, 403)
        self.assertEqual(result["error"], "permission denied")
        self.assertEqual(self.protected.read_text(encoding="utf-8"), "print('protected')\n")

    def test_text_byte_limit_is_enforced_by_storage(self):
        store = self.server.documents
        with self.assertRaises(ValueError):
            store.write_text_file(self.allowed, "x" * (MAX_TEXT_BYTES + 1), None)
        self.assertEqual(self.allowed.read_text(encoding="utf-8"), "before")


if __name__ == "__main__":
    unittest.main()
