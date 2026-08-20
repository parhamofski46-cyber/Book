"""Local HTTP server for the desktop UI.

Bound to 127.0.0.1 on an ephemeral port. Every API call must carry the
token minted at start-up, so a web page you happen to have open cannot
drive the application through localhost.
"""

from __future__ import annotations

import hmac
import json
import logging
import mimetypes
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .controller import AppController

log = logging.getLogger("ui.server")
STATIC = Path(__file__).parent / "static"
MAX_BODY = 256 * 1024


class _Handler(BaseHTTPRequestHandler):
    server_version = "NobitexArbLab"
    controller: AppController
    token: str

    # -- helpers ------------------------------------------------------------

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _send(self, code: int, body: bytes, content_type: str, cache: bool = False) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, payload: Any, code: int = 200) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _authorised(self, query: dict[str, list[str]]) -> bool:
        supplied = self.headers.get("X-Auth-Token") or (query.get("token") or [""])[0]
        return hmac.compare_digest(supplied, self.token)

    def _body(self) -> tuple[dict | None, int]:
        """Return (payload, error_code). A rejected body must never read as success."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, 400
        if length <= 0:
            return {}, 0
        if length > MAX_BODY:
            return None, 413
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None, 400
        if payload is None:
            return {}, 0
        if not isinstance(payload, dict):
            return None, 400
        return payload, 0

    # -- routes -------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        if route in ("/", "/index.html"):
            return self._serve_index()
        if not route.startswith("/api/"):
            return self._serve_static(route)
        if not self._authorised(query):
            return self._json({"error": "unauthorised"}, 403)

        try:
            if route == "/api/status":
                return self._json(self.controller.status())
            if route == "/api/doctor":
                return self._json(self.controller.doctor())
            if route == "/api/runs":
                return self._json({"runs": self.controller.runs()})
            if route == "/api/report":
                rid = query.get("run", [None])[0]
                return self._json(self.controller.report(int(rid) if rid else None))
            if route == "/api/config":
                return self._json(self.controller.get_config())
        except Exception as exc:
            log.exception("GET %s failed", route)
            return self._json({"error": str(exc)}, 500)
        return self._json({"error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        if not self._authorised(parse_qs(parsed.query)):
            return self._json({"error": "unauthorised"}, 403)
        body, body_error = self._body()
        if body is None:
            return self._json(
                {"ok": False, "error": "request body too large" if body_error == 413
                 else "malformed request body"},
                body_error,
            )
        try:
            if route == "/api/start":
                return self._json(self.controller.start())
            if route == "/api/stop":
                return self._json(self.controller.stop())
            if route == "/api/config":
                return self._json(self.controller.save_config(body))
            if route == "/api/export":
                return self._json(self.controller.export(body.get("run")))
            if route == "/api/replay":
                return self._json(self.controller.replay(
                    int(body["run"]), body.get("fee_rate"), body.get("min_profit_bps")))
        except Exception as exc:
            log.exception("POST %s failed", route)
            return self._json({"error": str(exc)}, 500)
        return self._json({"error": "not found"}, 404)

    # -- static -------------------------------------------------------------

    def _serve_index(self) -> None:
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        html = html.replace("__AUTH_TOKEN__", self.token)
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _serve_static(self, route: str) -> None:
        name = route.lstrip("/")
        target = (STATIC / name).resolve()
        try:
            target.relative_to(STATIC.resolve())
        except ValueError:
            return self._json({"error": "forbidden"}, 403)
        if not target.is_file():
            return self._json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype, cache=True)


class UiServer:
    def __init__(self, controller: AppController, host: str = "127.0.0.1", port: int = 0) -> None:
        self.token = secrets.token_urlsafe(24)
        handler = type("BoundHandler", (_Handler,), {"controller": controller, "token": self.token})
        self.httpd = ThreadingHTTPServer((host, port), handler)
        self.httpd.daemon_threads = True
        self.host, self.port = self.httpd.server_address[0], self.httpd.server_address[1]
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def start(self) -> None:
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="ui-http", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5.0)
