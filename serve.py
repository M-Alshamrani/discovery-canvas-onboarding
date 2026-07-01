#!/usr/bin/env python3
# Dell Discovery Canvas — static file server with correct ES-module MIME types.
#
# The app is served as native ES modules (<script type="module"> + import).
# Browsers enforce strict MIME checking for module scripts: a .js / .mjs file
# served as anything other than a JavaScript MIME type is rejected with
# "Expected a JavaScript-or-Wasm module script but the server responded with a
# MIME type of text/plain".
#
# Python's built-in `python -m http.server` derives MIME types from the host
# system's registry (/etc/mime.types on Linux, the registry on Windows). On
# many machines that maps .js -> text/plain, which breaks the whole app. This
# launcher pins the JavaScript/CSS/wasm types explicitly so `./start.sh`
# (start.bat on Windows) works the same everywhere.

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(SimpleHTTPRequestHandler):
    # Override the extension -> MIME map so module scripts always get a
    # JavaScript content type regardless of the host's system config.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js":   "text/javascript",
        ".mjs":  "text/javascript",
        ".css":  "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".svg":  "image/svg+xml",
    }

    def end_headers(self):
        # Local dev: never serve stale modules from the browser cache.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    handler = partial(Handler, directory=None)
    with ThreadingHTTPServer(("", PORT), handler) as httpd:
        print("Serving Dell Discovery Canvas on http://localhost:%d  (Ctrl+C to stop)" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
