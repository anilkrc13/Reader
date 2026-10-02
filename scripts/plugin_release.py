"""Stage clean Reader plugin releases and publish an additive Git marketplace."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

PLUGIN = "reader-markdown"
FILES = {
    "plugin.json", "mcp.json", "server.mjs", "session.mjs", "viewer.html",
    "LICENSE", "assets/reader.png", "licenses/npm-notices.txt",
    "licenses/mermaid-LICENSE", "licenses/marked-LICENSE.md",
    "licenses/dompurify-LICENSE", "licenses/highlightjs-LICENSE",
    "licenses/lora-LICENSE",
}


def version_parts(value):
    """Reader releases use three numeric version components."""
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError(f"Invalid release version: {value}")
    return tuple(map(int, value.split(".")))


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def safe_tree(root, expected):
    """Reject unexpected files and links before copying any source bytes."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Expected an ordinary directory: {root}")
    found = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not release files: {path}")
        relative = path.relative_to(root).as_posix()
        if path.is_dir():
            if not any(name.startswith(relative + "/") for name in expected):
                raise ValueError(f"Unexpected release directory: {relative}")
        elif path.is_file():
            found.add(relative)
        else:
            raise ValueError(f"Not an ordinary release file: {path}")
    if found != expected:
        raise ValueError(f"Release files differ: missing={sorted(expected - found)}, "
                         f"unexpected={sorted(found - expected)}")


def file_hashes(root):
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in sorted(FILES)}


def validate_provenance(source_commit, repository_url):
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("Source commit must be a full Git commit SHA")
    if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository_url):
        raise ValueError("Repository URL must be a GitHub repository HTTPS URL")


def stage(plugin_dir, version_file, tag, source_commit, repository_url,
          output_dir, archive_dir):
    version = version_file.read_text(encoding="utf-8").strip()
    version_parts(version)
    if tag is not None and tag != f"v{version}":
        raise ValueError("Release tag must match VERSION")
    validate_provenance(source_commit, repository_url)
    safe_tree(plugin_dir, FILES)
    manifest = read_json(plugin_dir / "plugin.json")
    if manifest.get("name") != PLUGIN or manifest.get("version") != version:
        raise ValueError("Plugin manifest name/version must match Reader release")
    # Never remove an existing path or follow a destination link.
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("Stage directory must not already exist")
    archive = archive_dir / f"Reader-plugin-{version}.zip"
    if archive.exists() or archive.is_symlink():
        raise ValueError("Plugin archive must not already exist")
    for destination in (output_dir, archive_dir):
        if any(parent.is_symlink() for parent in (destination, *destination.parents)):
            raise ValueError("Release destinations must not contain symlinks")
    plugin_path = f"versions/{version}/plugins/{PLUGIN}"
    shutil.copytree(plugin_dir, output_dir / plugin_path)
    metadata = {"version": version, "tag": tag, "source_commit": source_commit,
                "repository_url": repository_url, "files": file_hashes(plugin_dir)}
    write_json(output_dir / "release.json", metadata)
    write_json(output_dir / ".agents/plugins/marketplace.json", marketplace(plugin_path))
    archive_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(FILES):
            bundle.write(plugin_dir / name, f"{PLUGIN}/{name}")
    return archive


def marketplace(plugin_path):
    return {"name": "reader-github", "interface": {"displayName": "Reader GitHub"},
            "plugins": [{"name": PLUGIN,
                         "source": {"source": "local", "path": f"./{plugin_path}"},
                         "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                         "category": "Productivity"}]}


def validate_stage(root):
    metadata = read_json(root / "release.json")
    validate_provenance(metadata["source_commit"], metadata["repository_url"])
    version = metadata["version"]
    version_parts(version)
    plugin_path = f"versions/{version}/plugins/{PLUGIN}"
    expected = {f"{plugin_path}/{name}" for name in FILES}
    expected.update({"release.json", ".agents/plugins/marketplace.json"})
    safe_tree(root, expected)
    plugin = root / plugin_path
    manifest = read_json(plugin / "plugin.json")
    if (manifest.get("version") != version or manifest.get("name") != PLUGIN
            or metadata["files"] != file_hashes(plugin)
            or metadata["tag"] not in (None, f"v{version}")):
        raise ValueError("Staged plugin does not match release metadata")
    catalog = read_json(root / ".agents/plugins/marketplace.json")
    if catalog != marketplace(plugin_path):
        raise ValueError("Marketplace must point at the staged plugin")
    return metadata


def git(checkout, *args):
    return subprocess.run(["git", "-C", str(checkout), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def publish(stage_dir, checkout, remote, branch="plugin-marketplace"):
    """Push an ordinary commit; never rewrite branch history or retry races."""
    metadata = validate_stage(stage_dir)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", branch):
        raise ValueError("Invalid distribution branch name")
    if checkout.exists() or checkout.is_symlink():
        raise ValueError("Publication checkout must not already exist")
    if any(parent.is_symlink() for parent in checkout.parents):
        raise ValueError("Publication checkout must not contain symlinks")
    checkout.mkdir(parents=True)
    git(checkout, "init", "--quiet")
    git(checkout, "remote", "add", "origin", remote)
    exists = git(checkout, "ls-remote", "--heads", "origin", f"refs/heads/{branch}")
    if exists:
        git(checkout, "fetch", "--quiet", "origin", f"refs/heads/{branch}")
        git(checkout, "checkout", "--quiet", "-b", branch, "FETCH_HEAD")
        old = read_json(checkout / "release.json")
        if old["repository_url"] != metadata["repository_url"]:
            raise ValueError("Distribution repository provenance changed")
        if version_parts(old["version"]) > version_parts(metadata["version"]):
            raise ValueError("Cannot replace a newer plugin release")
    else:
        git(checkout, "checkout", "--quiet", "--orphan", branch)
    version_dir = Path("versions") / metadata["version"]
    existing = checkout / version_dir
    if any(parent.is_symlink() for parent in (existing, *existing.parents)):
        raise ValueError("Published version path contains a symlink")
    if existing.exists():
        safe_tree(existing, {f"plugins/{PLUGIN}/{name}" for name in FILES})
        if file_hashes(existing / "plugins" / PLUGIN) != metadata["files"]:
            raise ValueError("Published version files are immutable")
        if read_json(checkout / "release.json") != metadata:
            raise ValueError("Published version provenance is immutable")
    else:
        shutil.copytree(stage_dir / version_dir, existing)
    for name in ("release.json", ".agents/plugins/marketplace.json"):
        destination = checkout / name
        if any(parent.is_symlink() for parent in (destination, *destination.parents)):
            raise ValueError("Distribution destination contains a symlink")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(stage_dir / name, destination)
    git(checkout, "add", "--", "versions", "release.json", ".agents/plugins/marketplace.json")
    if not git(checkout, "diff", "--cached", "--name-only"):
        return False
    git(checkout, "-c", "user.name=Reader releases", "-c",
        "user.email=reader-releases@users.noreply.github.com", "commit", "--quiet",
        "-m", f"Publish Reader plugin {metadata['version']}")
    git(checkout, "push", "origin", f"HEAD:refs/heads/{branch}")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    staging = commands.add_parser("stage")
    for option in ("plugin-dir", "version-file", "source-commit", "repository-url",
                   "output-dir", "archive-dir"):
        staging.add_argument(f"--{option}", required=True)
    staging.add_argument("--tag")
    publishing = commands.add_parser("publish")
    for option in ("stage-dir", "checkout", "remote"):
        publishing.add_argument(f"--{option}", required=True)
    publishing.add_argument("--branch", default="plugin-marketplace")
    arguments = vars(parser.parse_args())
    command = arguments.pop("command")
    for name in ("plugin_dir", "version_file", "output_dir", "archive_dir", "stage_dir", "checkout"):
        if name in arguments:
            arguments[name] = Path(arguments[name]).absolute()
    try:
        result = stage(**arguments) if command == "stage" else publish(**arguments)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        parser.exit(1, f"Plugin release failed: {detail}\n")
    print(result)


if __name__ == "__main__":
    main()
