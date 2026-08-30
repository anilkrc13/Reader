import tempfile
import unittest
from pathlib import Path

from reader_backend import DocumentStore, FileAccessPolicy, WorkspaceError


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def store_for(home: Path) -> DocumentStore:
    return DocumentStore(FileAccessPolicy(PROJECT_ROOT, [home], home=home))


class CreateDocumentTests(unittest.TestCase):
    def test_creates_an_empty_markdown_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            res = store_for(home).create_document(home, "notes")

            target = Path(res["path"])
            self.assertEqual(target, home / "notes.md")
            self.assertEqual(target.read_text(encoding="utf-8"), "")
            self.assertEqual(res["name"], "notes.md")

    def test_explicit_markdown_extension_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            res = store_for(home).create_document(home, "notes.mdx")

            self.assertEqual(Path(res["path"]).name, "notes.mdx")

    def test_never_lands_on_an_existing_file(self):
        """The reason this is not a save: a save's whole purpose is to
        overwrite, and creating must never do that."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            existing = home / "notes.md"
            existing.write_text("precious", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                store_for(home).create_document(home, "notes")
            self.assertEqual(existing.read_text(encoding="utf-8"), "precious")

    def test_name_cannot_climb_out_of_the_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            inside = home / "inside"
            inside.mkdir()

            for name in ("../escape", "a/b", "..", "."):
                with self.assertRaises(ValueError, msg=name):
                    store_for(home).create_document(inside, name)
            self.assertEqual(list(home.glob("escape*")), [])

    def test_only_markdown_comes_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            for name in ("notes.sh", "notes.py", "notes.pdf", "notes.txt"):
                with self.assertRaises(ValueError, msg=name):
                    store_for(home).create_document(home, name)

    def test_hidden_names_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            with self.assertRaises(ValueError):
                store_for(home).create_document(home, ".secret")

    def test_creating_outside_the_workspace_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as other:
            home = Path(tmp).resolve()
            elsewhere = Path(other).resolve()

            with self.assertRaises(PermissionError):
                store_for(home).create_document(elsewhere, "notes")


class CanCreateInTests(unittest.TestCase):
    """The dialog asks this the moment a folder is chosen, so that a destination
    the policy will refuse is reported while it can still be changed."""

    def test_a_usable_folder_says_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            self.assertEqual(store_for(home).can_create_in(home)["ok"], True)

    def test_a_folder_outside_the_workspace_gives_the_actual_reason(self):
        """Not "permission denied" -- that named neither the cause nor the
        folder, and read identically to the operating system refusing."""
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as other:
            home = Path(tmp).resolve()
            verdict = store_for(home).can_create_in(Path(other).resolve())

            self.assertFalse(verdict["ok"])
            self.assertIn("outside Reader's allowed folders", verdict["reason"])

    def test_a_missing_folder_is_distinguished_from_an_unreadable_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            verdict = store_for(home).can_create_in(home / "not-there")

            self.assertFalse(verdict["ok"])
            self.assertIn("not there", verdict["reason"])

    def test_a_file_is_not_a_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            doc = home / "notes.md"
            doc.write_text("x", encoding="utf-8")

            verdict = store_for(home).can_create_in(doc)

            self.assertFalse(verdict["ok"])
            self.assertIn("not a folder", verdict["reason"])

    def test_a_read_only_folder_is_refused_before_a_name_is_typed(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            locked = home / "locked"
            locked.mkdir(mode=0o500)
            try:
                verdict = store_for(home).can_create_in(locked)
                self.assertFalse(verdict["ok"])
                self.assertIn("read-only", verdict["reason"])
            finally:
                locked.chmod(0o700)

    def test_create_refuses_the_same_folders_and_says_why(self):
        """The pre-check is a courtesy; the create call remains the boundary,
        because a POST can carry any folder it likes."""
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as other:
            home = Path(tmp).resolve()
            with self.assertRaises(WorkspaceError) as caught:
                store_for(home).create_document(Path(other).resolve(), "notes")
            self.assertIn("outside Reader's allowed folders", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
