"""
mock_cpu.py - DEVELOPMENT ONLY.

This file exists only so the GUI can be developed and screenshotted on machines
without the real engine (for example Linux, where MASM cannot run). The REAL CPU
engine of this project is asm/CPU.asm (built to CPU.exe). The GUI uses this mock only
when it is started with --mock, never as an automatic fallback, and then shows a
"MOCK ENGINE" badge.

It follows CONTRACT.md + tests/README.md and must produce byte-identical result.txt
files, so it passes the same 25 tests:  python tests/run_tests.py --mock

Usage (like CPU.exe): run it in a folder that contains program.txt; it writes result.txt.
"""

import os
import re
import sys

OPS = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT"]
NEEDED = [2, 2, 2, 2, 1, 1, 1, 1, 1, 0]          # operands per opcode
REGS = ["AX", "BX", "CX", "DX"]


def to_int32(value):
    """Wrap an integer to signed 32 bits (like real ADD/SUB)."""
    value &= 0xFFFFFFFF
    return value - 2**32 if value >= 2**31 else value


def split_lines(data):
    """Same rules as SplitLines: LF ends a line, CR ignored, TAB -> space, max 63 chars."""
    lines, i, too_many = [], 0, False
    while i < len(data):
        if len(lines) == 50:
            too_many = True
            break
        text = ""
        while i < len(data):
            c = data[i]
            i += 1
            if c == 10:
                break
            if c == 13:
                continue
            if c == 9:
                c = 32
            if len(text) < 63:
                text += chr(c)
        lines.append(text.upper())
    return lines, too_many


def tokenize(line):
    """Words split by spaces/commas; first 4 kept (15 chars max), all counted."""
    words = [w for w in re.split(r"[ ,]+", line) if w]
    return [w[:15] for w in words[:4]], len(words)


def str_to_int(word):
    """Optional '-', then digits only, must fit in signed 32 bits. None if invalid."""
    if not re.fullmatch(r"-?[0-9]+", word):
        return None
    value = int(word)
    return value if -2**31 <= value <= 2**31 - 1 else None


def looks_like_number(word):
    return word[0] in "-+0123456789"


def parse_line(line, line_count):
    """Return None (empty), an int error code, or (op, dst, src_type, src)."""
    tokens, count = tokenize(line)
    if count == 0:
        return None
    if tokens[0] not in OPS:
        return 1
    op = OPS.index(tokens[0]) + 1
    needed = NEEDED[op - 1]
    if count - 1 < needed:
        return 3
    dst, src_type, src = 0, 0, 0
    if 7 <= op <= 9:                                   # jumps
        target = str_to_int(tokens[1])
        if target is None:
            return 5
        if not 1 <= target <= line_count:
            return 6
        src_type, src = 2, target
    elif op <= 6:                                      # first operand = register
        if tokens[1] not in REGS:
            return 8 if looks_like_number(tokens[1]) else 2
        dst = REGS.index(tokens[1])
        if op <= 4:                                    # second operand
            word = tokens[2]
            if word in REGS:
                src_type, src = 1, REGS.index(word)
            elif not looks_like_number(word):
                return 2
            else:
                src = str_to_int(word)
                if src is None:
                    return 5
                src_type = 2
    if count - 1 > needed:
        return 4
    return (op, dst, src_type, src)


def simulate(program_path):
    """Return the full result.txt text for program_path."""
    if not os.path.exists(program_path):
        return "STATUS ERR\nERR 0 9\nEND ERRSTOP 0\n"
    with open(program_path, "rb") as f:
        lines, too_many = split_lines(f.read()[:4096])
    n = len(lines)
    errors, program = {}, []
    for number, text in enumerate(lines, 1):
        parsed = parse_line(text, n)
        if isinstance(parsed, int):
            errors[number] = parsed
            parsed = None
        program.append(parsed)
    if too_many:
        errors[51] = 7

    out = ["STATUS ERR" if errors else "STATUS OK"]
    out += [f"ERR {line} {code}" for line, code in sorted(errors.items())]

    regs, zf, pc, steps = [0, 0, 0, 0], 0, 1, 0
    while True:
        if pc > n:
            end = "ERRSTOP 51" if too_many else f"NOHLT {steps}"
            break
        if pc in errors:
            end = f"ERRSTOP {pc}"
            break
        inst = program[pc - 1]
        if inst is None:                               # empty line
            pc += 1
            continue
        op, dst, src_type, src = inst
        value = regs[src] if src_type == 1 else src
        next_pc = pc + 1
        if op == 1:
            regs[dst] = value
        elif op in (2, 3, 5, 6):
            delta = {2: value, 3: -value, 5: 1, 6: -1}[op]
            regs[dst] = to_int32(regs[dst] + delta)
            zf = int(regs[dst] == 0)
        elif op == 4:
            zf = int(regs[dst] == value)
        elif op == 7 or (op == 8 and zf == 1) or (op == 9 and zf == 0):
            next_pc = src
        steps += 1
        out.append(f"STEP {steps} {pc} {regs[0]} {regs[1]} {regs[2]} {regs[3]} {zf}")
        if op == 10:
            end = f"HALT {steps}"
            break
        if steps >= 500:
            end = f"LOOP {steps}"
            break
        pc = next_pc
    out.append("END " + end)
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    with open("result.txt", "w", newline="\n") as f:
        f.write(simulate("program.txt"))
