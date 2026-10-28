"""Local dev server for History Atlas.

Serves the site folder with caching turned off, so edits to JS modules and
data files show up on a normal refresh.

    python tools/serve.py          # http://127.0.0.1:8765
    python tools/serve.py 9000     # custom port
"""

import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".geojson": "application/geo+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"History Atlas running at http://127.0.0.1:{PORT}")
        httpd.serve_forever()
