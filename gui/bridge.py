"""
bridge.py - the Api object that JavaScript calls (window.pywebview.api.<method>).

The GUI never checks or runs programs itself. run() only:
  1. writes the editor text to runtime/program.txt
  2. runs the engine (CPU.exe) in the runtime folder
  3. reads runtime/result.txt and returns it as a dict
Every method returns a plain dict/list and never raises to JavaScript.
"""

import csv
import datetime
import io
import json
import os
import subprocess
import sys

from analysis_stats import compute as compute_stats
from result_parser import ResultFormatError, parse_result

GUI_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = os.path.join(GUI_DIR, "runtime")
DEMOS_DIR = os.path.join(GUI_DIR, "demos")
MOCK_CPU = os.path.join(GUI_DIR, "mock_cpu.py")

# Shown in the Demos menu. The program text itself is in gui/demos/<id>.txt
DEMOS = [
    {"id": "01_arithmetic", "title": "Arithmetic",
     "description": "MOV, ADD, SUB, INC and DEC on all four registers"},
    {"id": "02_compare_jump", "title": "Compare and jump",
     "description": "CMP sets the Zero Flag, JZ skips a line"},
    {"id": "03_loop_sum", "title": "Loop: sum 1 to 5",
     "description": "DEC and JNZ L1 repeat a loop until CX reaches 0"},
]

# Hide the console window of CPU.exe on Windows (the constant only exists there).
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
FILE_TYPES = ("Text files (*.txt)", "All files (*.*)")
OPEN_DIALOG, SAVE_DIALOG = 10, 30        # = webview.FileDialog.OPEN / .SAVE


class Api:
    def __init__(self, engine, find_engine=None):
        """engine = {"state": "ready"|"missing"|"mock", "path": str}
        find_engine = function that searches for CPU.exe again (used by Retry)."""
        self._engine = engine
        self._find_engine = find_engine
        self._window = None              # set by app.py; private so JS cannot see it
        self._last = None                # the last run: {"code", "result", "time"} (for §3)
        os.makedirs(RUNTIME_DIR, exist_ok=True)

    # ------------------------------------------------------------------ engine
    def engine_status(self):
        return dict(self._engine)

    def recheck_engine(self):
        """Search for CPU.exe again (after the user built it or edited config.json)."""
        if self._find_engine is not None and self._engine["state"] != "mock":
            self._engine = self._find_engine()
        return dict(self._engine)

    def _engine_command(self):
        if self._engine["state"] == "mock":
            return [sys.executable, MOCK_CPU]
        return [self._engine["path"]]

    def run(self, code):
        """Save code as program.txt, run the engine, return the parsed result.txt."""
        res = self._run_in(code, RUNTIME_DIR)
        if res.get("ok"):
            self._last = {"code": code, "result": res["result"], "time": datetime.datetime.now()}
        return res

    # ------------------------------------------------------------------ §3 analysis
    def analysis(self):
        """Counts and summaries of the LAST run (see analysis_stats.py)."""
        if self._last is None:
            return {"ok": False}
        return {"ok": True, "time": self._last["time"].strftime("%H:%M"),
                "date": self._last["time"].strftime("%d %b %Y"),
                "stats": compute_stats(self._last["result"], self._last["code"])}

    def export_trace(self, file_name="trace.csv"):
        """Save the last run's trace as CSV (one row per step) through a save dialog."""
        if self._last is None:
            return {"ok": False, "error": "Run a program first."}
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\n")
        w.writerow(["step", "line", "instruction", "AX", "BX", "CX", "DX", "ZF", "SF", "CF"])
        lines = self._last["code"].replace("\r\n", "\n").split("\n")
        for st in self._last["result"]["steps"]:
            text = lines[st["line"] - 1].strip() if st["line"] <= len(lines) else ""
            w.writerow([st["n"], st["line"], text, st["ax"], st["bx"], st["cx"], st["dx"],
                        st["zf"], st["sf"], st["cf"]])
        w.writerow(["END", self._last["result"]["end"]["type"], self._last["result"]["end"]["value"]])
        try:
            chosen = self._window.create_file_dialog(SAVE_DIALOG, save_filename=file_name,
                                                     file_types=("CSV files (*.csv)", "All files (*.*)"))
            if not chosen:
                return {"ok": False, "cancelled": True}
            path = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(out.getvalue())
            return {"ok": True, "path": path, "name": os.path.basename(path)}
        except Exception as e:
            return {"ok": False, "error": f"Could not save the trace: {e}"}

    def run_demo(self, demo_id):
        """Run a demo in its own folder (runtime/demo) for the cover's idle animation,
        so the user's program.txt / result.txt are never touched."""
        demo = next((d for d in DEMOS if d["id"] == demo_id), None)
        if demo is None or self._engine["state"] == "missing":
            return {"ok": False}
        with open(os.path.join(DEMOS_DIR, demo_id + ".txt"), "r", encoding="utf-8") as f:
            code = f.read()
        folder = os.path.join(RUNTIME_DIR, "demo")
        os.makedirs(folder, exist_ok=True)
        res = self._run_in(code, folder)
        if res.get("ok"):
            res["code"] = code
        return res

    def _run_in(self, code, folder):
        if self._engine["state"] == "missing":
            return {"ok": False, "error": "CPU engine not found. Start the GUI with --exe."}
        program = os.path.join(folder, "program.txt")
        result = os.path.join(folder, "result.txt")
        try:
            text = code.replace("\r\n", "\n").replace("\r", "\n")
            with open(program, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            if os.path.exists(result):
                os.remove(result)        # never show an old result by mistake
            subprocess.run(self._engine_command(), cwd=folder, timeout=5,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "The CPU engine did not finish within 5 seconds."}
        except OSError as e:
            return {"ok": False, "error": f"Could not run the CPU engine: {e}"}

        if not os.path.exists(result):
            return {"ok": False, "error": "The CPU engine did not write result.txt."}
        with open(result, "r", encoding="ascii", errors="replace") as f:
            raw = f.read()
        try:
            return {"ok": True, "result": parse_result(raw)}
        except ResultFormatError as e:
            return {"ok": False, "error": f"result.txt is not valid: {e}", "raw": raw}

    # ------------------------------------------------------------------ files
    def open_file(self):
        try:
            paths = self._window.create_file_dialog(OPEN_DIALOG, file_types=FILE_TYPES)
            if not paths:
                return {"ok": False, "cancelled": True}
            path = paths[0] if isinstance(paths, (list, tuple)) else paths
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                code = f.read()
            return {"ok": True, "path": path, "name": os.path.basename(path), "code": code}
        except Exception as e:           # never raise to JavaScript
            return {"ok": False, "error": f"Could not open the file: {e}"}

    def save_file(self, code, path=None):
        try:
            if not path:
                chosen = self._window.create_file_dialog(
                    SAVE_DIALOG, save_filename="program.txt", file_types=FILE_TYPES)
                if not chosen:
                    return {"ok": False, "cancelled": True}
                path = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(code.replace("\r\n", "\n"))
            return {"ok": True, "path": path, "name": os.path.basename(path)}
        except Exception as e:
            return {"ok": False, "error": f"Could not save the file: {e}"}

    # ------------------------------------------------------------------ last session
    # pywebview runs in private mode (no lasting browser storage), so the last
    # program is kept in runtime/session.json for the cover's "Continue" row.
    def save_session(self, session):
        try:
            data = {k: session.get(k) for k in ("code", "fileName", "filePath")}
            with open(os.path.join(RUNTIME_DIR, "session.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def load_session(self):
        try:
            with open(os.path.join(RUNTIME_DIR, "session.json"), "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"ok": bool(data.get("code", "").strip()), **data}
        except (OSError, ValueError):
            return {"ok": False}

    # ------------------------------------------------------------------ demos
    def list_demos(self):
        return [dict(d) for d in DEMOS]

    def load_demo(self, demo_id):
        demo = next((d for d in DEMOS if d["id"] == demo_id), None)
        if demo is None:
            return {"ok": False, "error": f"Unknown demo {demo_id!r}"}
        with open(os.path.join(DEMOS_DIR, demo_id + ".txt"), "r", encoding="utf-8") as f:
            return {"ok": True, "code": f.read(), "title": demo["title"]}
