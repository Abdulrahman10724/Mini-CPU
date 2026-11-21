"""
Tests for gui/analysis_stats.py, using the tests/*.txt programs and their
tests/*.expected.txt results (the source of truth).

    python gui/tests/test_analysis_stats.py
"""

import os
import sys
import unittest

GUI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(GUI_DIR)
sys.path.insert(0, GUI_DIR)

from analysis_stats import compute  # noqa: E402
from result_parser import parse_result  # noqa: E402


def stats_for(name):
    with open(os.path.join(ROOT_DIR, "tests", name + ".txt"), newline="") as f:
        code = f.read()
    with open(os.path.join(ROOT_DIR, "tests", name + ".expected.txt")) as f:
        result = parse_result(f.read())
    return compute(result, code)


class AnalysisStats(unittest.TestCase):
    def test_loop_sum(self):                       # tests/05_jnz_loop_sum
        s = stats_for("05_jnz_loop_sum")
        self.assertEqual(s["steps"], 18)
        self.assertEqual(s["jumps_taken"], 4)
        self.assertEqual(s["jumps_not_taken"], 1)
        self.assertEqual(s["line_counts"]["3"], 5)
        self.assertEqual(s["hottest"]["count"], 5)
        self.assertEqual(s["arcs"], [{"from": 5, "to": 3, "count": 4}])
        self.assertEqual(s["ranges"]["AX"], {"min": 0, "max": 15, "final": 15})
        self.assertEqual(s["zf_transitions"], 1)
        self.assertEqual(s["lines_total"], 6)
        self.assertEqual(s["lines_executed"], 6)
        self.assertEqual(s["stop_line"], 6)

    def test_compare_jump_taken(self):             # contract example: CMP + JZ taken
        s = stats_for("03_cmp_jz_taken")
        self.assertEqual((s["jumps_taken"], s["jumps_not_taken"]), (1, 0))
        self.assertEqual(s["arcs"], [{"from": 5, "to": 7, "count": 1}])
        self.assertEqual(s["lines_executed"], 6)    # line 6 was skipped

    def test_jz_not_taken(self):
        s = stats_for("04_cmp_jz_not_taken")
        self.assertEqual((s["jumps_taken"], s["jumps_not_taken"]), (0, 1))
        self.assertEqual(s["arcs"], [])

    def test_jmp_over_empty_line(self):            # JMP 4 lands on an empty line
        s = stats_for("06_jmp_empty_lines")
        self.assertEqual(s["jumps_taken"], 2)       # JMP 4 (lands on line 5) and JMP 8
        self.assertEqual(s["arcs"], [{"from": 2, "to": 4, "count": 1}, {"from": 6, "to": 8, "count": 1}])
        self.assertEqual(s["lines_total"], 7)       # the empty line does not count

    def test_negative_ranges(self):
        s = stats_for("07_negative")
        self.assertEqual(s["ranges"]["AX"]["min"], -10)
        self.assertEqual(s["ranges"]["DX"], {"min": -1, "max": 0, "final": -1})

    def test_errors_and_errstop(self):
        s = stats_for("09_errors_1_to_4")
        self.assertEqual(s["end"]["type"], "ERRSTOP")
        self.assertEqual(s["stop_line"], 2)
        self.assertEqual([e["code"] for e in s["errors"]], [1, 2, 3, 4])

    def test_infinite_loop(self):
        s = stats_for("16_infinite_loop")
        self.assertEqual(s["steps"], 500)
        # step 500 is a JMP, but the 500-step guard stopped the CPU there, so result.txt
        # does not say where it went: it is counted neither taken nor not taken
        self.assertEqual((s["jumps_taken"], s["jumps_not_taken"]), (249, 0))
        self.assertEqual(s["line_counts"], {"1": 250, "2": 250})
        self.assertEqual(s["ranges"]["AX"]["max"], 250)

    def test_labels_like_line_numbers(self):       # tests/26 = tests/05 written with a label
        a, b = stats_for("05_jnz_loop_sum"), stats_for("26_labels_loop")
        for key in ("steps", "jumps_taken", "jumps_not_taken", "arcs", "line_counts", "hottest"):
            self.assertEqual(a[key], b[key], key)

    def test_label_alone_on_a_line(self):          # tests/28: LOOP: and END: alone
        s = stats_for("28_label_alone_line")
        self.assertEqual(s["lines_total"], 5)       # the two label-only lines are empty
        self.assertEqual(s["arcs"], [{"from": 4, "to": 2, "count": 2}, {"from": 5, "to": 7, "count": 1}])
        self.assertEqual(s["jumps_taken"], 3)       # 2x JNZ LOOP + JMP END (to line 7)

    def test_empty_program(self):
        s = stats_for("14_empty_file")
        self.assertEqual(s["steps"], 0)
        self.assertIsNone(s["hottest"])
        self.assertEqual(s["arcs"], [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
