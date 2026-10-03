"""Generate production Reader and an ignored local development marketplace."""
import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

PLUGIN = "reader-markdown"
DEV_PLUGIN = "reader-markdown-dev"
DEV_MARKETPLACE = "reader-dev"
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


def safe_tree(root, expected, allow_missing=False):
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
    if found - expected or (not allow_missing and expected - found):
        raise ValueError(f"Release files differ: missing={sorted(expected - found)}, "
                         f"unexpected={sorted(found - expected)}")


def package_bytes(root, development=False):
    files = {name: (root / name).read_bytes() for name in sorted(FILES)}
    if development:
        manifest = read_json(root / "plugin.json")
        manifest["name"] = DEV_PLUGIN
        manifest["extensions"]["com.openai"]["interface"]["displayName"] = "Reader - Dev"
        files["plugin.json"] = json_bytes(manifest)
        mcp = read_json(root / "mcp.json")
        server = mcp["mcpServers"].pop(PLUGIN)
        mcp["mcpServers"][DEV_PLUGIN] = server
        files["mcp.json"] = json_bytes(mcp)
    return files


def file_hashes(root, development=False):
    return {name: hashlib.sha256(data).hexdigest()
            for name, data in package_bytes(root, development).items()}


def validate_identity(root, version):
    manifest = read_json(root / "plugin.json")
    interface = manifest.get("extensions", {}).get("com.openai", {}).get("interface", {})
    if (manifest.get("name") != PLUGIN or manifest.get("version") != version
            or interface.get("displayName") != "Reader"):
        raise ValueError("Production plugin must have Reader identity and release version")
    if set(read_json(root / "mcp.json").get("mcpServers", {})) != {PLUGIN}:
        raise ValueError("Production MCP server must have Reader identity")


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
    validate_identity(plugin_dir, version)
    # Never remove an existing path or follow a destination link.
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("Stage directory must not already exist")
    archive = archive_dir / f"Reader-plugin-{version}.zip"
    if archive.exists() or archive.is_symlink():
        raise ValueError("Plugin archive must not already exist")
    for destination in (output_dir, archive_dir):
        if any(parent.is_symlink() for parent in (destination, *destination.parents)):
            raise ValueError("Release destinations must not contain symlinks")
    plugin_path = f"plugins/{PLUGIN}"
    shutil.copytree(plugin_dir, output_dir / plugin_path)
    metadata = {"version": version, "tag": tag, "source_commit": source_commit,
                "repository_url": repository_url, "files": file_hashes(plugin_dir)}
    write_json(output_dir / "release.json", metadata)
    write_json(output_dir / ".agents/plugins/marketplace.json", marketplace(plugin_path))
    validate_stage(output_dir)
    archive_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(FILES):
            bundle.write(plugin_dir / name, f"{PLUGIN}/{name}")
    return archive


def marketplace(plugin_path, development=False):
    return {"name": DEV_MARKETPLACE if development else "reader-github",
            "interface": {"displayName": "Reader - Dev" if development else "Reader"},
            "plugins": [{"name": DEV_PLUGIN if development else PLUGIN,
                         "source": {"source": "local", "path": f"./{plugin_path}"},
                         "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                         "category": "Productivity"}]}


def validate_stage(root):
    metadata = read_json(root / "release.json")
    validate_provenance(metadata["source_commit"], metadata["repository_url"])
    version = metadata["version"]
    version_parts(version)
    plugin_path = f"plugins/{PLUGIN}"
    expected = {f"{plugin_path}/{name}" for name in FILES}
    expected.update({"release.json", ".agents/plugins/marketplace.json"})
    safe_tree(root, expected)
    plugin = root / plugin_path
    validate_identity(plugin, version)
    if (metadata["files"] != file_hashes(plugin)
            or metadata["tag"] not in (None, f"v{version}")):
        raise ValueError("Staged plugin does not match release metadata")
    catalog = read_json(root / ".agents/plugins/marketplace.json")
    if catalog != marketplace(plugin_path):
        raise ValueError("Marketplace must point at the staged plugin")
    return metadata


def safe_destination(path):
    if any(parent.is_symlink() for parent in (path, *path.parents)):
        raise ValueError(f"Distribution destination contains a symlink: {path}")


def validate_input(plugin_dir, version_file, repository_url):
    version = version_file.read_text(encoding="utf-8").strip()
    version_parts(version)
    validate_provenance("0" * 40, repository_url)
    safe_tree(plugin_dir, FILES)
    validate_identity(plugin_dir, version)
    return {"version": version, "repository_url": repository_url,
            "files": file_hashes(plugin_dir)}


def distribution_paths(repository_root):
    paths = (repository_root / "plugins" / PLUGIN,
             repository_root / "plugins/release.json",
             repository_root / ".agents/plugins/marketplace.json")
    for path in paths:
        safe_destination(path)
    return paths


def write_if_changed(path, data):
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def json_bytes(value):
    return (json.dumps(value, indent=2) + "\n").encode("utf-8")


def sync(plugin_dir, version_file, repository_root, repository_url):
    """Update the tracked production package from a validated source build."""
    return sync_package(plugin_dir, version_file, repository_root, repository_url)


def dev(plugin_dir, version_file, repository_root, repository_url):
    """Generate a complete local marketplace from the current build, without installs."""
    output = repository_root / "build/reader-dev"
    safe_destination(output)
    if (output.resolve().is_relative_to(plugin_dir.resolve())
            or plugin_dir.resolve().is_relative_to(output.resolve())):
        raise ValueError("Development output must not overlap the source package")
    expected = {f"plugins/{PLUGIN}/{name}" for name in FILES}
    expected.update({"plugins/release.json", ".agents/plugins/marketplace.json"})
    if output.exists():
        safe_tree(output, expected, allow_missing=True)
    return sync_package(plugin_dir, version_file, output, repository_url, development=True)


def sync_package(plugin_dir, version_file, repository_root, repository_url, development=False):
    """Write only owned distribution files; keep other repository state intact."""
    metadata = validate_input(plugin_dir, version_file, repository_url)
    metadata["files"] = file_hashes(plugin_dir, development)
    plugin, record, catalog = distribution_paths(repository_root)
    if plugin.exists():
        safe_tree(plugin, FILES, allow_missing=True)
    for path in (record, catalog):
        if path.exists() and not path.is_file():
            raise ValueError(f"Expected an ordinary file: {path}")
    if catalog.exists():
        previous = read_json(catalog)
        empty_local = previous in (
            {"name": "reader-local", "plugins": []},
            {"name": "reader-local", "interface": {"displayName": "Reader Local"},
             "plugins": []},
        )
        # Accept only the owned legacy structure; a user's label edit is harmless.
        normalized = dict(previous)
        interface = previous.get("interface")
        label_only = (isinstance(interface, dict) and set(interface) == {"displayName"}
                      and isinstance(interface["displayName"], str))
        normalized["interface"] = {"displayName": "Reader"}
        owned_public = label_only and normalized == marketplace(f"plugins/{PLUGIN}")
        legacy_dev = marketplace(f"plugins/{PLUGIN}", development=True)
        legacy_dev["interface"]["displayName"] = "Reader-Dev"
        owned_dev = previous in (marketplace(f"plugins/{PLUGIN}", development=True), legacy_dev)
        if not (empty_local or owned_public or owned_dev):
            raise ValueError("Existing marketplace is not owned by the Reader generator")
    for name, data in package_bytes(plugin_dir, development).items():
        write_if_changed(plugin / name, data)
    write_if_changed(record, json_bytes(metadata))
    write_if_changed(catalog, json_bytes(marketplace(f"plugins/{PLUGIN}", development)))
    return repository_root


def check(plugin_dir, version_file, repository_root, repository_url):
    """Verify the tracked production package without changing any file."""
    metadata = validate_input(plugin_dir, version_file, repository_url)
    plugin, record, catalog = distribution_paths(repository_root)
    safe_tree(plugin, FILES)
    if record.read_bytes() != json_bytes(metadata):
        raise ValueError("Public release metadata differs from the built plugin")
    if catalog.read_bytes() != json_bytes(marketplace(f"plugins/{PLUGIN}")):
        raise ValueError("Public marketplace differs from the generated catalog")
    for name, data in package_bytes(plugin_dir).items():
        if (plugin / name).read_bytes() != data:
            raise ValueError(f"Public plugin differs from built file: {name}")
    return repository_root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    staging = commands.add_parser("stage")
    for option in ("plugin-dir", "version-file", "source-commit", "repository-url",
                   "output-dir", "archive-dir"):
        staging.add_argument(f"--{option}", required=True)
    staging.add_argument("--tag")
    for command in ("sync", "check", "dev"):
        command_parser = commands.add_parser(command)
        for option in ("plugin-dir", "version-file", "repository-root", "repository-url"):
            command_parser.add_argument(f"--{option}", required=True)
    arguments = vars(parser.parse_args())
    command = arguments.pop("command")
    for name in ("plugin_dir", "version_file", "output_dir", "archive_dir", "repository_root"):
        if name in arguments:
            arguments[name] = Path(arguments[name]).absolute()
    try:
        result = {"stage": stage, "sync": sync, "check": check, "dev": dev}[command](**arguments)
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Plugin distribution failed: {error}\n")
    print(result)


if __name__ == "__main__":
    main()
