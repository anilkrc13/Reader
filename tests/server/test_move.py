import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import reader
from reader_backend import DocumentStore, FileAccessPolicy


class MoveFileTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="reader-move-tests-")
        root = Path(self.tempdir.name)
        self.workspace = root / "workspace"
        self.project = self.workspace / "reader-project"
        self.home = root / "home"
        self.source = self.workspace / "source"
        self.target = self.workspace / "target"
        self.project.mkdir(parents=True)
        self.home.mkdir()
        self.source.mkdir()
        self.target.mkdir()
        self.file = self.source / "note.md"
        self.file.write_text("move me", encoding="utf-8")

        policy = FileAccessPolicy(self.project, [self.workspace], home=self.home)
        self.store = DocumentStore(policy)
        self.server = reader.Server(("127.0.0.1", 0), reader.Handler)
        self.server.documents = self.store
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.tempdir.cleanup()

    def post_move(self, path, target_dir):
        body = json.dumps({"path": str(path), "targetDir": str(target_dir)}).encode("utf-8")
        request = Request(
            self.base_url + "/api/move",
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

    def test_move_is_not_a_copy(self):
        status, result = self.post_move(self.file, self.target)
        moved = self.target / self.file.name

        self.assertEqual(status, 200)
        self.assertFalse(self.file.exists())
        self.assertEqual(moved.read_text(encoding="utf-8"), "move me")
        self.assertEqual(Path(result["newPath"]), moved.resolve())

    def test_existing_destination_is_preserved(self):
        destination = self.target / self.file.name
        destination.write_text("keep this", encoding="utf-8")

        status, result = self.post_move(self.file, self.target)

        self.assertEqual(status, 409)
        self.assertIn("already there", result["error"])
        self.assertEqual(self.file.read_text(encoding="utf-8"), "move me")
        self.assertEqual(destination.read_text(encoding="utf-8"), "keep this")

    def test_folders_cannot_be_moved(self):
        status, result = self.post_move(self.source, self.target)

        self.assertEqual(status, 400)
        self.assertIn("folders cannot be moved", result["error"])
        self.assertTrue(self.source.is_dir())


if __name__ == "__main__":
    unittest.main()
