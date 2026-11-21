"""
analysis_stats.py - the numbers on the §3 Analysis page, computed ONCE per result.

This is NOT CPU logic: CPU.exe already ran the program and wrote every step to
result.txt. Here we only COUNT and SUMMARISE that data (how many steps, which lines
ran how often, which jumps were taken, min/max of each register, ...).
The instruction name of a step is the first word of its source line (display only).
A label in front of it ("L1: ADD AX, CX") is skipped; a jump to a label is matched with
the line that label is on, read from the program text (CPU.exe already did the real
look-up; result.txt only has line numbers).

    compute(result, code) -> dict      result = result_parser.parse_result(...)
"""

import re

REGS = ["AX", "BX", "CX", "DX"]
JUMPS = ("JMP", "JZ", "JNZ", "JS", "JNS", "JC", "JNC")


LABEL_AT_START = re.compile(r"\s*([^\s,:]*):")


def _split_label(text):
    """("L1", " ADD AX, CX") for "L1: ADD AX, CX"; (None, text) without a label."""
    m = LABEL_AT_START.match(text)
    return (m.group(1).upper(), text[m.end():]) if m else (None, text)


def _words(text):
    return _split_label(text)[1].replace(",", " ").upper().split()


def _labels(lines):
    """NAME -> line number (the first definition, like CPU.asm)."""
    table = {}
    for no, text in enumerate(lines, 1):
        name = _split_label(text)[0]
        if name and name not in table:
            table[name] = no
    return table


def compute(result, code):
    lines = code.replace("\r\n", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()                                   # a final newline adds no line (like CPU.exe)
    labels = _labels(lines)
    steps = result["steps"]
    n = len(steps)
    end = result["end"]

    # register values per column: column 0 = start (all 0), column k = after step k
    values = {r: [0] + [s[r.lower()] for s in steps] for r in REGS}
    zf = [0] + [s["zf"] for s in steps]
    sf = [0] + [s["sf"] for s in steps]
    cf = [0] + [s["cf"] for s in steps]

    def line_text(no):
        return lines[no - 1].strip() if 1 <= no <= len(lines) else ""

    def landing(no):
        """Where execution really continues after going to line `no`: empty lines (and
        label-only lines) produce no STEP, so it is the first non-empty line from `no`
        on, or None when that runs past the last line."""
        while 1 <= no <= len(lines) and not _words(lines[no - 1]):
            no += 1
        return no if 1 <= no <= len(lines) else None

    def next_line(k):                                 # the line that ran after step k (1-based)
        if k < n:
            return steps[k]["line"]
        return end["value"] if end["type"] == "ERRSTOP" else None

    changed, taken_steps = [], []
    line_counts, arcs = {}, {}
    jumps_taken = jumps_not_taken = 0
    jump_kinds = set()
    for k in range(1, n + 1):
        st = steps[k - 1]
        words = _words(line_text(st["line"]))
        op = words[0] if words else ""
        changed.append([r for r in REGS if values[r][k] != values[r][k - 1]])
        line_counts[st["line"]] = line_counts.get(st["line"], 0) + 1
        if op in JUMPS:
            jump_kinds.add(op)
            target = None
            if len(words) > 1:
                target = int(words[1]) if words[1].lstrip("-").isdigit() else labels.get(words[1])
            if next_line(k) is None and end["type"] == "LOOP":
                continue                  # stopped by the 500-step guard: outcome not recorded
            goes_to = landing(target) if target is not None else None
            falls_to = landing(st["line"] + 1)
            # taken = it went where the target leads. If target and fall-through lead to
            # the same line (e.g. "JZ 5" on line 4), only JMP counts as taken.
            same = goes_to == falls_to
            if target is not None and next_line(k) == goes_to and (not same or op == "JMP"):
                jumps_taken += 1
                taken_steps.append(k)
                key = (st["line"], target)
                arcs[key] = arcs.get(key, 0) + 1
            else:
                jumps_not_taken += 1

    hottest = max(line_counts.items(), key=lambda kv: (kv[1], -kv[0])) if line_counts else None
    last_line = steps[-1]["line"] if steps else None
    stop_line = end["value"] if end["type"] == "ERRSTOP" else last_line

    return {
        "steps": n,
        "end": end,
        "stop_line": stop_line,
        "lines_total": sum(1 for t in lines if _words(t)),     # a label alone is an empty line
        "lines_executed": len(line_counts),
        "jumps_taken": jumps_taken,
        "jumps_not_taken": jumps_not_taken,
        "jump_kinds": sorted(jump_kinds),
        "zf_transitions": sum(1 for k in range(1, n + 1) if zf[k] != zf[k - 1]),
        "sf_transitions": sum(1 for k in range(1, n + 1) if sf[k] != sf[k - 1]),
        "cf_transitions": sum(1 for k in range(1, n + 1) if cf[k] != cf[k - 1]),
        "errors": result["errors"],
        "ranges": {r: {"min": min(values[r]), "max": max(values[r]), "final": values[r][-1]} for r in REGS},
        "values": values,
        "zf": zf,
        "sf": sf,
        "cf": cf,
        "changed": changed,
        "taken_steps": taken_steps,
        "line_counts": {str(k): v for k, v in sorted(line_counts.items())},
        "hottest": {"line": hottest[0], "count": hottest[1]} if hottest else None,
        "arcs": [{"from": f, "to": t, "count": c} for (f, t), c in sorted(arcs.items())],
        "listing": lines,
    }
