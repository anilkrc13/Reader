"""Build Reader's web, Mac, or ChatGPT variant through one project command."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from package_runtime import package_runtime
from plugin_release import dev

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?", default="all",
                        choices=("all", "web", "macos", "chatgpt", "dev"))
    args = parser.parse_args()
    targets = ("web", "macos", "chatgpt") if args.target == "all" else (args.target,)
    if "macos" in targets and sys.platform != "darwin":
        parser.error("The Mac target needs macOS and Xcode; choose web or chatgpt here")
    try:
        for target in targets:
            print(f"Building Reader {target}", flush=True)
            if target == "web":
                output = ROOT / "build/web"
                if output.exists():
                    shutil.rmtree(output)
                package_runtime(output)
            elif target == "macos":
                subprocess.run([str(ROOT / "src/reader/macos/scripts/build-app.sh")], cwd=ROOT, check=True)
            else:
                npm = "npm.cmd" if sys.platform == "win32" else "npm"
                subprocess.run([npm, "--prefix", "src/reader/chatgpt", "run", "build"],
                               cwd=ROOT, check=True)
                if target == "dev":
                    dev(ROOT / "build/chatgpt", ROOT / "VERSION", ROOT,
                        "https://github.com/anilkrc13/Reader")
                    print(ROOT / "build/reader-dev", flush=True)
    except subprocess.CalledProcessError as error:
        return error.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
