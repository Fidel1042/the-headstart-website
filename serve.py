#!/usr/bin/env python3
"""Tiny static web server that disables browser caching.

Run with: python3 serve.py
Then open: http://localhost:8080/mobile-preview.html

The Cache-Control: no-store header forces Chrome to re-fetch every CSS,
HTML and JS file on every load, so design tweaks always show up live.
"""
import http.server
import socketserver

PORT = 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving (no-cache) at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
