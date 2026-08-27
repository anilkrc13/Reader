import unittest

from reader_backend import (EXTERNAL_APP_SUFFIXES, IMAGE_SUFFIXES,
                            LISTABLE_SUFFIXES, TEXT_SUFFIXES)


class ExternalOpenWhitelistTests(unittest.TestCase):
    """The /api/open-external route runs `open` on the path it is given, so the
    set of suffixes it accepts is a security boundary rather than a convenience.
    "Anything Reader cannot display" would be the natural-sounding rule and is
    the wrong one: it admits .app, .command and .sh."""

    def test_nothing_executable_is_accepted(self):
        for suffix in (".app", ".command", ".sh", ".bash", ".zsh", ".scpt",
                       ".applescript", ".pkg", ".dmg", ".workflow", ".terminal",
                       ".py", ".rb", ".pl", ".jar", ".shortcut"):
            self.assertNotIn(suffix, EXTERNAL_APP_SUFFIXES, suffix)

    def test_office_documents_are_accepted(self):
        for suffix in (".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt",
                       ".pptx", ".pages", ".numbers", ".key", ".rtf",
                       ".odt", ".ods"):
            self.assertIn(suffix, EXTERNAL_APP_SUFFIXES, suffix)

    def test_images_are_accepted_so_a_link_to_one_leads_somewhere(self):
        """Reader lists no image in the tree and renders none as a document, so
        without this a link to one dead-ends on "not a text document"."""
        self.assertTrue(IMAGE_SUFFIXES)
        for suffix in IMAGE_SUFFIXES:
            self.assertIn(suffix, EXTERNAL_APP_SUFFIXES, suffix)

    def test_documents_reader_renders_itself_are_not_handed_away(self):
        """A .md or .csv going to another app would be a regression, not a
        feature: Reader opens those."""
        overlap = EXTERNAL_APP_SUFFIXES & TEXT_SUFFIXES
        self.assertEqual(overlap, set())
        self.assertNotIn(".pdf", EXTERNAL_APP_SUFFIXES)

    def test_images_are_still_not_listed_in_the_tree(self):
        """Handing images to Preview must not have made them tree entries; the
        listing and the hand-off are separate decisions."""
        self.assertEqual(IMAGE_SUFFIXES & LISTABLE_SUFFIXES, set())


if __name__ == "__main__":
    unittest.main()
