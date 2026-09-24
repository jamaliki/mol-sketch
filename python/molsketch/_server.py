"""molsketch serve: the app, with its figures drawn by this package.

The server hands out the app (its built files, bundled here) and a small API the app draws through:

    GET  /api/health                          → {"molsketch": version}
    POST /api/put     {"input": …}            → {"ref": "in3"}         a structure's text, a scene or a stack, kept here
    POST /api/drop    {"ref": "in3"}          → {}
    POST /api/render  {figure spec}           → image/png              the same drawing as Figure.render
                      (with "format": "svg")  → image/svg+xml          as Figure.svg
    POST /api/call    {"name": …, "args": […]} → JSON                  frames, info, pocket, frameTheSite, labelTheSite, …

The app finds the API on its own origin (served from here) or, while developing, at http://localhost:8471 (vite's
dev server on 5173 is let through). One engine serves every request, one at a time."""
from __future__ import annotations

import json
import mimetypes
import pathlib
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import skia

from . import __version__
from ._engine import CoreError, engine

APP = pathlib.Path(__file__).resolve().parent / "app"
CALLS = {"frames", "info", "pocket", "frameTheSite", "labelTheSite", "atomId", "sceneJson", "catalog", "ribbons", "engineConfig"}
DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


class _Handler(BaseHTTPRequestHandler):
    server_version = f"molsketch/{__version__}"

    def log_message(self, fmt, *args):   # quiet: one line per render at most
        if self.server.verbose: super().log_message(fmt, *args)

    def _cors(self):
        o = self.headers.get("Origin")
        if o in DEV_ORIGINS: self.send_header("Access-Control-Allow-Origin", o); self.send_header("Vary", "Origin")

    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code); self._cors(); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT); self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health": return self._json({"molsketch": __version__})
        f = (APP / path.lstrip("/")).resolve() if path != "/" else APP / "index.html"
        if not str(f).startswith(str(APP)) or not f.is_file(): f = APP / "index.html" if not path.startswith(("/assets/", "/examples/")) else None
        if f is None or not f.is_file(): return self._send(404, b"not found", "text/plain")
        self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            E = engine()
            if path == "/api/put": return self._json({"ref": E.put(body["input"])})
            if path == "/api/drop": E.call("drop", body["ref"]); return self._json({})
            if path == "/api/render":
                if body.pop("format", "png") == "svg": return self._send(200, E.render_svg(body).encode(), "image/svg+xml")
                img = E.render(body)
                return self._send(200, bytes(img.encodeToData(skia.kPNG, 100)), "image/png")
            if path == "/api/call":
                if body.get("name") not in CALLS: return self._json({"error": f"no call {body.get('name')!r}"}, 400)
                return self._json(E.call(body["name"], *body.get("args", [])))
            self._json({"error": "not found"}, 404)
        except CoreError as e:
            self._json({"error": str(e)}, 422)
        except Exception as e:   # a bad request, not a crash of the server
            self._json({"error": f"{type(e).__name__}: {e}"}, 400)


def serve(port: int = 8471, host: str = "127.0.0.1", open_browser: bool = True, verbose: bool = False):
    """Run the app with its figures drawn by molsketch, at http://host:port (Ctrl-C stops it)."""
    if not (APP / "index.html").exists(): raise RuntimeError("the app is not bundled in this install (run app/scripts/build-python.mjs)")
    engine()   # load the engine before the first request
    for p in range(port, port + 20):   # the next free port if this one is taken
        try: httpd = ThreadingHTTPServer((host, p), _Handler); port = p; break
        except OSError: continue
    else: raise OSError(f"no free port from {port} to {port + 19}")
    httpd.verbose = verbose
    url = f"http://{host}:{port}/"
    print(f"MolSketch at {url}  (Ctrl-C to stop)")
    if open_browser: threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try: httpd.serve_forever()
    except KeyboardInterrupt: print()
    finally: httpd.server_close()
