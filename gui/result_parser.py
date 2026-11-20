"""
result_parser.py - read result.txt (written by CPU.exe) into a Python dict.

This only READS the file format from CONTRACT.md. It does not check programs or
run them: every value comes from CPU.exe. It is strict: if the file breaks the
contract (wrong order, wrong number of fields, bad numbers) it raises
ResultFormatError, so a bug in the engine is never shown as a valid result.

Returned dict:
{
  "status": "OK" | "ERR",
  "errors": [{"line": int, "code": int}],
  "steps":  [{"n", "line", "ax", "bx", "cx", "dx", "zf"}],
  "end":    {"type": "HALT" | "NOHLT" | "ERRSTOP" | "LOOP", "value": int}
}
"""

import re

END_TYPES = ("HALT", "NOHLT", "ERRSTOP", "LOOP")
INT_PATTERN = re.compile(r"-?[0-9]+")


class ResultFormatError(ValueError):
    """result.txt does not follow CONTRACT.md."""


def _int(text, line_no, what):
    """Convert one field to int, or raise a clear error."""
    if not INT_PATTERN.fullmatch(text):
        raise ResultFormatError(f"line {line_no}: {what} is not a number: {text!r}")
    return int(text)


def parse_result(text):
    """Parse the full text of result.txt. Raises ResultFormatError if malformed."""
    lines = text.replace("\r\n", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()                         # the file ends with a newline
    if not lines:
        raise ResultFormatError("result.txt is empty")

    result = {"status": None, "errors": [], "steps": [], "end": None}
    section = 0          # 0 = expect STATUS, 1 = ERR lines, 2 = STEP lines, 3 = after END

    for line_no, line in enumerate(lines, 1):
        fields = line.split(" ")
        if "" in fields:
            raise ResultFormatError(f"line {line_no}: fields must be separated by one space")
        keyword = fields[0]

        if section == 3:
            raise ResultFormatError(f"line {line_no}: text after the END line")

        if keyword == "STATUS":
            if section != 0 or len(fields) != 2 or fields[1] not in ("OK", "ERR"):
                raise ResultFormatError(f"line {line_no}: bad or misplaced STATUS line")
            result["status"] = fields[1]
            section = 1
        elif section == 0:
            raise ResultFormatError("the first line must be STATUS")

        elif keyword == "ERR":
            if section != 1 or len(fields) != 3:
                raise ResultFormatError(f"line {line_no}: bad or misplaced ERR line")
            err = {"line": _int(fields[1], line_no, "line"),
                   "code": _int(fields[2], line_no, "error code")}
            if not 1 <= err["code"] <= 9:
                raise ResultFormatError(f"line {line_no}: unknown error code {err['code']}")
            if result["errors"] and err["line"] <= result["errors"][-1]["line"]:
                raise ResultFormatError(f"line {line_no}: ERR lines must be in ascending order")
            result["errors"].append(err)

        elif keyword == "STEP":
            if len(fields) != 8:
                raise ResultFormatError(f"line {line_no}: STEP needs 7 numbers")
            section = 2
            nums = [_int(f, line_no, "STEP field") for f in fields[1:]]
            step = dict(zip(("n", "line", "ax", "bx", "cx", "dx", "zf"), nums))
            if step["n"] != len(result["steps"]) + 1:
                raise ResultFormatError(f"line {line_no}: step numbers must count 1, 2, 3, ...")
            if step["zf"] not in (0, 1):
                raise ResultFormatError(f"line {line_no}: ZF must be 0 or 1")
            result["steps"].append(step)

        elif keyword == "END":
            if len(fields) != 3 or fields[1] not in END_TYPES:
                raise ResultFormatError(f"line {line_no}: bad END line")
            result["end"] = {"type": fields[1], "value": _int(fields[2], line_no, "END value")}
            section = 3

        else:
            raise ResultFormatError(f"line {line_no}: unknown keyword {keyword!r}")

    if result["end"] is None:
        raise ResultFormatError("missing END line")
    if (result["status"] == "ERR") != bool(result["errors"]):
        raise ResultFormatError("STATUS does not match the ERR lines")
    return result
