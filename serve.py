#!/usr/bin/env python3
"""
Live-reload static server. Watches .html/.css/.js files and instantly
refreshes connected browsers via Server-Sent Events — no pip installs needed.

Run:  python3 serve.py
Open: http://localhost:8080/preview.html
"""

import http.server
import socketserver
import threading
import os
import time
import queue
from pathlib import Path

PORT = 8080
WATCH_EXTENSIONS = {".html", ".css", ".js"}
POLL_INTERVAL = 0.4

_clients: list = []
_clients_lock = threading.Lock()

LIVERELOAD_SCRIPT = b"""<script>
(function(){
  var es = new EventSource('/__livereload');
  es.onmessage = function(e){ if(e.data==='reload') location.reload(); };
})();
</script>"""


def _scan(root: str) -> dict:
    out = {}
    for p in Path(root).rglob("*"):
        if p.suffix in WATCH_EXTENSIONS and ".git" not in p.parts:
            try:
                out[str(p)] = p.stat().st_mtime
            except OSError:
                pass
    return out


def _watcher(root: str):
    snap = _scan(root)
    while True:
        time.sleep(POLL_INTERVAL)
        new = _scan(root)
        if new != snap:
            snap = new
            _broadcast("reload")


def _broadcast(msg: str):
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)


class Handler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path.split("?")[0] == "/__livereload":
            self._sse()
            return

        fs_path = self.translate_path(self.path)

        # Inject livereload into all HTML except the preview shell itself
        if (
            os.path.isfile(fs_path)
            and fs_path.endswith(".html")
            and not fs_path.endswith("preview.html")
        ):
            self._serve_html(fs_path)
            return

        super().do_GET()

    def _serve_html(self, fs_path: str):
        try:
            with open(fs_path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return

        if b"</body>" in body:
            body = body.replace(b"</body>", LIVERELOAD_SCRIPT + b"</body>", 1)
        else:
            body += LIVERELOAD_SCRIPT

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        q: queue.Queue = queue.Queue(maxsize=8)
        with _clients_lock:
            _clients.append(q)

        try:
            while True:
                try:
                    msg = q.get(timeout=20)
                    self.wfile.write(f"data: {msg}\n\n".encode())
                    self.wfile.flush()
                except queue.Empty:
                    # Heartbeat keeps the connection alive
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _clients_lock:
                try:
                    _clients.remove(q)
                except ValueError:
                    pass

    def end_headers(self):
        if self.path.split("?")[0] != "/__livereload":
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and "/__livereload" in str(args[0]):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    root = os.path.dirname(os.path.abspath(__file__))
    threading.Thread(target=_watcher, args=(root,), daemon=True).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n  Live server  →  http://localhost:{PORT}")
        print(f"  Preview page →  http://localhost:{PORT}/preview.html")
        print(f"  Watching .html / .css / .js  (Ctrl+C to stop)\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Stopped.")
