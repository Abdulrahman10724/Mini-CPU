"""
analysis_stats.py - the numbers on the §3 Analysis page, computed ONCE per result.

This is NOT CPU logic: CPU.exe already ran the program and wrote every step to
result.txt. Here we only COUNT and SUMMARISE that data (how many steps, which lines
ran how often, which jumps were taken, min/max of each register, ...).
The instruction name of a step is the first word of its source line (display only).

    compute(result, code) -> dict      result = result_parser.parse_result(...)
"""

REGS = ["AX", "BX", "CX", "DX"]
JUMPS = ("JMP", "JZ", "JNZ")
CATEGORY = {"MOV": "data", "ADD": "arith", "SUB": "arith", "INC": "arith", "DEC": "arith",
            "CMP": "compare", "JMP": "control", "JZ": "control", "JNZ": "control", "HLT": "control"}


def _words(text):
    return text.replace(",", " ").upper().split()


def compute(result, code):
    lines = code.replace("\r\n", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()                                   # a final newline adds no line (like CPU.exe)
    steps = result["steps"]
    n = len(steps)
    end = result["end"]

    # register values per column: column 0 = start (all 0), column k = after step k
    values = {r: [0] + [s[r.lower()] for s in steps] for r in REGS}
    zf = [0] + [s["zf"] for s in steps]

    def line_text(no):
        return lines[no - 1].strip() if 1 <= no <= len(lines) else ""

    def next_line(k):                                 # the line that ran after step k (1-based)
        if k < n:
            return steps[k]["line"]
        return end["value"] if end["type"] == "ERRSTOP" else None

    ops, changed, taken_steps = [], [], []
    line_counts, mix, arcs = {}, {}, {}
    jumps_taken = jumps_not_taken = 0
    jump_kinds = set()
    for k in range(1, n + 1):
        st = steps[k - 1]
        words = _words(line_text(st["line"]))
        op = words[0] if words else ""
        ops.append(op)
        changed.append([r for r in REGS if values[r][k] != values[r][k - 1]])
        line_counts[st["line"]] = line_counts.get(st["line"], 0) + 1
        mix[op] = mix.get(op, 0) + 1
        if op in JUMPS:
            jump_kinds.add(op)
            target = int(words[1]) if len(words) > 1 and words[1].lstrip("-").isdigit() else None
            if next_line(k) is None and end["type"] == "LOOP":
                continue                  # stopped by the 500-step guard: outcome not recorded
            if target is not None and next_line(k) == target:      # it went to the target
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
        "lines_total": sum(1 for t in lines if t.strip()),
        "lines_executed": len(line_counts),
        "jumps_taken": jumps_taken,
        "jumps_not_taken": jumps_not_taken,
        "jump_kinds": sorted(jump_kinds),
        "zf_transitions": sum(1 for k in range(1, n + 1) if zf[k] != zf[k - 1]),
        "errors": result["errors"],
        "ranges": {r: {"min": min(values[r]), "max": max(values[r]), "final": values[r][-1]} for r in REGS},
        "values": values,
        "zf": zf,
        "ops": ops,
        "changed": changed,
        "taken_steps": taken_steps,
        "line_counts": {str(k): v for k, v in sorted(line_counts.items())},
        "hottest": {"line": hottest[0], "count": hottest[1]} if hottest else None,
        "arcs": [{"from": f, "to": t, "count": c} for (f, t), c in sorted(arcs.items())],
        "mix": [{"op": op, "count": c, "category": CATEGORY.get(op, "data")}
                for op, c in sorted(mix.items(), key=lambda kv: (-kv[1], kv[0]))],
        "listing": lines,
    }
