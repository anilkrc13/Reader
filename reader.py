#!/usr/bin/env python3
"""
Reader -- a small local document browser: markdown, code, CSV and PDF.

Runs a loopback-only HTTP server and opens the UI in your default browser.
Standard library only: no pip installs, no network access at runtime.

    python3 reader.py [PATH] [--port N] [--no-browser]

PATH may be a folder (opens the browser there) or a file (opens it). A
relative PATH is taken against your home folder, not the working directory,
so that double-clicking the launcher behaves the same as running it here.

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
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from reader_backend import (
    EXTERNAL_APP_SUFFIXES, IMAGE_SUFFIXES, MAX_IMAGE_BYTES, MAX_PDF_BYTES,
    MAX_TEXT_BYTES, PDF_SUFFIXES, DocumentStore, FileAccessPolicy,
    WorkspaceError, WorkspaceGrantStore,
)

APP_NAME = "Reader"
APP_DIR = Path(__file__).resolve().parent


def _read_version() -> str:
    """The VERSION file beside this script is the single source of truth; the
    app bundle and the release workflow read the same file."""
    try:
        return (APP_DIR / "VERSION").read_text("utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


VERSION = _read_version()
STATIC_DIR = APP_DIR / "static"
DEFAULT_PORT = 8737          # stable by default; falls back to a free port

MAX_PREFS_BYTES = 256 * 1024          # a preferences blob should never be big

# Reader's second lock on a booby-trapped document. The first is the sanitiser
# the page runs over every rendered document; this is what holds if that ever
# fails, because the browser refuses the script rather than trusting us to have
# removed it. Everything Reader needs comes from Reader, so the rule can say so.
#
# Two deliberate looseninesses, each keeping a behaviour that already works:
#   style-src allows inline, because a document may carry style="" on its own
#     markup and losing that would change how existing documents render;
#   img-src and media-src allow http/https, because a document may reference a
#     picture on the web and that has always displayed.
APP_CSP = (
    "default-src 'none'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https: http:; "
    "media-src 'self' https: http:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "frame-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'none'; "
    "frame-ancestors 'none'"
)

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


def open_with_default_app(path: Path) -> str | None:
    """Hand a file to whatever application the OS has registered for it.

    Returns None on success, or an error message on failure. The three
    platforms have no shared launcher: macOS has `open`, Windows has
    os.startfile (no subprocess, no stderr to read), and everything else
    is expected to have xdg-open. Each branch maps its own failure mode to
    the same error shape so the caller does not need to know which platform
    it is running on.
    """
    if sys.platform == "darwin":
        try:
            proc = subprocess.run(["open", str(path)], capture_output=True, timeout=15)
        except subprocess.TimeoutExpired:
            return "timed out handing the file to the default app"
        if proc.returncode:
            return proc.stderr.decode("utf-8", "replace").strip() or "could not open"
        return None
    if sys.platform == "win32":
        try:
            os.startfile(str(path))  # type: ignore[attr-defined]
        except OSError as exc:
            return str(exc) or "could not open"
        return None
    try:
        proc = subprocess.run(["xdg-open", str(path)], capture_output=True, timeout=15)
    except subprocess.TimeoutExpired:
        return "timed out handing the file to the default app"
    except FileNotFoundError:
        return "xdg-open is not installed"
    if proc.returncode:
        return proc.stderr.decode("utf-8", "replace").strip() or "could not open"
    return None


def default_data_dir() -> Path:
    """The OS-conventional per-user data folder for Reader.

    Used as a fallback when the script's own folder is not writable (an
    installed, read-only copy) and as the base for platform state that has
    nowhere else to live, such as the Windows Trash fallback in
    reader_backend.move_to_trash. macOS keeps its historical path exactly;
    Windows and everything else follow their own conventions rather than
    reusing the macOS one, since neither has a "Library/Application Support".
    """
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / APP_NAME
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "reader"


def choose_prefs_file() -> Path:
    """Choose writable state storage without modifying a packaged app bundle."""
    data_dir = os.environ.get("READER_DATA_DIR")
    if data_dir:
        support = Path(data_dir).expanduser()
        try:
            support.mkdir(parents=True, exist_ok=True)
            return support / "preferences.json"
        except OSError:
            pass

    # Keep the command-line version portable when it is run from source.
    beside = APP_DIR / "preferences.json"
    if beside.exists() or os.access(APP_DIR, os.W_OK):
        return beside
    support = default_data_dir()
    try:
        support.mkdir(parents=True, exist_ok=True)
        if os.access(support, os.W_OK):
            return support / "preferences.json"
    except OSError:
        pass
    return Path.home() / ".reader-preferences.json"


PREFS_FILE = choose_prefs_file()
PREFS_LOCK = threading.Lock()


def _rewrite_token(path: Path, token: str) -> None:
    """Write the token readable only by its owner. Best effort: a token we
    cannot persist still works for this run, it just will not survive it.

    The 0o600 mode above is ignored on Windows: NTFS has no POSIX mode bits,
    so os.open honours only the read-only attribute, not the owner-only part.
    icacls is the Windows equivalent, run as a second best-effort step below.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(token)
    except OSError:
        return
    if sys.platform == "win32":
        _restrict_token_acl(path)


def _restrict_token_acl(path: Path) -> None:
    """Best effort: strip inherited permissions and grant only the current
    user full control, matching the intent of the POSIX 0o600 above. Failure
    here (icacls missing, no permission to change ACLs, etc.) is silent for
    the same reason the write above is: the token still works this run."""
    user = os.environ.get("USERNAME")
    if not user:
        return
    try:
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
            capture_output=True, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def load_or_make_token() -> str:
    """A stable secret, so the app has one unchanging URL you can bookmark or
    install as a browser app. Readable only by you."""
    path = PREFS_FILE.parent / ".reader-token"
    legacy = PREFS_FILE.parent / ".mdview-token"     # pre-2.0 name
    for candidate in (path, legacy):
        try:
            existing = candidate.read_text("utf-8").strip()
        except OSError:
            continue
        if len(existing) >= 24:
            if candidate is legacy:
                _rewrite_token(path, existing)       # adopt it under the new name
            return existing
    token = secrets.token_urlsafe(24)
    _rewrite_token(path, token)
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
    # These are navigation choices, not launch-time filesystem probes. In
    # particular, touching Documents here can make macOS ask for access before
    # the user has selected it.
    return [
        {"name": "Home", "path": str(home)},
        {"name": "Desktop", "path": str(home / "Desktop")},
        {"name": "Documents", "path": str(home / "Documents")},
        {"name": "Downloads", "path": str(home / "Downloads")},
    ]


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------

DOCUMENT_STORE = DocumentStore(FileAccessPolicy(
    APP_DIR, WorkspaceGrantStore([Path.home()]), data_dir=default_data_dir()))


def resolve_path(raw: str) -> Path:
    return DOCUMENT_STORE.policy.resolve(raw)


def list_dir(path: Path, include_all: bool = False, include_files: bool = False,
             include_hidden: bool = False) -> dict:
    return DOCUMENT_STORE.list_dir(path, include_all, include_files, include_hidden)


def read_text_file(path: Path) -> dict:
    return DOCUMENT_STORE.read_text_file(path)


def stat_file(path: Path) -> dict:
    return DOCUMENT_STORE.stat_file(path)


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
                          self.headers.get("X-Reader-Token") or "",
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
            "<!doctype html><meta charset=utf-8><title>Reader</title>"
            "<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;"
            "background:#faf9f5;color:#141413;display:grid;place-items:center;height:100vh;margin:0}"
            "div{max-width:30rem;padding:2rem;text-align:center}h1{font-size:19px;margin:0 0 .6rem}"
            "p{color:#57554e;margin:0 0 .5rem}code{background:#ebe8dd;padding:.15em .4em;border-radius:5px;"
            "font-family:ui-monospace,Menlo,monospace;font-size:13px}</style>"
            "<div><h1>This browser is not authorised yet</h1>"
            "<p>Start Reader from <code>install/Reader.command</code> once, "
            "and it will open here with permission granted.</p>"
            "<p>After that this address keeps working, so you can bookmark it "
            "or install it as an app.</p></div>"
        )
        self._send(HTTPStatus.FORBIDDEN, body.encode("utf-8"), "text/html; charset=utf-8",
                   {"Cache-Control": "no-store", "Content-Security-Policy": APP_CSP})

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
                   {"Cache-Control": "no-store" if no_store else "no-cache",
                    "Content-Security-Policy": APP_CSP})

    # -- api ---------------------------------------------------------------

    def api_get(self, route: str, query: dict):
        arg = (query.get("path") or [""])[0]
        store = self.server.documents
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
                show_files = (query.get("files") or ["0"])[0] == "1"
                show_hidden = (query.get("hidden") or ["0"])[0] == "1"
                return self._json(store.list_dir(store.policy.resolve(arg),
                                                 show_all, show_files, show_hidden))
            if route == "/api/can-create":
                return self._json(store.can_create_in(store.policy.resolve(arg)))
            if route == "/api/search":
                show_files = (query.get("files") or ["0"])[0] == "1"
                show_hidden = (query.get("hidden") or ["0"])[0] == "1"
                return self._json(store.find_files(
                    store.policy.resolve(arg), (query.get("q") or [""])[0],
                    include_hidden=show_hidden, include_files=show_files))
            if route == "/api/file":
                return self._json(store.read_text_file(store.policy.resolve(arg)))
            if route == "/api/stat":
                return self._json(store.stat_file(store.policy.resolve(arg)))
            if route == "/api/raw":
                return self.serve_raw(store.policy.resolve(arg))
            if route == "/api/doc":
                return self.serve_doc(store.policy.resolve(arg))
        except WorkspaceError as exc:
            return self._error(HTTPStatus.FORBIDDEN, str(exc))
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
        if not isinstance(payload, dict):
            return self._error(HTTPStatus.BAD_REQUEST, "request body must be an object")
        store = self.server.documents
        try:
            if route == "/api/save":
                path = store.policy.resolve(payload.get("path", ""))
                text = payload.get("text")
                if not isinstance(text, str):
                    return self._error(HTTPStatus.BAD_REQUEST, "missing text")
                mtime = payload.get("mtime")
                mtime = str(mtime) if isinstance(mtime, (str, int)) else None
                return self._json(store.write_text_file(path, text, mtime))
            if route == "/api/delete":
                return self._json(store.move_to_trash(store.policy.resolve(payload.get("path", ""))))
            if route == "/api/create":
                folder = store.policy.resolve(payload.get("dir", ""))
                return self._json(store.create_document(folder, str(payload.get("name", ""))))
            if route == "/api/rename":
                return self._json(store.rename_path(store.policy.resolve(payload.get("path", "")),
                                                    str(payload.get("name", ""))))
            if route == "/api/move":
                path = store.policy.resolve(payload.get("path", ""))
                target_dir = store.policy.resolve(payload.get("targetDir", ""))
                return self._json(store.move_file(path, target_dir))
            if route == "/api/open-external":
                path = resolve_path(payload.get("path", ""))
                if not path.is_file():
                    return self._error(HTTPStatus.NOT_FOUND, "no such file")
                if path.suffix.lower() not in EXTERNAL_APP_SUFFIXES:
                    return self._error(HTTPStatus.FORBIDDEN,
                                       "not a document Reader hands to another app")
                error = open_with_default_app(path)
                if error is not None:
                    return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, error)
                return self._json({"ok": True})
            if route == "/api/prefs":
                if not isinstance(payload, dict):
                    return self._error(HTTPStatus.BAD_REQUEST, "preferences must be an object")
                if len(json.dumps(payload)) > MAX_PREFS_BYTES:
                    return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "preferences too large")
                write_prefs(payload)
                return self._json({"ok": True})
        except WorkspaceError as exc:
            return self._error(HTTPStatus.FORBIDDEN, str(exc))
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
    documents = DOCUMENT_STORE

    def server_bind(self):
        # HTTPServer.server_bind() looks up socket.getfqdn(host) to fill in
        # server_name, so it can stamp Location headers etc. with a real
        # hostname. We only ever bind to 127.0.0.1, so that hostname is
        # never used for anything, and the lookup itself can be no lookup
        # at all: it can fall through to a real (possibly network-backed)
        # reverse-DNS resolution, and that resolution runs *before* the
        # socket starts listening, so a slow or hung resolver leaves the
        # port bound-but-not-accepting for as long as it takes. On some
        # networks (seen on GitHub's macOS runners) that stall runs past
        # 30 seconds, long enough to blow through Playwright's navigation
        # timeout on the very first request. Skip it and set the name
        # directly; nothing downstream reads server_name for a loopback
        # server anyway.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


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
    # The default workspace is the user's home folder. An explicitly supplied
    # external start folder remains usable, but saves cannot wander into an
    # unrelated tree later through a forged API path.
    grants = WorkspaceGrantStore([Path.home(), start_dir])
    httpd.documents = DocumentStore(FileAccessPolicy(APP_DIR, grants, data_dir=default_data_dir()))
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
