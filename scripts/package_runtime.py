"""Select the shared Python/web runtime for browser and native app builds."""

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    "reader.py", "VERSION", "LICENSE", "src/__init__.py",
    "src/reader/__init__.py", "src/reader/server.py", "src/reader/backend.py",
)


def package_runtime(destination: Path):
    """Copy the shared runtime and notices into a build destination.

    Web and Mac builders call this to keep their packaged source selection identical.
    The caller creates or clears its owned output before calling.
    """
    destination = destination.resolve()
    if not destination.is_relative_to(ROOT / "build"):
        raise ValueError("Runtime output must be inside Reader's build directory")
    for name in RUNTIME_FILES:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    shutil.copytree(ROOT / "src/reader/web", destination / "src/reader/web",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
    shutil.copytree(ROOT / "src/reader/common/licenses", destination / "licenses")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    package_runtime(args.destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
