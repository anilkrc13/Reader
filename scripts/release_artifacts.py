"""Package the browser runtime and verify one version across finished releases."""
import argparse
import hashlib
import json
import plistlib
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

from .package_runtime import ROOT, RUNTIME_FILES
from .plugin_release import FILES as PLUGIN_FILES
from .plugin_release import PLUGIN, safe_tree, version_parts


def read_version(version_file):
    version = version_file.read_text(encoding="utf-8").strip()
    version_parts(version)
    return version


def web_files():
    """Only tracked application assets and notices belong in a web release."""
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "src/reader/web", "src/reader/common/licenses"], cwd=ROOT)
    names = set(RUNTIME_FILES)
    for name in tracked.decode().split("\0"):
        if name.startswith("src/reader/common/licenses/"):
            names.add("licenses/" + name.removeprefix("src/reader/common/licenses/"))
        elif name:
            names.add(name)
    return names


def archive_web(runtime, version_file, archive_dir):
    version = read_version(version_file)
    expected = web_files()
    safe_tree(runtime, expected)
    if (runtime / "VERSION").read_text().strip() != version:
        raise ValueError("Web runtime version must match VERSION")
    root = f"Reader-web-{version}"
    archive = archive_dir / f"{root}.zip"
    if archive.exists() or archive.is_symlink():
        raise ValueError("Web archive must not already exist")
    if any(path.is_symlink() for path in (archive_dir, *archive_dir.parents)):
        raise ValueError("Release destinations must not contain symlinks")
    instructions = (
        f"Reader {version} — browser runtime\n\n"
        "Requires Python 3.10 or newer on your computer; no pip or npm install is needed.\n"
        "Unzip this archive, open a terminal in this folder, then run:\n\n"
        "  python3 scripts/reader.py\n\n"
        "To start in a folder or open a file, add its path to that command.\n"
        "Reader runs a local server and opens your browser. Stop it with Ctrl-C.\n"
        "This is a local application, not a static website or hosted service.\n"
        "macOS is the supported desktop platform; Linux/Windows server tests run in CI.\n"
        "Licenses and third-party notices are included in LICENSE and licenses/.\n"
    )
    archive_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(expected):
            bundle.write(runtime / name, f"{root}/{name}")
        bundle.writestr(f"{root}/README.txt", instructions)
    return archive


def archive_files(path):
    """Read ordinary ZIP files without accepting traversal or duplicate entries."""
    files = {}
    with zipfile.ZipFile(path) as bundle:
        for entry in bundle.infolist():
            name = entry.filename
            parts = PurePosixPath(name).parts
            mode = entry.external_attr >> 16
            if (name.startswith("/") or "\\" in name or ".." in parts
                    or not parts or stat.S_ISLNK(mode) or name in files):
                raise ValueError(f"Unsafe release archive entry: {name}")
            if not entry.is_dir():
                files[name] = bundle.read(entry)
    return files


def check_archives(version_file, tag, archive_dir):
    version = read_version(version_file)
    if tag != f"v{version}":
        raise ValueError("Release tag must match VERSION")
    native_path = archive_dir / f"Reader-{version}.zip"
    native = archive_files(native_path)
    info = plistlib.loads(native["Reader.app/Contents/Info.plist"])
    if (info.get("CFBundleShortVersionString") != version
            or info.get("CFBundleVersion") != version
            or native["Reader.app/Contents/Resources/VERSION"].decode().strip() != version):
        raise ValueError("Native archive versions must match VERSION")
    manifest = json.loads((archive_dir / "manifest.json").read_text())
    if (manifest.get("version") != version
            or manifest.get("sha256") != hashlib.sha256(native_path.read_bytes()).hexdigest()
            or manifest.get("size") != native_path.stat().st_size
            or not manifest.get("url", "").endswith(f"/v{version}/{native_path.name}")):
        raise ValueError("Updater manifest must describe the verified native archive")
    web = archive_files(archive_dir / f"Reader-web-{version}.zip")
    prefix = f"Reader-web-{version}/"
    if (set(web) != {prefix + name for name in web_files() | {"README.txt"}}
            or web[prefix + "VERSION"].decode().strip() != version):
        raise ValueError("Web archive files and version must match VERSION")
    for name in web_files():
        source = ROOT / ("src/reader/common/" + name if name.startswith("licenses/") else name)
        if web[prefix + name] != source.read_bytes():
            raise ValueError(f"Web archive differs from the release source: {name}")
    plugin = archive_files(archive_dir / f"Reader-plugin-{version}.zip")
    prefix = f"{PLUGIN}/"
    if set(plugin) != {prefix + name for name in PLUGIN_FILES}:
        raise ValueError("Plugin archive must contain the production package")
    plugin_manifest = json.loads(plugin[prefix + "plugin.json"])
    interface = plugin_manifest.get("extensions", {}).get("com.openai", {}).get("interface", {})
    mcp = json.loads(plugin[prefix + "mcp.json"])
    if (plugin_manifest.get("version") != version or plugin_manifest.get("name") != PLUGIN
            or interface.get("displayName") != "Reader"
            or set(mcp.get("mcpServers", {})) != {PLUGIN}):
        raise ValueError("Plugin archive identity and version must match production Reader")
    for name, data in plugin.items():
        if data != (ROOT / "plugins" / name).read_bytes():
            raise ValueError(f"Plugin archive differs from the committed production package: {name}")
    receipt = {"version": version, "tag": tag, "assets": {}}
    for name in (native_path.name, f"Reader-web-{version}.zip", f"Reader-plugin-{version}.zip",
                 "manifest.json"):
        path = archive_dir / name
        receipt["assets"][name] = {
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size}
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    web = subcommands.add_parser("web", help="Archive the built browser runtime")
    web.add_argument("--runtime", type=Path, default=ROOT / "build/web")
    web.add_argument("--version-file", type=Path, default=ROOT / "VERSION")
    web.add_argument("--archive-dir", type=Path, default=ROOT / "build/releases")
    check = subcommands.add_parser("check", help="Check packaged products before publication")
    check.add_argument("--version-file", type=Path, default=ROOT / "VERSION")
    check.add_argument("--archive-dir", type=Path, default=ROOT / "build/releases")
    check.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        if args.command == "web":
            print(archive_web(args.runtime, args.version_file, args.archive_dir))
        else:
            print(json.dumps(check_archives(args.version_file, args.tag, args.archive_dir), indent=2))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Release validation failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
