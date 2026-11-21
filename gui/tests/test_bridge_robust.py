"""
Robustness tests for gui/bridge.py: bad files and a misbehaving CPU engine must give a
clear {"ok": False, "error": ...} message, never an exception or a stuck GUI.

    python gui/tests/test_bridge_robust.py

Fake engines are small Python scripts (so this runs on Windows and Linux); the timeout
test waits for the 5-second limit.
"""

import os
import sys
import tempfile
import unittest

GUI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, GUI_DIR)

import bridge  # noqa: E402
from bridge import Api, read_program_file  # noqa: E402


class FakeWindow:
    """Stands in for the pywebview window: the "file dialog" returns a fixed path."""
    def __init__(self, path):
        self.path = path

    def create_file_dialog(self, *args, **kwargs):
        return [self.path]


def fake_engine(folder, body):
    """Write a fake CPU engine (a Python script) and return the command to run it."""
    path = os.path.join(folder, "fake_cpu.py")
    with open(path, "w") as f:
        f.write(body)
    return [sys.executable, path]


class OpenFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def file(self, name, data):
        path = os.path.join(self.tmp, name)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def open(self, path):
        api = Api({"state": "mock", "path": ""})
        api._window = FakeWindow(path)
        return api.open_file()

    def test_normal_program(self):
        res = self.open(self.file("p.txt", b"MOV AX, 5\nHLT\n"))
        self.assertTrue(res["ok"])
        self.assertEqual(res["code"], "MOV AX, 5\nHLT\n")

    def test_bom_is_dropped(self):
        res = self.open(self.file("bom.txt", b"\xef\xbb\xbfHLT\n"))
        self.assertEqual(res["code"], "HLT\n")

    def test_not_txt(self):
        res = self.open(self.file("picture.png", b"\x89PNG"))
        self.assertFalse(res["ok"])
        self.assertIn("not a .txt program", res["error"])

    def test_binary(self):
        res = self.open(self.file("data.txt", b"MOV\x00\x01\x02"))
        self.assertFalse(res["ok"])
        self.assertIn("binary", res["error"])

    def test_very_large(self):
        res = self.open(self.file("big.txt", b"INC AX\n" * 20000))     # 140 KB
        self.assertFalse(res["ok"])
        self.assertIn("too large", res["error"])

    def test_10kb_is_accepted(self):                 # under the 64 KB limit: CPU.exe reports error 7
        code, error = read_program_file(self.file("ten.txt", b"INC AX\n" * 1500))
        self.assertIsNone(error)

    def test_missing_file(self):
        res = self.open(os.path.join(self.tmp, "gone.txt"))
        self.assertFalse(res["ok"])
        self.assertIn("Could not open", res["error"])


class BadEngine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.api = Api({"state": "ready", "path": os.path.join(self.tmp, "CPU.exe")})

    def run_with(self, body):
        self.api._engine_command = lambda: fake_engine(self.tmp, body)
        return self.api._run_in("MOV AX, 1\nHLT\n", self.tmp)

    def test_no_result_file(self):
        res = self.run_with("pass\n")
        self.assertFalse(res["ok"])
        self.assertIn("did not write result.txt", res["error"])

    def test_malformed_result(self):
        res = self.run_with("open('result.txt', 'w').write('HELLO\\n')\n")
        self.assertFalse(res["ok"])
        self.assertIn("not valid", res["error"])

    def test_binary_result(self):
        res = self.run_with("open('result.txt', 'wb').write(bytes(range(256)))\n")
        self.assertFalse(res["ok"])
        self.assertIn("not valid", res["error"])

    def test_engine_crashes(self):                    # exits with an error, no result.txt
        res = self.run_with("raise SystemExit(3)\n")
        self.assertFalse(res["ok"])
        self.assertIn("did not write result.txt", res["error"])

    def test_engine_hangs(self):                      # killed after 5 seconds
        res = self.run_with("import time\ntime.sleep(30)\n")
        self.assertFalse(res["ok"])
        self.assertIn("did not finish", res["error"])

    def test_exe_deleted_while_running(self):         # the real command, but the file is gone
        res = self.api._run_in("HLT\n", self.tmp)
        self.assertFalse(res["ok"])
        self.assertEqual(res["engine"]["state"], "missing")
        self.assertEqual(self.api.engine_status()["state"], "missing")
        again = self.api._run_in("HLT\n", self.tmp)  # later runs: clear message, no exception
        self.assertIn("not found", again["error"])

    def test_runtime_folder_deleted(self):
        self.api._engine_command = lambda: [sys.executable, bridge.MOCK_CPU]
        folder = os.path.join(self.tmp, "gone", "runtime")
        res = self.api._run_in("HLT\n", folder)
        self.assertTrue(res["ok"])


class EmptyRuns(unittest.TestCase):
    def test_empty_program_and_analysis(self):
        api = Api({"state": "mock", "path": ""})
        self.assertEqual(api.analysis(), {"ok": False})       # Analysis before any run
        res = api.run("")
        self.assertTrue(res["ok"])
        self.assertEqual(res["result"]["end"], {"type": "NOHLT", "value": 0})
        stats = api.analysis()["stats"]
        self.assertEqual((stats["steps"], stats["hottest"], stats["arcs"]), (0, None, []))

    def test_unknown_demo(self):
        api = Api({"state": "mock", "path": ""})
        self.assertEqual(api.run_demo("99_nope"), {"ok": False})


if __name__ == "__main__":
    unittest.main(verbosity=1)
