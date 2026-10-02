"""Files with no extension are offered in the tree and judged by their content
when opened, so a script named `bulk_read` or a `Makefile` reads like any other
document while a compiled binary is refused with a clear message."""
import tempfile
import unittest
from pathlib import Path

from reader_backend import DocumentStore, FileAccessPolicy, looks_binary


class ExtensionlessFileTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="reader-extensionless-")
        root = Path(self.tempdir.name)
        self.workspace = root / "workspace"
        self.home = root / "home"
        for folder in (self.workspace, self.home, root / "project"):
            folder.mkdir(parents=True)
        self.script = self.workspace / "bulk_read"
        self.script.write_text("#!/usr/bin/env python3\nprint('hi')\n", encoding="utf-8")
        self.binary = self.workspace / "tool"
        self.binary.write_bytes(b"\x7fELF\x02\x01\x01\x00\x00\x00rest")
        (self.workspace / "notes.md").write_text("# notes\n", encoding="utf-8")
        (self.workspace / "photo.png").write_bytes(b"\x89PNG\r\n")
        policy = FileAccessPolicy(root / "project", [self.workspace], home=self.home)
        self.store = DocumentStore(policy)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_extensionless_files_are_listed_as_ordinary_documents(self):
        listing = self.store.list_dir(self.workspace)
        by_name = {f["name"]: f for f in listing["entries"] if f["type"] == "file"}
        self.assertIn("bulk_read", by_name)
        self.assertNotIn("supported", by_name["bulk_read"])
        # the binary is only found out on click, by design: listing stays cheap
        self.assertIn("tool", by_name)
        self.assertNotIn("photo.png", by_name)

    def test_text_without_extension_opens(self):
        doc = self.store.read_text_file(self.script)
        self.assertTrue(doc["text"].startswith("#!/usr/bin/env python3"))

    def test_binary_without_extension_is_refused_on_open(self):
        with self.assertRaises(ValueError) as caught:
            self.store.read_text_file(self.binary)
        self.assertIn("not text", str(caught.exception))

    def test_binary_without_extension_cannot_be_saved_over(self):
        with self.assertRaises(ValueError):
            self.store.policy.assert_save_allowed(self.binary)

    def test_text_without_extension_can_be_saved(self):
        allowed = self.store.policy.assert_save_allowed(self.script)
        self.assertEqual(allowed, self.script.resolve())

    def test_unknown_extension_is_still_refused_without_sniffing(self):
        odd = self.workspace / "data.bin"
        odd.write_text("plain text inside", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.store.read_text_file(odd)

    def test_looks_binary_is_a_nul_check_on_the_head(self):
        self.assertTrue(looks_binary(b"abc\x00def"))
        self.assertFalse(looks_binary("héllo wörld".encode("utf-8")))
