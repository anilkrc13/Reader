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


if __name__ == "__main__":
    unittest.main()
