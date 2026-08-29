import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MermaidRenderingTests(unittest.TestCase):
    def test_mermaid_is_bundled_before_the_reader_script(self):
        html = (ROOT / "static/index.html").read_text()
        self.assertIn('<script src="/static/mermaid.min.js"></script>', html)
        self.assertLess(html.index("mermaid.min.js"), html.index("app.js"))

    def test_renderer_uses_strict_mermaid_and_sanitizes_svg(self):
        js = (ROOT / "static/app.js").read_text()
        self.assertIn('securityLevel: "strict"', js)
        self.assertIn('htmlLabels: false,', js)
        self.assertNotIn("flowchart: {htmlLabels: false", js)
        self.assertIn("DOMPurify.sanitize(result.svg", js)
        self.assertIn("pre.isConnected", js)

    def test_malformed_diagrams_keep_source_visible(self):
        js = (ROOT / "static/app.js").read_text()
        self.assertIn("This Mermaid diagram could not be rendered; showing its source.", js)
        self.assertIn("pre.after(note)", js)

    def test_diagram_layout_is_scoped_to_mermaid_output(self):
        css = (ROOT / "static/app.css").read_text()
        self.assertIn(".mermaid-diagram", css)
        self.assertIn(".mermaid-error", css)

    def test_mermaid_license_is_present(self):
        license_text = (ROOT / "licenses/mermaid-LICENSE").read_text()
        self.assertIn("MIT License", license_text)

    def test_local_images_get_a_new_cache_key_when_a_document_is_reloaded(self):
        js = (ROOT / "static/app.js").read_text()
        self.assertIn("imageGeneration: 0", js)
        self.assertIn("v: state.imageGeneration", js)
        self.assertIn("state.imageGeneration += 1", js)


if __name__ == "__main__":
    unittest.main()
