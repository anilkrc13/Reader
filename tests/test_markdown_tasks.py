import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarkdownTaskRenderingTests(unittest.TestCase):
    def test_task_items_keep_checkbox_and_nested_details_in_flow(self):
        css = (ROOT / "static/app.css").read_text()
        task_rule = re.search(r"\.prose \.task-list-item\s*\{([^}]*)\}", css)
        self.assertIsNotNone(task_rule)
        declarations = task_rule.group(1)
        self.assertIn("display:block", declarations)

    def test_task_list_renderer_marks_checked_and_unchecked_items(self):
        js = (ROOT / "static/marked.min.js").read_text()
        self.assertIn('type="checkbox"', js)
        self.assertIn('checked=""', js)


class BlockquoteSpacingTests(unittest.TestCase):
    def test_paragraphs_inside_a_quote_do_not_get_the_document_gap(self):
        """A transcript is written as one ">" line per turn, separated by bare
        ">" lines, which markdown turns into separate paragraphs. With the
        document's paragraph gap those rendered a blank line between every turn.
        """
        css = (ROOT / "static/app.css").read_text()
        rule = re.search(r"\.prose blockquote p\{([^}]*)\}", css)

        self.assertIsNotNone(rule, "no rule sets paragraph spacing inside a quote")
        self.assertIn("margin-bottom", rule.group(1))
        self.assertNotIn("--para-gap", rule.group(1),
                         "quote spacing must not follow the document paragraph gap")

    def test_ordinary_paragraphs_keep_the_document_gap(self):
        css = (ROOT / "static/app.css").read_text()
        rule = re.search(r"\.prose p\{([^}]*)\}", css)

        self.assertIsNotNone(rule)
        self.assertIn("--para-gap", rule.group(1))


class ListMarkerTests(unittest.TestCase):
    def test_every_bullet_depth_uses_the_same_filled_disc(self):
        """Browsers step disc -> circle -> square as lists nest, so a sub-point
        arrived as a hollow ring and a sub-sub-point as a square. The indent
        already carries the nesting."""
        css = (ROOT / "static/app.css").read_text()
        rule = re.search(r"\.prose ul\{([^}]*)\}", css)

        self.assertIsNotNone(rule, "nothing pins the bullet at every depth")
        self.assertIn("list-style-type:disc", rule.group(1).replace(" ", ""))

    def test_task_lists_still_drop_their_marker(self):
        """A task list draws a checkbox instead, and must not gain a disc."""
        css = (ROOT / "static/app.css").read_text()
        rule = re.search(r"\.prose ul\.contains-task-list\{([^}]*)\}", css)

        self.assertIsNotNone(rule)
        self.assertIn("list-style:none", rule.group(1).replace(" ", ""))


if __name__ == "__main__":
    unittest.main()
