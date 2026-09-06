"""Regression test for relative Markdown links in the repository's docs.

Reader is read inside itself as often as on GitHub, and both resolve a
relative link the same way: against the directory of the file that contains
it, not against the repository root. A file moved or renamed can silently
break a link in a document nowhere near it, and nothing short of walking
every link catches that before a reader clicks it and lands nowhere. This
walks every tracked *.md file, extracts every relative link, and asserts the
target exists on disk.
"""

import re
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Matches Markdown link syntax [text](target). Link text itself may contain
# a nested `code span`, so this only needs to find the (...) part; it is not
# trying to parse the text.
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def _tracked_markdown_files():
    output = subprocess.check_output(
        ["git", "ls-files", "*.md"], cwd=REPO_ROOT, text=True
    )
    return [REPO_ROOT / line for line in output.splitlines() if line]


def _is_skippable(target):
    # External links, mail links, and same-page fragments have no filesystem
    # target to check.
    return (
        target.startswith("http://")
        or target.startswith("https://")
        or target.startswith("mailto:")
        or target.startswith("#")
    )


class MarkdownLinkTests(unittest.TestCase):
    def test_every_relative_link_resolves_to_a_real_file(self):
        missing = []
        for md_file in _tracked_markdown_files():
            text = md_file.read_text(encoding="utf-8")
            for match in LINK_RE.finditer(text):
                target = match.group(1).strip()
                if _is_skippable(target):
                    continue
                # Strip a trailing #fragment before checking the file exists.
                target = target.split("#", 1)[0]
                if not target:
                    continue
                resolved = (md_file.parent / target).resolve()
                if not resolved.exists():
                    missing.append(
                        "{} links to {!r}, which resolves to {} and does not exist".format(
                            md_file.relative_to(REPO_ROOT), target, resolved
                        )
                    )
        self.assertEqual([], missing, "\n".join(missing))


if __name__ == "__main__":
    unittest.main()
