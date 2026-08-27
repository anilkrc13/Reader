import tempfile
import unittest
from pathlib import Path

import reader_backend
from reader_backend import DocumentStore, FileAccessPolicy


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def store_for(home: Path) -> DocumentStore:
    return DocumentStore(FileAccessPolicy(PROJECT_ROOT, [home], home=home))


class FileSearchTests(unittest.TestCase):
    def test_finds_documents_in_unexpanded_folders(self):
        """The point of searching on the server: reach folders the tree never
        opened, which the browser has no listing for."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            deep = home / "one" / "two" / "three"
            deep.mkdir(parents=True)
            (home / "report.md").write_text("a", encoding="utf-8")
            (deep / "buried-report.md").write_text("b", encoding="utf-8")

            found = store_for(home).find_files(home, "report")
            names = [item["name"] for item in found["matches"]]

            self.assertEqual(names, ["report.md", "buried-report.md"])
            self.assertFalse(found["truncated"])

    def test_prefix_matches_rank_before_contained_ones(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            (home / "notes.md").write_text("a", encoding="utf-8")
            (home / "my-notes.md").write_text("b", encoding="utf-8")

            names = [m["name"] for m in store_for(home).find_files(home, "notes")["matches"]]

            self.assertEqual(names, ["notes.md", "my-notes.md"])

    def test_match_is_case_insensitive(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            (home / "README.md").write_text("a", encoding="utf-8")

            names = [m["name"] for m in store_for(home).find_files(home, "readme")["matches"]]

            self.assertEqual(names, ["README.md"])

    def test_hidden_and_unsupported_files_are_opt_in(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            (home / ".secret-notes.md").write_text("a", encoding="utf-8")
            (home / "notes.bin").write_text("b", encoding="utf-8")
            (home / "notes.md").write_text("c", encoding="utf-8")
            store = store_for(home)

            plain = {m["name"] for m in store.find_files(home, "notes")["matches"]}
            hidden = {m["name"] for m in
                      store.find_files(home, "notes", include_hidden=True)["matches"]}
            unsupported = store.find_files(home, "notes", include_files=True)["matches"]

            self.assertEqual(plain, {"notes.md"})
            self.assertEqual(hidden, {"notes.md", ".secret-notes.md"})
            self.assertIn("notes.bin", {m["name"] for m in unsupported})
            self.assertFalse(next(m for m in unsupported
                                  if m["name"] == "notes.bin")["supported"])

    def test_noise_folders_are_never_descended(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            junk = home / "node_modules" / "pkg"
            junk.mkdir(parents=True)
            (junk / "notes.md").write_text("a", encoding="utf-8")

            self.assertEqual(store_for(home).find_files(home, "notes")["matches"], [])

    def test_typed_search_does_enter_the_protected_home_folders(self):
        """Drawing the tree must not probe Desktop, Documents or Downloads on its
        own initiative. A query the reader typed is the opposite case: it is an
        explicit request to look there, so the search goes in. Music stays out --
        the access policy refuses that path outright."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            for name in ("Desktop", "Documents", "Downloads", "Music"):
                (home / name).mkdir()
                (home / name / "notes.md").write_text("a", encoding="utf-8")
            (home / "Plain").mkdir()
            (home / "Plain" / "notes.md").write_text("b", encoding="utf-8")

            dirs = {Path(m["dir"]).name
                    for m in store_for(home).find_files(home, "notes")["matches"]}

            self.assertEqual(dirs, {"Desktop", "Documents", "Downloads", "Plain"})

    def test_tree_listing_still_refuses_to_probe_those_folders(self):
        """The search change must not have loosened the listing rule with it."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            for name in ("Desktop", "Documents", "Downloads", "Music"):
                (home / name).mkdir()
                (home / name / "notes.md").write_text("a", encoding="utf-8")

            names = {e["name"] for e in store_for(home).list_dir(home)["entries"]}

            self.assertEqual(names, set())

    def test_cache_and_build_trees_are_not_searched(self):
        """A Home-wide search used to spend its whole entry budget in these and
        report three matches where there were fifty-six."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            buried = {
                ".git": "notes.md",
                "Caches": "notes.md",
                "DerivedData": "notes.md",
                "Application Support": "notes.md",
                "build": "notes.md",
                ".pytest_cache": "notes.md",
            }
            for folder, doc in buried.items():
                (home / folder).mkdir()
                (home / folder / doc).write_text("a", encoding="utf-8")
            # the Go module cache hides under an unremarkable name
            gomod = home / "go" / "pkg" / "mod" / "example.com"
            gomod.mkdir(parents=True)
            (gomod / "notes.md").write_text("a", encoding="utf-8")
            (home / "real").mkdir()
            (home / "real" / "notes.md").write_text("b", encoding="utf-8")

            found = store_for(home).find_files(home, "notes", include_hidden=True)
            dirs = {Path(m["dir"]).name for m in found["matches"]}

            self.assertEqual(dirs, {"real"})

    def test_cloud_folders_under_library_are_still_searched(self):
        """Google Drive, OneDrive and iCloud Drive live under ~/Library and hold
        the reader's own documents, so Library must not be skipped wholesale."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            drive = home / "Library" / "CloudStorage" / "GoogleDrive-someone"
            drive.mkdir(parents=True)
            (drive / "notes.md").write_text("a", encoding="utf-8")
            cache = home / "Library" / "Caches" / "some.app"
            cache.mkdir(parents=True)
            (cache / "notes.md").write_text("b", encoding="utf-8")

            paths = [m["path"] for m in store_for(home).find_files(home, "notes")["matches"]]

            self.assertEqual(len(paths), 1)
            self.assertIn("CloudStorage", paths[0])

    def test_empty_query_matches_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            (home / "notes.md").write_text("a", encoding="utf-8")

            for query in ("", "   "):
                found = store_for(home).find_files(home, query)
                self.assertEqual(found["matches"], [])
                self.assertFalse(found["truncated"])

    def test_result_count_is_capped_and_says_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            for i in range(reader_backend.SEARCH_RESULTS + 15):
                (home / f"notes-{i:03d}.md").write_text("a", encoding="utf-8")

            found = store_for(home).find_files(home, "notes")

            self.assertEqual(len(found["matches"]), reader_backend.SEARCH_RESULTS)
            self.assertTrue(found["truncated"])

    def test_depth_is_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            deeper = home
            for i in range(reader_backend.SEARCH_DEPTH + 3):
                deeper = deeper / f"level{i}"
            deeper.mkdir(parents=True)
            (deeper / "notes.md").write_text("a", encoding="utf-8")

            self.assertEqual(store_for(home).find_files(home, "notes")["matches"], [])

    def test_searching_a_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            target = home / "notes.md"
            target.write_text("a", encoding="utf-8")

            with self.assertRaises(NotADirectoryError):
                store_for(home).find_files(target, "notes")


if __name__ == "__main__":
    unittest.main()
