"""
app.py - start the Mini CPU Simulator GUI.

    python gui/app.py --exe "C:\\path\\to\\Project.exe"     real engine
    python gui/app.py                                       uses config.json / auto-search
    python gui/app.py --mock                                DEV ONLY: Python mock engine

The window shows gui/web/index.html (HTML/CSS/JS). Python only passes text
between the page and CPU.exe; see bridge.py.
"""

import argparse
import json
import os
import sys

import webview

from bridge import Api, GUI_DIR

ROOT_DIR = os.path.dirname(GUI_DIR)
CONFIG_PATH = os.path.join(GUI_DIR, "config.json")

# Reuse the exe search of the test runner instead of writing it twice.
sys.path.insert(0, os.path.join(ROOT_DIR, "tests"))
from run_tests import find_exe  # noqa: E402


def read_config_exe():
    """exe_path from gui/config.json, or '' if the file or key is missing."""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("exe_path", "") or ""
    except (OSError, ValueError):
        return ""


def choose_engine(args):
    """Return {"state", "path"}: --mock, then --exe, then config.json, then auto-search."""
    if args.mock:
        return {"state": "mock", "path": "gui/mock_cpu.py"}
    for candidate in (args.exe, read_config_exe()):
        if candidate:
            path = find_exe(candidate)
            return {"state": "ready" if path else "missing", "path": path or candidate}
    path = find_exe(None)
    return {"state": "ready", "path": path} if path else {"state": "missing", "path": ""}


def main():
    parser = argparse.ArgumentParser(description="Mini CPU Simulator GUI")
    parser.add_argument("--exe", help="path to CPU.exe built by Visual Studio")
    parser.add_argument("--mock", action="store_true",
                        help="DEV ONLY: use the Python mock engine (shows a MOCK ENGINE badge)")
    parser.add_argument("--debug", action="store_true", help="open the web inspector")
    args = parser.parse_args()

    api = Api(choose_engine(args), find_engine=lambda: choose_engine(args))
    window = webview.create_window(
        "Mini CPU Simulator", url=os.path.join(GUI_DIR, "web", "index.html"),
        js_api=api, width=1440, height=900, min_size=(1280, 680),
        background_color="#0A0F1C")
    api._window = window
    # http_server=True serves the page over http://127.0.0.1, which ES modules need.
    webview.start(debug=args.debug, http_server=True)


if __name__ == "__main__":
    main()
