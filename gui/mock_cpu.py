"""
mock_cpu.py - DEVELOPMENT ONLY.

This file exists only so the GUI can be developed and screenshotted on machines
without the real engine (for example Linux, where MASM cannot run). The REAL CPU
engine of this project is asm/CPU.asm (built to CPU.exe). The GUI uses this mock only
when it is started with --mock, never as an automatic fallback, and then shows a
"MOCK ENGINE" badge.

It follows CONTRACT.md + tests/README.md and must produce byte-identical result.txt
files, so it passes the same tests:  python tests/run_tests.py --mock

Usage (like CPU.exe): run it in a folder that contains program.txt; it writes result.txt.
"""

import os
import re
import sys

OPS = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT",
       "JS", "JNS", "JC", "JNC"]
NEEDED = [2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1]   # operands per opcode
JUMP_OPS = (7, 8, 9, 11, 12, 13, 14)                 # JMP JZ JNZ JS JNS JC JNC
MASK = 0xFFFFFFFF
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


def valid_label(name):
    """1-12 chars, letters/digits/_, starts with a letter, not an opcode or register."""
    return (re.fullmatch(r"[A-Z][A-Z0-9_]{0,11}", name) is not None
            and name not in OPS and name not in REGS)


def collect_labels(lines):
    """PASS 1 (like CollectLabels): find "NAME:" at the start of each line, erase it from
    the line, and build the symbol table {name: line}. Returns (lines, table, errors)."""
    table, errors, out = {}, {}, []
    for number, text in enumerate(lines, 1):
        m = re.match(r" *([^ ,:]*):", text)          # first word ends with ':'
        if not m:
            out.append(text)
            continue
        name, rest = m.group(1), text[m.end():]
        out.append(" " * m.end() + rest)              # the label is erased (spaces)
        if not valid_label(name):
            errors[number] = 12
        elif name in table:
            errors[number] = 11                       # duplicate: error on the 2nd one
        else:
            table[name] = number
            if ":" in rest:
                errors[number] = 12                   # a second label on the same line
    return out, table, errors


def parse_line(line, line_count, labels):
    """PASS 2. Return None (empty), an int error code, or (op, dst, src_type, src)."""
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
    if op in JUMP_OPS:                                 # jumps
        if not looks_like_number(tokens[1]):              # a label name
            if tokens[1] not in labels:
                return 10
            target = labels[tokens[1]]
        else:
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
    lines, labels, errors = collect_labels(lines)       # pass 1
    program = []
    for number, text in enumerate(lines, 1):            # pass 2
        if number in errors:                            # bad label: line not parsed
            program.append(None)
            continue
        parsed = parse_line(text, n, labels)
        if isinstance(parsed, int):
            errors[number] = parsed
            parsed = None
        program.append(parsed)
    if too_many:
        errors[51] = 7

    out = ["STATUS ERR" if errors else "STATUS OK"]
    out += [f"ERR {line} {code}" for line, code in sorted(errors.items())]

    regs, zf, sf, cf, pc, steps = [0, 0, 0, 0], 0, 0, 0, 1, 0
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
        elif op in (2, 3, 4):                          # ADD, SUB, CMP: ZF, SF and CF
            a, b = regs[dst] & MASK, value & MASK      # the 32-bit patterns (unsigned)
            if op == 2:
                result, cf = to_int32(a + b), int(a + b > MASK)    # carry out of bit 31
            else:
                result, cf = to_int32(a - b), int(a < b)           # borrow (unsigned a < b)
            sf = int(result < 0)                                    # bit 31 of the result
            if op == 4:
                zf = int(regs[dst] == value)                        # CMP: registers unchanged
            else:
                regs[dst] = result
                zf = int(result == 0)
        elif op in (5, 6):                             # INC, DEC: ZF and SF, CF unchanged
            regs[dst] = to_int32(regs[dst] + (1 if op == 5 else -1))
            zf = int(regs[dst] == 0)
            sf = int(regs[dst] < 0)
        elif (op == 7 or (op == 8 and zf == 1) or (op == 9 and zf == 0)
              or (op == 11 and sf == 1) or (op == 12 and sf == 0)
              or (op == 13 and cf == 1) or (op == 14 and cf == 0)):
            next_pc = src
        steps += 1
        out.append(f"STEP {steps} {pc} {regs[0]} {regs[1]} {regs[2]} {regs[3]} {zf} {sf} {cf}")
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
