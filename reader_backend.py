"""Reader's file-access policy and document storage.

The HTTP server owns transport and response formatting. This module owns the
filesystem decisions that must remain true regardless of which route calls a
mutation.
"""

from __future__ import annotations

import collections
import os
import stat as statmod
import shutil
import tempfile
import time
from pathlib import Path


MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdown", ".mkd", ".mdx", ".mdc"}
CODE_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".sh", ".bash", ".zsh", ".sql", ".css", ".scss", ".less",
    ".html", ".htm", ".xml", ".go", ".rs", ".java", ".rb", ".php",
    ".swift", ".kt", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".lua",
    ".txt", ".csv", ".tsv",
}
TEXT_SUFFIXES = MARKDOWN_SUFFIXES | CODE_SUFFIXES
PDF_SUFFIXES = {".pdf"}
LISTABLE_SUFFIXES = TEXT_SUFFIXES | PDF_SUFFIXES
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp", ".ico"}
# Types Reader does not render itself but will hand to the app that owns them.
# This stays a whitelist on purpose: `open` on an arbitrary path would just as
# happily launch a .app, .command or .sh, so "anything Reader cannot display"
# is not a safe rule. Images are here because a link to one has to lead
# somewhere, and Preview is where it belongs.
EXTERNAL_APP_SUFFIXES = {
    ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt", ".pptx",
    ".pages", ".numbers", ".key", ".rtf", ".odt", ".ods",
} | IMAGE_SUFFIXES

MAX_TEXT_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_PDF_BYTES = 128 * 1024 * 1024
MAX_ENTRIES = 4000

PROBE_DEPTH = 6
PROBE_NODES = 4000
PROBE_SECONDS = 1.5

PROBE_SKIP = {
    "node_modules", "__pycache__", "venv", ".venv", "site-packages",
    "Photos Library.photoslibrary", "Music Library.musiclibrary",
}

# macOS protects these top-level folders separately. Do not inspect them as a
# side effect of drawing Home; a direct navigation to Desktop, Documents, or
# Downloads is an explicit user choice. Music is not a Reader data source and
# is never accessed.
HOME_AUTOSCAN_SKIP = {"Desktop", "Documents", "Downloads", "Music"}

# A name search may reach further than the "does this folder hold anything"
# probe, because the reader is waiting on the answer to a question they asked
# rather than to a tree being drawn. It is still bounded on all three axes.
SEARCH_DEPTH = 8
SEARCH_NODES = 120000
SEARCH_SECONDS = 3.0
SEARCH_RESULTS = 200

# Folder names a document search must not spend its budget on: build output,
# dependency and tool caches, version-control internals, and the parts of
# ~/Library that hold application state rather than documents. A Home-wide
# search used to exhaust its whole allowance on these and report three matches
# where there were thirty-four.
#
# Cloud folders are deliberately absent from this list. Google Drive, OneDrive
# and iCloud Drive all live under ~/Library, and they hold the reader's own
# documents -- skipping Library wholesale would lose them.
SEARCH_SKIP = PROBE_SKIP | {
    ".git", ".svn", ".hg", ".Trash",
    "Caches", "CachedData", "Containers", "Group Containers",
    "Developer", "DerivedData", "Application Support",
    "dist", "build", "target", "vendor", "Pods",
    ".cache", ".next", ".nuxt", ".parcel-cache", ".turbo", ".svelte-kit",
    ".gradle", ".m2", ".cargo", ".rustup", ".npm", ".yarn", ".pnpm-store",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".terraform",
}

# Music is never a Reader source -- the access policy refuses the path outright,
# so the walk must not waste a descent discovering that. Desktop, Documents and
# Downloads are deliberately NOT here: a search the reader typed is an explicit
# request to look inside them, which is exactly the distinction
# HOME_AUTOSCAN_SKIP draws for a tree being drawn on its own initiative.
SEARCH_NEVER_IN_HOME = {"Music"}


def _is_package_cache(parent: str, name: str) -> bool:
    """The Go module cache is a very large tree under an unremarkable name.
    Matching on the pair avoids blacklisting every folder called "mod"."""
    return name == "mod" and os.path.basename(parent) == "pkg"


class WorkspaceError(PermissionError):
    """A path Reader's own policy refuses, as distinct from one the operating
    system refuses. The two used to arrive at the UI as the same three words --
    "permission denied" -- which told a reader nothing about which it was, or
    that the folder was the problem at all. Subclasses PermissionError so every
    existing caller keeps working; handlers that want the distinction catch this
    first. The messages are author-written and disclose nothing.
    """


class FileAccessPolicy:
    """Resolve paths and enforce the boundaries for filesystem mutations."""

    def __init__(self, app_dir: Path, allowed_roots: list[Path] | tuple[Path, ...],
                 home: Path | None = None):
        self.app_dir = Path(app_dir).expanduser().resolve()
        self.home = Path(home or Path.home()).expanduser().resolve()
        self.allowed_roots = tuple(Path(root).expanduser().resolve() for root in allowed_roots)

    @staticmethod
    def _inside(path: Path, root: Path) -> bool:
        return path == root or root in path.parents

    @staticmethod
    def _ancestor(path: Path, child: Path) -> bool:
        return path == child or path in child.parents

    def resolve(self, raw: str | os.PathLike[str]) -> Path:
        if not isinstance(raw, (str, os.PathLike)) or not raw:
            raise ValueError("invalid path")
        if isinstance(raw, os.PathLike):
            raw = os.fspath(raw)
        if not raw:
            raise ValueError("missing path")
        p = Path(raw).expanduser()
        if not p.is_absolute():
            p = self.home / p
        resolved = p.resolve()
        music = self.home / "Music"
        if self._inside(resolved, music):
            raise WorkspaceError("Reader does not access the Music folder")
        return resolved

    def is_protected_project_path(self, path: Path) -> bool:
        return self._inside(path, self.app_dir)

    def assert_mutation_allowed(self, path: Path) -> None:
        """Preserve the existing destructive-operation guards and close the
        gap that allowed files inside the Reader project to be changed."""
        if self.is_protected_project_path(path):
            raise WorkspaceError("that Reader project file is protected")
        rootdir = Path(path.anchor or "/")
        if path == self.home or self._ancestor(path, self.home):
            raise ValueError("your home folder is protected")
        if path == rootdir:
            raise ValueError("the root of the disk is protected")
        if self._ancestor(path, self.app_dir):
            raise ValueError("that folder contains Reader itself, so it is protected")

    def assert_save_allowed(self, path: Path) -> Path:
        """Return a canonical save target or raise before any file is opened."""
        path = path.resolve()
        if self.is_protected_project_path(path):
            raise WorkspaceError("that Reader project file is protected")
        if not any(self._inside(path, root) for root in self.allowed_roots):
            raise WorkspaceError("that path is outside Reader's allowed folders")
        if path.suffix.lower() not in TEXT_SUFFIXES:
            raise ValueError("not a supported text document")
        if path.exists() and not path.is_file():
            raise ValueError("target is not a regular file")
        return path


class DocumentStore:
    """Read and mutate documents after the access policy has been applied."""

    def __init__(self, policy: FileAccessPolicy):
        self.policy = policy

    def list_dir(self, path: Path, include_all: bool = False,
                 include_files: bool = False, include_hidden: bool = False) -> dict:
        if not path.is_dir():
            raise NotADirectoryError(str(path))
        dirs, files, truncated = [], [], False
        deadline = time.monotonic() + PROBE_SECONDS
        with os.scandir(path) as it:
            for entry in it:
                if len(dirs) + len(files) >= MAX_ENTRIES:
                    truncated = True
                    break
                if entry.name.startswith(".") and not include_hidden:
                    continue
                if path == self.policy.home and entry.name in HOME_AUTOSCAN_SKIP:
                    continue
                child = path / entry.name
                try:
                    if entry.is_dir():
                        if include_all or self._has_documents(str(child), deadline, include_hidden):
                            dirs.append({"name": entry.name, "path": str(child), "type": "dir"})
                    elif entry.is_file():
                        supported = child.suffix.lower() in LISTABLE_SUFFIXES
                        if not supported and not include_files:
                            continue
                        st = entry.stat()
                        item = {"name": entry.name, "path": str(child), "type": "file",
                                "size": st.st_size, "mtime": str(st.st_mtime_ns)}
                        if not supported:
                            item["supported"] = False
                        files.append(item)
                except OSError:
                    continue

        dirs.sort(key=lambda x: x["name"].lower())
        files.sort(key=lambda x: x["name"].lower())
        return {
            "path": str(path),
            "name": path.name or str(path),
            "parent": None if path.parent == path else str(path.parent),
            "entries": dirs + files,
            "truncated": truncated,
        }

    @staticmethod
    def _has_documents(start: str, deadline: float, include_hidden: bool = False) -> bool:
        stack, budget = [(start, 0)], PROBE_NODES
        while stack:
            folder, depth = stack.pop()
            if budget <= 0 or time.monotonic() > deadline:
                return True
            try:
                with os.scandir(folder) as it:
                    for entry in it:
                        budget -= 1
                        if budget <= 0:
                            return True
                        name = entry.name
                        if name.startswith(".") and not include_hidden:
                            continue
                        try:
                            if entry.is_file(follow_symlinks=False):
                                if os.path.splitext(name)[1].lower() in LISTABLE_SUFFIXES:
                                    return True
                            elif (entry.is_dir(follow_symlinks=False)
                                  and depth < PROBE_DEPTH and name not in PROBE_SKIP):
                                stack.append((os.path.join(folder, name), depth + 1))
                        except OSError:
                            continue
            except OSError:
                continue
        return False

    def find_files(self, root: Path, query: str, include_hidden: bool = False,
                   include_files: bool = False) -> dict:
        """Documents anywhere under `root` whose filename contains `query`.

        Bounded on depth, entries examined and elapsed time, for the same reason
        the tree's own walk is: a search must never become the thing that makes
        the panel stop answering. The walk is breadth-first so that when a bound
        is hit, what survives is the matches nearest the folder being browsed
        rather than whichever branch happened to be descended first.

        Unlike the tree's own walk, this one does enter Desktop, Documents and
        Downloads: a typed query is an explicit request to look there. macOS may
        raise its folder-consent prompt the first time, which is the correct
        moment for it -- the reader asked.
        """
        if not root.is_dir():
            raise NotADirectoryError(str(root))
        needle = query.strip().lower()
        if not needle:
            return {"path": str(root), "query": "", "matches": [], "truncated": False}

        matches: list[dict] = []
        truncated = False
        deadline = time.monotonic() + SEARCH_SECONDS
        budget = SEARCH_NODES
        queue = collections.deque([(str(root), 0)])

        while queue and not truncated:
            folder, depth = queue.popleft()
            if time.monotonic() > deadline or budget <= 0:
                truncated = True
                break
            try:
                scan = os.scandir(folder)
            except OSError:
                continue
            with scan as it:
                for entry in it:
                    budget -= 1
                    if budget <= 0:
                        truncated = True
                        break
                    name = entry.name
                    if name.startswith(".") and not include_hidden:
                        continue
                    if folder == str(self.policy.home) and name in SEARCH_NEVER_IN_HOME:
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if (depth < SEARCH_DEPTH and name not in SEARCH_SKIP
                                    and not _is_package_cache(folder, name)):
                                queue.append((entry.path, depth + 1))
                            continue
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        supported = os.path.splitext(name)[1].lower() in LISTABLE_SUFFIXES
                        if not supported and not include_files:
                            continue
                        if needle not in name.lower():
                            continue
                        item = {"name": name, "path": entry.path,
                                "dir": folder, "type": "file"}
                        if not supported:
                            item["supported"] = False
                        matches.append(item)
                        if len(matches) >= SEARCH_RESULTS:
                            truncated = True
                            break
                    except OSError:
                        continue

        # A name that begins with what was typed is the likelier target, then the
        # shallower path, then alphabetical so the order never wobbles.
        matches.sort(key=lambda m: (0 if m["name"].lower().startswith(needle) else 1,
                                    m["path"].count(os.sep), m["name"].lower()))
        return {"path": str(root), "query": query.strip(),
                "matches": matches, "truncated": truncated}

    def read_text_file(self, path: Path) -> dict:
        if not path.is_file():
            raise FileNotFoundError(str(path))
        if path.suffix.lower() not in TEXT_SUFFIXES:
            raise ValueError("not a text document")
        st = path.stat()
        if st.st_size > MAX_TEXT_BYTES:
            raise ValueError(f"file is too large to open ({st.st_size // 1024 // 1024} MB)")
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("file is not valid UTF-8 text")
        return {
            "path": str(path), "name": path.name, "dir": str(path.parent),
            "text": text, "mtime": str(st.st_mtime_ns), "size": st.st_size,
        }

    @staticmethod
    def stat_file(path: Path) -> dict:
        if path.is_dir():
            try:
                items = sum(1 for _ in os.scandir(path))
            except OSError:
                items = -1
            return {"path": str(path), "isDir": True, "items": items}
        if not path.is_file():
            raise FileNotFoundError(str(path))
        st = path.stat()
        return {"path": str(path), "isDir": False,
                "mtime": str(st.st_mtime_ns), "size": st.st_size}

    def write_text_file(self, path: Path, text: str,
                        expected_mtime: str | None) -> dict:
        path = self.policy.assert_save_allowed(path)
        if not isinstance(text, str):
            raise ValueError("missing text")
        if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
            raise ValueError("text is too large to save")
        if path.exists() and expected_mtime is not None:
            if str(path.stat().st_mtime_ns) != expected_mtime:
                raise FileExistsError("the file changed on disk since it was opened")
        mode = path.stat().st_mode & 0o777 if path.exists() else None
        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
                fh.flush()
                os.fsync(fh.fileno())
            if mode is not None:
                os.chmod(tmp, mode)
            os.replace(tmp, path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        st = path.stat()
        return {"path": str(path), "mtime": str(st.st_mtime_ns), "size": st.st_size}

    def can_create_in(self, folder: Path) -> dict:
        """Whether a new document could be made in `folder`, and if not, why.

        The dialog asks this the moment a folder is chosen, so a destination the
        policy will refuse is reported while it can still be changed, rather
        than after a name has been typed. Path.is_dir() is avoided deliberately:
        it swallows OSError and returns False, which turns "Reader has no
        permission for that folder" into "no such folder".
        """
        try:
            info = os.stat(folder)
        except PermissionError:
            return {"ok": False, "reason": "Reader does not have permission to open that folder"}
        except FileNotFoundError:
            return {"ok": False, "reason": "that folder is not there any more"}
        except OSError:
            return {"ok": False, "reason": "Reader cannot reach that folder"}
        if not statmod.S_ISDIR(info.st_mode):
            return {"ok": False, "reason": "that is not a folder"}

        try:
            # A name that exercises the policy without being written anywhere.
            self.policy.assert_save_allowed(folder / "untitled.md")
        except WorkspaceError as exc:
            return {"ok": False, "reason": str(exc)}
        except (PermissionError, ValueError) as exc:
            return {"ok": False, "reason": str(exc) or "that folder cannot be used"}

        if not os.access(folder, os.W_OK | os.X_OK):
            return {"ok": False, "reason": "that folder is read-only"}
        return {"ok": True, "path": str(folder)}

    def create_document(self, folder: Path, name: str) -> dict:
        """Make a new, empty markdown document in `folder`.

        Separate from write_text_file rather than a save to a path that happens
        not to exist yet: creating must never land on top of something already
        there, and a save whose whole purpose is to overwrite cannot carry that
        rule. The name is validated the same way a rename is, so the two cannot
        disagree about what a usable filename is.
        """
        verdict = self.can_create_in(folder)
        if not verdict["ok"]:
            raise WorkspaceError(verdict["reason"])

        name = (name or "").strip()
        if not name or name in (".", "..") or "/" in name or "\x00" in name:
            raise ValueError("that name cannot be used")
        if name.startswith("."):
            raise ValueError("names starting with a dot would be hidden")
        # An extension is optional; markdown is what this makes.
        if "." not in name:
            name += ".md"
        if len(name.encode("utf-8")) > 255:
            raise ValueError("that name is too long")
        if os.path.splitext(name)[1].lower() not in MARKDOWN_SUFFIXES:
            raise ValueError("new documents are markdown")

        target = (folder / name).resolve()
        # Back through the policy: a name cannot be used to climb out of the
        # folder, and the result has to be somewhere writing is allowed at all.
        if target.parent != folder.resolve():
            raise ValueError("that name cannot be used")
        self.policy.assert_save_allowed(target)
        if target.exists():
            raise FileExistsError(f"something named {name} is already there")

        target.touch(mode=0o644)
        st = target.stat()
        return {"path": str(target), "name": name, "dir": str(folder),
                "mtime": str(st.st_mtime_ns), "size": st.st_size}

    def rename_path(self, path: Path, new_name: str) -> dict:
        if not path.exists():
            raise FileNotFoundError(str(path))
        self.policy.assert_mutation_allowed(path)

        new_name = (new_name or "").strip()
        if not new_name or new_name in (".", "..") or "/" in new_name or "\x00" in new_name:
            raise ValueError("that name cannot be used")
        if new_name.startswith("."):
            raise ValueError("names starting with a dot would be hidden")
        if len(new_name.encode("utf-8")) > 255:
            raise ValueError("that name is too long")

        if path.is_file():
            old_suffix = path.suffix.lower()
            if "." not in new_name:
                new_name += path.suffix
            else:
                new_suffix = os.path.splitext(new_name)[1].lower()
                if old_suffix in LISTABLE_SUFFIXES and new_suffix not in LISTABLE_SUFFIXES:
                    raise ValueError("that extension would hide the file from this app")
                if (old_suffix in PDF_SUFFIXES) != (new_suffix in PDF_SUFFIXES):
                    raise ValueError("renaming cannot change a file's type")

        target = path.with_name(new_name)
        if target == path:
            return {"path": str(path), "newPath": str(path), "name": path.name}
        if target.exists():
            raise FileExistsError(f"something named {new_name} is already there")
        self.policy.assert_mutation_allowed(target.resolve())
        path.rename(target)
        return {"path": str(path), "newPath": str(target), "name": new_name}

    def move_file(self, path: Path, target_dir: Path) -> dict:
        if not path.exists():
            raise FileNotFoundError(str(path))
        if path.is_dir():
            raise ValueError("folders cannot be moved from this app")
        if not path.is_file():
            raise ValueError("only regular files can be moved")
        if not target_dir.exists():
            raise FileNotFoundError(str(target_dir))
        if not target_dir.is_dir():
            raise ValueError("the destination is not a folder")

        self.policy.assert_mutation_allowed(path)
        self.policy.assert_mutation_allowed(target_dir)
        target = (target_dir / path.name).resolve()
        self.policy.assert_mutation_allowed(target)
        if target == path:
            return {"path": str(path), "newPath": str(path), "name": path.name}
        if target.exists():
            raise FileExistsError(f"something named {path.name} is already there")

        # A rename is a filesystem move on the local volumes Reader is meant
        # to browse. It never creates a second copy or replaces a destination.
        path.rename(target)
        st = target.stat()
        return {"path": str(path), "newPath": str(target), "name": target.name,
                "mtime": str(st.st_mtime_ns), "size": st.st_size}

    def move_to_trash(self, path: Path) -> dict:
        if not path.exists():
            raise FileNotFoundError(str(path))
        if path.is_dir():
            raise ValueError("folders cannot be deleted from this app")
        self.policy.assert_mutation_allowed(path)

        mac = self.policy.home / ".Trash"
        xdg = self.policy.home / ".local" / "share" / "Trash" / "files"
        bin_dir = mac if mac.is_dir() else xdg
        if not bin_dir.is_dir():
            try:
                bin_dir.mkdir(parents=True, exist_ok=True)
            except OSError:
                return self._trash_unavailable()
        if path == bin_dir or str(path).startswith(str(bin_dir) + "/"):
            raise ValueError("that item is already in the Trash")

        dest, n = bin_dir / path.name, 2
        while dest.exists():
            dest = bin_dir / f"{path.stem} {n}{path.suffix}"
            n += 1
        shutil.move(str(path), str(dest))
        return {"path": str(path), "trashed": str(dest), "name": path.name}

    @staticmethod
    def _trash_unavailable() -> dict:
        raise ValueError("no Trash folder is available, so nothing was deleted")
