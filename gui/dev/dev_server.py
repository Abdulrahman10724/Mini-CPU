"""
dev_server.py - DEVELOPMENT ONLY (screenshots / UI work on machines without a desktop).

Serves gui/web/ over http and answers the calls that window.pywebview.api would make,
using the real bridge.Api with the MOCK engine. Pair it with gui/dev/shim.js, which
the browser test script injects; index.html never loads the shim.

    python gui/dev/dev_server.py [--port 8765] [--missing]
"""

import argparse
import http.server
import json
import os
import sys

DEV_DIR = os.path.dirname(os.path.abspath(__file__))
GUI_DIR = os.path.dirname(DEV_DIR)
sys.path.insert(0, GUI_DIR)

from bridge import Api  # noqa: E402

WEB_DIR = os.path.join(GUI_DIR, "web")


def make_handler(api):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=WEB_DIR, **kwargs)

        def do_POST(self):
            name = self.path.rsplit("/", 1)[-1]
            length = int(self.headers.get("Content-Length", 0))
            args = json.loads(self.rfile.read(length) or b"[]")
            method = getattr(api, name, None)
            if name.startswith("_") or method is None:
                body = {"ok": False, "error": f"no api method {name}"}
            else:
                body = method(*args)
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass
    return Handler


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--missing", action="store_true", help="pretend CPU.exe is not found")
    a = p.parse_args()
    engine = {"state": "missing", "path": ""} if a.missing else {"state": "mock", "path": "gui/mock_cpu.py"}
    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(Api(engine)))
    print(f"dev server on http://127.0.0.1:{a.port}/  engine={engine['state']}")
    server.serve_forever()
