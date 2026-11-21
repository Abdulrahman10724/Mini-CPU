"""
Tests for gui/result_parser.py.   Run:  python gui/tests/test_result_parser.py

1. Every tests/*.expected.txt (the source of truth) must parse, with a sane structure.
2. Malformed result files must raise ResultFormatError.
"""

import glob
import os
import sys
import unittest

GUI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(GUI_DIR)
sys.path.insert(0, GUI_DIR)

from result_parser import ResultFormatError, parse_result  # noqa: E402

EXPECTED_FILES = sorted(glob.glob(os.path.join(ROOT_DIR, "tests", "*.expected.txt")))


class ExpectedFilesParse(unittest.TestCase):
    def test_found_all_expected_files(self):
        self.assertGreaterEqual(len(EXPECTED_FILES), 25)

    def test_every_expected_file(self):
        for path in EXPECTED_FILES:
            with self.subTest(file=os.path.basename(path)):
                with open(path, "r") as f:
                    r = parse_result(f.read())
                self.assertIn(r["status"], ("OK", "ERR"))
                self.assertEqual(r["status"] == "ERR", len(r["errors"]) > 0)
                self.assertIn(r["end"]["type"], ("HALT", "NOHLT", "ERRSTOP", "LOOP"))
                for i, step in enumerate(r["steps"], 1):
                    self.assertEqual(step["n"], i)
                    self.assertEqual(set(step), {"n", "line", "ax", "bx", "cx", "dx", "zf"})
                if r["end"]["type"] in ("HALT", "NOHLT", "LOOP"):
                    self.assertEqual(r["end"]["value"], len(r["steps"]))

    def test_known_values(self):
        with open(os.path.join(ROOT_DIR, "tests", "05_jnz_loop_sum.expected.txt")) as f:
            r = parse_result(f.read())
        self.assertEqual(len(r["steps"]), 18)
        self.assertEqual(r["steps"][5], {"n": 6, "line": 3, "ax": 9, "bx": 0, "cx": 4, "dx": 0, "zf": 0})
        self.assertEqual(r["end"], {"type": "HALT", "value": 18})
        with open(os.path.join(ROOT_DIR, "tests", "07_negative.expected.txt")) as f:
            self.assertEqual(parse_result(f.read())["steps"][2]["ax"], -10)

    def test_crlf_is_accepted(self):
        r = parse_result("STATUS OK\r\nEND NOHLT 0\r\n")
        self.assertEqual(r["end"], {"type": "NOHLT", "value": 0})


class MalformedInputsRaise(unittest.TestCase):
    BAD = {
        "empty file": "",
        "no STATUS first": "END HALT 0\n",
        "bad STATUS value": "STATUS MAYBE\nEND HALT 0\n",
        "missing END": "STATUS OK\nSTEP 1 1 0 0 0 0 0\n",
        "text after END": "STATUS OK\nEND HALT 0\nSTEP 1 1 0 0 0 0 0\n",
        "ERR after STEP": "STATUS ERR\nSTEP 1 1 0 0 0 0 0\nERR 2 1\nEND ERRSTOP 2\n",
        "STEP too short": "STATUS OK\nSTEP 1 1 0 0 0 0\nEND HALT 1\n",
        "STEP not a number": "STATUS OK\nSTEP 1 1 X 0 0 0 0\nEND HALT 1\n",
        "step numbers skip": "STATUS OK\nSTEP 2 1 0 0 0 0 0\nEND HALT 1\n",
        "ZF not 0/1": "STATUS OK\nSTEP 1 1 0 0 0 0 2\nEND HALT 1\n",
        "unknown END type": "STATUS OK\nEND STOP 0\n",
        "double space": "STATUS OK\nEND  HALT 0\n",
        "unknown keyword": "STATUS OK\nFOO 1\nEND HALT 0\n",
        "STATUS ERR without ERR": "STATUS ERR\nEND HALT 0\n",
        "ERR lines not ascending": "STATUS ERR\nERR 3 1\nERR 2 1\nEND ERRSTOP 2\n",
        "unknown error code": "STATUS ERR\nERR 1 13\nEND ERRSTOP 1\n",
        "two STATUS lines": "STATUS OK\nSTATUS OK\nEND HALT 0\n",
    }

    def test_malformed(self):
        for name, text in self.BAD.items():
            with self.subTest(case=name):
                with self.assertRaises(ResultFormatError):
                    parse_result(text)


if __name__ == "__main__":
    unittest.main(verbosity=1)
