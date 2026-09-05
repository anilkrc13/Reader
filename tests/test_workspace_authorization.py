import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import reader
from reader_backend import DocumentStore, FileAccessPolicy, WorkspaceError


class WorkspaceMutationAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="reader-workspace-auth-")
        root = Path(self.tempdir.name)
        self.workspace = root / "workspace"
        self.outside = root / "outside"
        self.home = root / "home"
        self.project = root / "reader-project"
        for folder in (self.workspace, self.outside, self.home, self.project,
                       self.home / ".Trash", self.workspace / "target"):
            folder.mkdir(parents=True, exist_ok=True)
        self.inside_file = self.workspace / "inside.md"
        self.inside_file.write_text("inside", encoding="utf-8")
        self.outside_file = self.outside / "outside.md"
        self.outside_file.write_text("outside", encoding="utf-8")
        (self.workspace / "escape").symlink_to(self.outside, target_is_directory=True)

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

    def post(self, route, payload):
        request = Request(
            self.base_url + route,
            data=json.dumps(payload).encode("utf-8"),
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

    def assert_forbidden_unchanged(self, route, payload, protected_path=None):
        protected_path = protected_path or self.outside_file
        original = protected_path.read_text(encoding="utf-8")
        status, result = self.post(route, payload)
        self.assertEqual(status, 403, result)
        self.assertIn("outside Reader's allowed folders", result["error"])
        self.assertTrue(protected_path.exists())
        self.assertEqual(protected_path.read_text(encoding="utf-8"), original)

    def test_direct_store_rejects_every_mutation_outside_granted_roots(self):
        operations = {
            "save": lambda note: self.store.write_text_file(note, "changed", None),
            "create": lambda _note: self.store.create_document(self.outside, "created"),
            "rename": lambda note: self.store.rename_path(note, "renamed.md"),
            "move": lambda note: self.store.move_file(note, self.workspace / "target"),
            "trash": lambda note: self.store.move_to_trash(note),
        }

        for index, (name, operation) in enumerate(operations.items()):
            note = self.outside / f"direct-{index}.md"
            note.write_text("outside", encoding="utf-8")
            with self.subTest(operation=name):
                with self.assertRaises(WorkspaceError):
                    operation(note)
                self.assertTrue(note.exists())
                self.assertEqual(note.read_text(encoding="utf-8"), "outside")

        self.assertFalse((self.outside / "created.md").exists())

    def test_every_mutation_route_refuses_an_outside_source_or_destination(self):
        cases = []
        for index, operation in enumerate(("save", "create", "rename", "move-source",
                                           "move-destination", "delete")):
            outside_file = self.outside / f"outside-{index}.md"
            outside_file.write_text("outside", encoding="utf-8")
            inside_file = self.workspace / f"inside-{index}.md"
            inside_file.write_text("inside", encoding="utf-8")
            if operation == "save":
                case = ("/api/save", {"path": str(outside_file), "text": "changed"}, outside_file)
            elif operation == "create":
                case = ("/api/create", {"dir": str(self.outside), "name": "new.md"}, outside_file)
            elif operation == "rename":
                case = ("/api/rename", {"path": str(outside_file), "name": "renamed.md"}, outside_file)
            elif operation == "move-source":
                case = ("/api/move", {"path": str(outside_file),
                                      "targetDir": str(self.workspace / "target")}, outside_file)
            elif operation == "move-destination":
                case = ("/api/move", {"path": str(inside_file),
                                      "targetDir": str(self.outside)}, inside_file)
            else:
                case = ("/api/delete", {"path": str(outside_file)}, outside_file)
            cases.append(case)

        for route, payload, protected_path in cases:
            with self.subTest(route=route, payload=payload):
                self.assert_forbidden_unchanged(route, payload, protected_path)

        self.assertTrue(self.inside_file.exists())
        self.assertFalse((self.outside / "new.md").exists())
        self.assertFalse((self.outside / "inside.md").exists())

    def test_symlink_cannot_turn_any_mutation_destination_into_an_outside_path(self):
        escape = self.workspace / "escape"
        cases = [
            ("/api/save", {"path": str(escape / "new.md"), "text": "changed"}),
            ("/api/create", {"dir": str(escape), "name": "new.md"}),
            ("/api/move", {"path": str(self.inside_file), "targetDir": str(escape)}),
        ]

        for route, payload in cases:
            with self.subTest(route=route):
                status, result = self.post(route, payload)
                self.assertEqual(status, 403, result)
                self.assertIn("outside Reader's allowed folders", result["error"])

        self.assertTrue(self.inside_file.exists())
        self.assertFalse((self.outside / "new.md").exists())
        self.assertFalse((self.outside / "inside.md").exists())

    def test_symlink_source_cannot_rename_move_or_trash_an_outside_file(self):
        cases = []
        for index, route in enumerate(("/api/rename", "/api/move", "/api/delete")):
            outside_file = self.outside / f"linked-target-{index}.md"
            outside_file.write_text("outside", encoding="utf-8")
            link = self.workspace / f"linked-{index}.md"
            link.symlink_to(outside_file)
            payload = {"path": str(link)}
            if route == "/api/rename":
                payload["name"] = "renamed.md"
            elif route == "/api/move":
                payload["targetDir"] = str(self.workspace / "target")
            cases.append((route, payload, outside_file))

        for route, payload, outside_file in cases:
            with self.subTest(route=route):
                self.assert_forbidden_unchanged(route, payload, outside_file)

    def test_symlinked_trash_cannot_move_an_authorized_file_outside_grants(self):
        trash = self.home / ".Trash"
        trash.rmdir()
        trash.symlink_to(self.outside, target_is_directory=True)
        store = DocumentStore(FileAccessPolicy(
            self.project, [self.workspace, self.home], home=self.home))

        # This test pins the ~/.Trash symlink defence specifically, not the
        # Windows Recycle Bin path -- on real Windows that native call would
        # otherwise take the file before the symlinked bin_dir is ever
        # reached, so the defence below would go untested there.
        with patch.object(DocumentStore, "_trash_via_recycle_bin", return_value=None):
            with self.assertRaises(WorkspaceError):
                store.move_to_trash(self.inside_file)

        self.assertTrue(self.inside_file.exists())
        self.assertEqual(self.inside_file.read_text(encoding="utf-8"), "inside")
        self.assertFalse((self.outside / self.inside_file.name).exists())

    def test_authorized_trash_still_moves_the_file_and_avoids_a_collision(self):
        trash = self.home / ".Trash"
        existing = trash / self.inside_file.name
        existing.write_text("already trashed", encoding="utf-8")
        store = DocumentStore(FileAccessPolicy(
            self.project, [self.workspace, self.home], home=self.home))

        # Same reason as above: this pins the ~/.Trash file-move mechanics
        # (the collision-avoiding rename), which the real Windows Recycle
        # Bin would otherwise short-circuit before it runs.
        with patch.object(DocumentStore, "_trash_via_recycle_bin", return_value=None):
            result = store.move_to_trash(self.inside_file)

        moved = trash / "inside 2.md"
        self.assertEqual(Path(result["trashed"]), moved.resolve())
        self.assertFalse(self.inside_file.exists())
        self.assertEqual(existing.read_text(encoding="utf-8"), "already trashed")
        self.assertEqual(moved.read_text(encoding="utf-8"), "inside")

    def test_read_result_reports_server_grant_without_making_read_authorization_mutable(self):
        inside = self.server.documents.read_text_file(self.inside_file.resolve())
        outside = self.server.documents.read_text_file(self.outside_file.resolve())

        self.assertTrue(inside["writable"])
        self.assertFalse(outside["writable"])


if __name__ == "__main__":
    unittest.main()
