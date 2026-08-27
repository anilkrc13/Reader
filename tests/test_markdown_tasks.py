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


if __name__ == "__main__":
    unittest.main()
