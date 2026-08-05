#!/usr/bin/env python3
"""
Reader -- a small local document browser: markdown, code, CSV and PDF.

Runs a loopback-only HTTP server and opens the UI in your default browser.
Standard library only: no pip installs, no network access at runtime.

    python3 mdview.py [PATH] [--port N] [--no-browser]

PATH may be a folder (opens the browser there) or a file (opens it).

Preferences are stored server side, in preferences.json beside this script,
so they survive restarts even when the app lands on a different port.
"""

from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import os
import secrets
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_NAME = "Reader"
VERSION = "2.0"
APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_PORT = 8737          # stable by default; falls back to a free port

# Files offered in the browser pane, by kind.
MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdown", ".mkd", ".mdx", ".mdc"}
CODE_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".sh", ".bash", ".zsh", ".sql", ".css", ".scss", ".less",
    ".html", ".htm", ".xml", ".go", ".rs", ".java", ".rb", ".php",
    ".swift", ".kt", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".lua",
    ".txt", ".csv", ".tsv",
}
TEXT_SUFFIXES = MARKDOWN_SUFFIXES | CODE_SUFFIXES     # readable + editable
PDF_SUFFIXES = {".pdf"}                               # read-only, native viewer
LISTABLE_SUFFIXES = TEXT_SUFFIXES | PDF_SUFFIXES
# Images a document may reference and that we will serve inline.
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp", ".ico"}

MAX_TEXT_BYTES = 8 * 1024 * 1024      # refuse to open text larger than this
MAX_IMAGE_BYTES = 32 * 1024 * 1024    # refuse to inline images larger than this
MAX_PDF_BYTES = 128 * 1024 * 1024     # refuse to open PDFs larger than this
MAX_PREFS_BYTES = 256 * 1024          # a preferences blob should never be big
MAX_ENTRIES = 4000                    # cap on a single directory listing

# Folders are only listed when they hold a document somewhere inside. These
# bound that search so a listing can never hang on a huge tree.
PROBE_DEPTH = 6
PROBE_NODES = 4000                    # entries examined per candidate folder
PROBE_SECONDS = 1.5                   # wall-clock ceiling for one listing
PROBE_SKIP = {"node_modules", "__pycache__", "venv", ".venv", "site-packages",
              "Photos Library.photoslibrary", "Music Library.musiclibrary"}

COOKIE = "reader_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")


# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------

def resolve_path(raw: str) -> Path:
    """Expand and fully resolve a user-supplied path (symlinks included)."""
    if not raw:
        raise ValueError("missing path")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path.home() / p
    return p.resolve()


def choose_prefs_file() -> Path:
    """Keep preferences with the app when possible, so the folder stays portable."""
    beside = APP_DIR / "preferences.json"
    if beside.exists() or os.access(APP_DIR, os.W_OK):
        return beside
    support = Path.home() / "Library" / "Application Support" / APP_NAME
    try:
        support.mkdir(parents=True, exist_ok=True)
        if os.access(support, os.W_OK):
            return support / "preferences.json"
    except OSError:
        pass
    return Path.home() / ".mdview-preferences.json"


PREFS_FILE = choose_prefs_file()
PREFS_LOCK = threading.Lock()


def load_or_make_token() -> str:
    """A stable secret, so the app has one unchanging URL you can bookmark or
    install as a browser app. Readable only by you."""
    path = PREFS_FILE.parent / ".mdview-token"
    try:
        existing = path.read_text("utf-8").strip()
        if len(existing) >= 24:
            return existing
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(token)
    except OSError:
        pass          # fall back to a per-run token rather than refusing to start
    return token


TOKEN = load_or_make_token()


def read_prefs() -> dict:
    try:
        with PREFS_LOCK:
            data = json.loads(PREFS_FILE.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_prefs(data: dict) -> None:
    blob = json.dumps(data, indent=1, sort_keys=True)
    with PREFS_LOCK:
        PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(PREFS_FILE.parent),
                                        prefix=".prefs.", suffix=".tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(blob)
            os.replace(tmp, PREFS_FILE)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise


def quick_roots() -> list[dict]:
    home = Path.home()
    out = []
    for label, path in (("Home", home), ("Desktop", home / "Desktop"),
                        ("Documents", home / "Documents"), ("Downloads", home / "Downloads")):
        try:
            if path.is_dir():
                out.append({"name": label, "path": str(path)})
        except OSError:
            pass
    return out


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------

def has_documents(start: str, deadline: float) -> bool:
    """Does this subtree hold anything worth opening?

    Deliberately fails open: if the walk is cut short by the node budget, the
    deadline, or a permission error, we say yes. Hiding a folder that really
    does contain a document would make it unreachable, which is far worse than
    showing one that turns out to be empty.
    """
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
                    if name.startswith("."):
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


def list_dir(path: Path, include_all: bool = False) -> dict:
    if not path.is_dir():
        raise NotADirectoryError(str(path))
    dirs, files, truncated = [], [], False
    deadline = time.monotonic() + PROBE_SECONDS
    with os.scandir(path) as it:
        for entry in it:
            if len(dirs) + len(files) >= MAX_ENTRIES:
                truncated = True
                break
            if entry.name.startswith("."):
                continue
            child = path / entry.name
            try:
                if entry.is_dir():
                    if include_all or has_documents(str(child), deadline):
                        dirs.append({"name": entry.name, "path": str(child), "type": "dir"})
                elif entry.is_file() and child.suffix.lower() in LISTABLE_SUFFIXES:
                    st = entry.stat()
                    files.append({"name": entry.name, "path": str(child), "type": "file",
                                  "size": st.st_size, "mtime": str(st.st_mtime_ns)})
            except OSError:
                continue
    key = lambda e: e["name"].lower()  # noqa: E731
    dirs.sort(key=key)
    files.sort(key=key)
    return {
        "path": str(path),
        "name": path.name or str(path),
        "parent": None if path.parent == path else str(path.parent),
        "entries": dirs + files,
        "truncated": truncated,
    }


def read_text_file(path: Path) -> dict:
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


def stat_file(path: Path) -> dict:
    """Cheap freshness probe for the watcher; also used to describe a folder
    before the delete confirmation is shown."""
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


def guard_protected(path: Path) -> None:
    """Refuse to touch the app, your home folder, or the root of the disk."""
    home, rootdir = Path.home(), Path(path.anchor or "/")
    inside = str(path).rstrip("/") + "/"
    if path == APP_DIR or str(APP_DIR).startswith(inside):
        raise ValueError("that holds Markdown Viewer itself, so it is protected")
    if path == home or str(home).startswith(inside):
        raise ValueError("your home folder is protected")
    if path == rootdir:
        raise ValueError("the root of the disk is protected")


def rename_path(path: Path, new_name: str) -> dict:
    if not path.exists():
        raise FileNotFoundError(str(path))
    guard_protected(path)

    new_name = (new_name or "").strip()
    if not new_name or new_name in (".", "..") or "/" in new_name or "\x00" in new_name:
        raise ValueError("that name cannot be used")
    if new_name.startswith("."):
        raise ValueError("names starting with a dot would be hidden")
    if len(new_name.encode("utf-8")) > 255:
        raise ValueError("that name is too long")

    # keep a document reachable: no extension typed means keep the old one,
    # an unlisted extension is refused, and text never turns into "pdf"
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
    path.rename(target)
    return {"path": str(path), "newPath": str(target), "name": new_name}


# --------------------------------------------------------------------------
# deletion — always to the Trash, never an unrecoverable unlink
# --------------------------------------------------------------------------

def trash_dir() -> Path | None:
    mac = Path.home() / ".Trash"
    if mac.is_dir():
        return mac
    xdg = Path.home() / ".local" / "share" / "Trash" / "files"
    try:
        xdg.mkdir(parents=True, exist_ok=True)
        return xdg
    except OSError:
        return None


def move_to_trash(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(str(path))
    if path.is_dir():
        raise ValueError("folders cannot be deleted from this app")
    guard_protected(path)

    bin_dir = trash_dir()
    if bin_dir is None:
        raise ValueError("no Trash folder is available, so nothing was deleted")
    if path == bin_dir or str(path).startswith(str(bin_dir) + "/"):
        raise ValueError("that item is already in the Trash")

    dest, n = bin_dir / path.name, 2
    while dest.exists():
        dest = bin_dir / f"{path.stem} {n}{path.suffix}"
        n += 1
    shutil.move(str(path), str(dest))
    return {"path": str(path), "trashed": str(dest), "name": path.name}


def write_text_file(path: Path, text: str, expected_mtime: str | None) -> dict:
    if path.exists() and not path.is_file():
        raise ValueError("target is not a regular file")
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


# --------------------------------------------------------------------------
# request handler
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = f"Reader/{VERSION}"
    protocol_version = "HTTP/1.1"
    verbose = False

    # -- plumbing ----------------------------------------------------------

    def log_message(self, fmt, *args):  # noqa: A003
        if Handler.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, obj, status=HTTPStatus.OK):
        self._send(status, json.dumps(obj).encode("utf-8"),
                   "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _error(self, status, message):
        self._json({"error": message}, status)

    def _text(self, status, message):
        self._send(status, message.encode("utf-8"), "text/plain; charset=utf-8")

    # -- auth --------------------------------------------------------------

    def _host_ok(self) -> bool:
        """Only answer to loopback names. Stops DNS rebinding, where a hostile
        site points its own domain at 127.0.0.1 to become same-origin."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip()
        return host in LOOPBACK_HOSTS or host == ""

    def _origin_ok(self) -> bool:
        """Refuse cross-origin API calls outright (defence in depth)."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        port = self.server.server_address[1]
        return origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

    def _cookie_token(self) -> str:
        raw = self.headers.get("Cookie") or ""
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE:
                return value
        return ""

    def _authed(self, query: dict) -> bool:
        for candidate in (self._cookie_token(),
                          self.headers.get("X-MDView-Token") or "",
                          (query.get("t") or [""])[0]):
            if candidate and secrets.compare_digest(candidate, TOKEN):
                return True
        return False

    # -- routing -----------------------------------------------------------

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        route, query = parsed.path, urllib.parse.parse_qs(parsed.query)

        if not self._host_ok():
            return self._text(HTTPStatus.FORBIDDEN, "unexpected Host header")

        if route == "/api/ping":
            return self._json({"app": APP_NAME, "version": VERSION})

        if route == "/":
            # Arriving with the token hands the browser a cookie and bounces to
            # the bare URL, so the address bar stays clean and bookmarkable.
            if (query.get("t") or [""])[0] and self._authed(query):
                return self._set_session_and_redirect()
            if self._authed(query):
                return self.serve_static("index.html", no_store=True)
            return self._unauthorised_page()

        if route.startswith("/static/"):
            return self.serve_static(route[len("/static/"):])

        if route.startswith("/api/"):
            if not self._origin_ok():
                return self._error(HTTPStatus.FORBIDDEN, "cross-origin request refused")
            if not self._authed(query):
                return self._error(HTTPStatus.FORBIDDEN, "invalid token")
            return self.api_get(route, query)

        if route == "/favicon.ico":
            return self.serve_static("icon.svg")

        return self._text(HTTPStatus.NOT_FOUND, "not found")

    def _set_session_and_redirect(self):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", "/")
        self.send_header("Set-Cookie",
                         f"{COOKIE}={TOKEN}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
                         "HttpOnly; SameSite=Strict")
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _unauthorised_page(self):
        body = (
            "<!doctype html><meta charset=utf-8><title>Markdown Viewer</title>"
            "<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;"
            "background:#faf9f5;color:#141413;display:grid;place-items:center;height:100vh;margin:0}"
            "div{max-width:30rem;padding:2rem;text-align:center}h1{font-size:19px;margin:0 0 .6rem}"
            "p{color:#57554e;margin:0 0 .5rem}code{background:#ebe8dd;padding:.15em .4em;border-radius:5px;"
            "font-family:ui-monospace,Menlo,monospace;font-size:13px}</style>"
            "<div><h1>This browser is not authorised yet</h1>"
            "<p>Start Markdown Viewer from <code>Markdown Viewer.command</code> once, "
            "and it will open here with permission granted.</p>"
            "<p>After that this address keeps working, so you can bookmark it "
            "or install it as an app.</p></div>"
        )
        self._send(HTTPStatus.FORBIDDEN, body.encode("utf-8"), "text/html; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        route, query = parsed.path, urllib.parse.parse_qs(parsed.query)
        if not self._host_ok():
            return self._text(HTTPStatus.FORBIDDEN, "unexpected Host header")
        if not route.startswith("/api/"):
            return self._text(HTTPStatus.NOT_FOUND, "not found")
        if not self._origin_ok():
            return self._error(HTTPStatus.FORBIDDEN, "cross-origin request refused")
        if not self._authed(query):
            return self._error(HTTPStatus.FORBIDDEN, "invalid token")

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_TEXT_BYTES:
            return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "payload too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._error(HTTPStatus.BAD_REQUEST, "invalid JSON body")
        return self.api_post(route, payload)

    # -- static ------------------------------------------------------------

    def serve_static(self, rel: str, no_store: bool = False):
        target = (STATIC_DIR / urllib.parse.unquote(rel)).resolve()
        try:
            target.relative_to(STATIC_DIR)
        except ValueError:
            return self._text(HTTPStatus.FORBIDDEN, "forbidden")
        if not target.is_file():
            return self._text(HTTPStatus.NOT_FOUND, "not found")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self._send(HTTPStatus.OK, target.read_bytes(), ctype,
                   {"Cache-Control": "no-store" if no_store else "no-cache"})

    # -- api ---------------------------------------------------------------

    def api_get(self, route: str, query: dict):
        arg = (query.get("path") or [""])[0]
        try:
            if route == "/api/config":
                return self._json({
                    "app": APP_NAME, "version": VERSION,
                    "appDir": str(APP_DIR), "prefsFile": str(PREFS_FILE),
                    "home": str(Path.home()), "roots": quick_roots(),
                    "start": self.server.start_dir, "startFile": self.server.start_file,
                })
            if route == "/api/prefs":
                return self._json(read_prefs())
            if route == "/api/list":
                show_all = (query.get("all") or ["0"])[0] == "1"
                return self._json(list_dir(resolve_path(arg), show_all))
            if route == "/api/file":
                return self._json(read_text_file(resolve_path(arg)))
            if route == "/api/stat":
                return self._json(stat_file(resolve_path(arg)))
            if route == "/api/raw":
                return self.serve_raw(resolve_path(arg))
            if route == "/api/doc":
                return self.serve_doc(resolve_path(arg))
        except PermissionError:
            return self._error(HTTPStatus.FORBIDDEN, "permission denied")
        except (FileNotFoundError, NotADirectoryError):
            return self._error(HTTPStatus.NOT_FOUND, "no such file or folder")
        except ValueError as exc:
            return self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except OSError as exc:
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, exc.strerror or str(exc))
        return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")

    def api_post(self, route: str, payload: dict):
        try:
            if route == "/api/save":
                path = resolve_path(payload.get("path", ""))
                text = payload.get("text")
                if not isinstance(text, str):
                    return self._error(HTTPStatus.BAD_REQUEST, "missing text")
                mtime = payload.get("mtime")
                mtime = str(mtime) if isinstance(mtime, (str, int)) else None
                return self._json(write_text_file(path, text, mtime))
            if route == "/api/delete":
                return self._json(move_to_trash(resolve_path(payload.get("path", ""))))
            if route == "/api/rename":
                return self._json(rename_path(resolve_path(payload.get("path", "")),
                                              str(payload.get("name", ""))))
            if route == "/api/prefs":
                if not isinstance(payload, dict):
                    return self._error(HTTPStatus.BAD_REQUEST, "preferences must be an object")
                if len(json.dumps(payload)) > MAX_PREFS_BYTES:
                    return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "preferences too large")
                write_prefs(payload)
                return self._json({"ok": True})
        except PermissionError:
            return self._error(HTTPStatus.FORBIDDEN, "permission denied")
        except FileNotFoundError:
            return self._error(HTTPStatus.NOT_FOUND, "no such file or folder")
        except FileExistsError as exc:
            return self._error(HTTPStatus.CONFLICT, str(exc))
        except ValueError as exc:
            return self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except OSError as exc:
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, exc.strerror or str(exc))
        return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")

    def serve_raw(self, path: Path):
        """Serve an image referenced by a document (same origin, token required)."""
        if not path.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "no such file")
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            return self._error(HTTPStatus.FORBIDDEN, "unsupported file type")
        if path.stat().st_size > MAX_IMAGE_BYTES:
            return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "image too large")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self._send(HTTPStatus.OK, path.read_bytes(), ctype,
                   {"Cache-Control": "no-store",
                    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


    def serve_doc(self, path: Path):
        """Serve a PDF inline so the browser's own viewer renders it."""
        if not path.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "no such file")
        if path.suffix.lower() not in PDF_SUFFIXES:
            return self._error(HTTPStatus.FORBIDDEN, "unsupported file type")
        if path.stat().st_size > MAX_PDF_BYTES:
            return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "PDF too large")
        self._send(HTTPStatus.OK, path.read_bytes(), "application/pdf",
                   {"Cache-Control": "no-store",
                    "Content-Disposition": 'inline; filename="%s"'
                                           % path.name.replace('"', "")})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    start_dir = str(Path.home())
    start_file = None


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def already_running(port: int) -> bool:
    """Is the thing holding this port our own app?"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.0) as resp:
            return json.loads(resp.read().decode("utf-8")).get("app") == APP_NAME
    except Exception:
        return False


def bind(preferred: int | None) -> Server:
    """Prefer a stable port so the app keeps one bookmarkable address."""
    tries = [preferred] if preferred else [DEFAULT_PORT, 0]
    last = None
    for port in tries:
        try:
            return Server(("127.0.0.1", port), Handler)
        except OSError as exc:
            last = exc
            if exc.errno not in (errno.EADDRINUSE, errno.EACCES):
                raise
    raise last


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=f"{APP_NAME} - browse, preview and edit markdown.")
    ap.add_argument("path", nargs="?", default=None, help="folder or .md file to open (default: home)")
    ap.add_argument("--port", type=int, default=None, help=f"fixed port (default: {DEFAULT_PORT})")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    ap.add_argument("--verbose", action="store_true", help="log every request")
    args = ap.parse_args(argv)

    if not STATIC_DIR.is_dir():
        print(f"error: missing folder {STATIC_DIR}", file=sys.stderr)
        return 1

    start_dir, start_file = Path.home(), None
    if args.path:
        try:
            target = resolve_path(args.path)
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        if target.is_dir():
            start_dir = target
        elif target.is_file():
            start_dir, start_file = target.parent, target
        else:
            print(f"error: no such file or folder: {target}", file=sys.stderr)
            return 1

    Handler.verbose = args.verbose

    wanted = args.port or DEFAULT_PORT
    if already_running(wanted):
        url = f"http://127.0.0.1:{wanted}/"
        print(f"\n  {APP_NAME} is already running at {url}")
        print("  Opening that window instead.\n", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    try:
        httpd = bind(args.port)
    except OSError as exc:
        print(f"error: cannot start the server ({exc})", file=sys.stderr)
        return 1

    httpd.start_dir = str(start_dir)
    httpd.start_file = str(start_file) if start_file else None
    port = httpd.server_address[1]
    home_url = f"http://127.0.0.1:{port}/"
    entry_url = home_url + f"?t={TOKEN}"

    print(f"\n  {APP_NAME} {VERSION}")
    print(f"  {home_url}\n")
    if port != DEFAULT_PORT and not args.port:
        print(f"  (port {DEFAULT_PORT} was busy, so this run uses {port})")
    print("  Bookmark that address or install it as an app — it does not change.")
    print(f"  Preferences: {PREFS_FILE}")
    print("  Keep this window open while you use the app; press Control-C to stop.\n", flush=True)

    if not args.no_browser:
        threading.Timer(0.3, webbrowser.open, args=(entry_url,)).start()

    try:
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print(f"\n{APP_NAME} stopped.", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
