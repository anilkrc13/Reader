"""Run mistakes and formatting checks only on changed source files."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="HEAD", help="Git revision to compare")
    args = parser.parse_args()
    tracked = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "-z", args.base], cwd=ROOT
    )
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT
    )
    files = sorted({name.decode() for name in (tracked + untracked).split(b"\0") if name})
    files = [name for name in files if (ROOT / name).is_file() and
             not any(part in {"node_modules", "dist", "build"} for part in Path(name).parts)]
    javascript = [name for name in files if Path(name).suffix in {".js", ".mjs", ".cjs", ".ts"}
                  and not name.endswith(".min.js")]
    python = [name for name in files if name.endswith(".py")]
    swift = [name for name in files if name.endswith(".swift")]
    commands = []
    if javascript:
        commands.append([str(ROOT / "node_modules/.bin/eslint"), *javascript])
    if python:
        ruff = shutil.which("ruff") or str(ROOT / "build/lint-venv/bin/ruff")
        commands.append([ruff, "check", *python])
    if swift:
        commands.append(["swiftlint", "lint", "--strict", "--no-cache", "--config",
                         str(ROOT / ".swiftlint.yml"), *swift])
    failed = False
    for command in commands:
        print("Running:", " ".join(command), flush=True)
        try:
            failed = subprocess.run(command, cwd=ROOT, check=False).returncode != 0 or failed
        except FileNotFoundError as error:
            print(f"Missing linter: {error.filename}. See docs/testing.md.", file=sys.stderr)
            failed = True
    if not commands:
        print("No changed JavaScript, TypeScript, Python, or Swift sources.")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
