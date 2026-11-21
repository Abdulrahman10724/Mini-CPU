# Mini CPU Simulator — File Contract (LOCKED)

The Python GUI and the assembly CPU (`CPU.exe`) communicate **only** through two text files
in the same working directory. Do not change this format.

```
Python GUI --writes--> program.txt --reads--> CPU.exe
Python GUI <--reads--- result.txt <--writes-- CPU.exe
```

---

## 1. `program.txt` (written by GUI, read by CPU.exe)

One instruction per line. Line numbers start at 1.

```
MOV AX, 5
MOV BX, 3
ADD AX, BX
CMP AX, 8
JZ 7
MOV CX, 1
HLT
```

Rules:
- Case-insensitive (`mov ax, 5` is valid). Parser converts to uppercase.
- Comma and space are both separators.
- Empty lines are skipped but still counted as line numbers.
- Maximum 50 lines.
- Line endings may be CRLF or LF.

Registers: `AX`, `BX`, `CX`, `DX` only (index 0, 1, 2, 3). Values are signed 32-bit.
Flags: `ZF` (zero), `SF` (sign), `CF` (carry). All start at 0. See appendix B.

| Instruction | Format | Effect |
|---|---|---|
| MOV | `MOV reg, reg/num` | reg = src |
| ADD | `ADD reg, reg/num` | reg = reg + src, update ZF, SF, CF |
| SUB | `SUB reg, reg/num` | reg = reg - src, update ZF, SF, CF |
| CMP | `CMP reg, reg/num` | ZF = 1 if reg == src else 0; SF, CF like SUB (no register change) |
| INC | `INC reg` | reg = reg + 1, update ZF, SF (CF unchanged) |
| DEC | `DEC reg` | reg = reg - 1, update ZF, SF (CF unchanged) |
| JMP | `JMP line` | PC = line |
| JZ | `JZ line` | if ZF = 1 then PC = line |
| JNZ | `JNZ line` | if ZF = 0 then PC = line |
| JS | `JS line` | if SF = 1 then PC = line |
| JNS | `JNS line` | if SF = 0 then PC = line |
| JC | `JC line` | if CF = 1 then PC = line |
| JNC | `JNC line` | if CF = 0 then PC = line |
| HLT | `HLT` | stop |

Numbers may be negative (`MOV AX, -3`). Jump targets are line numbers (1..total lines).

---

## 2. `result.txt` (written by CPU.exe, read by GUI)

Every line starts with a keyword. Fields are separated by a single space. Order:

1. Exactly one `STATUS` line
2. Zero or more `ERR` lines (ascending line number)
3. Zero or more `STEP` lines (execution order)
4. Exactly one `END` line

### Line types

```
STATUS OK|ERR
ERR   <lineNo> <errorCode>
STEP  <stepNo> <lineNo> <AX> <BX> <CX> <DX> <ZF> <SF> <CF>
END   HALT|NOHLT|ERRSTOP|LOOP <number>
```

- `STATUS OK` if no parse errors, `STATUS ERR` if at least one.
- `STEP` is written **after** the instruction on `lineNo` executes; register and flag values are the state after execution.
- Execution starts at line 1 even if errors exist, and stops when it reaches an error line.

### END types

| Line | Meaning |
|---|---|
| `END HALT n` | HLT executed; n = total steps |
| `END NOHLT n` | Ran past last line without HLT; n = total steps (normal during live typing) |
| `END ERRSTOP line` | Stopped on reaching an error line |
| `END LOOP n` | Forced stop at 500 steps (infinite loop guard) |

### Error codes (CPU.exe writes number only; GUI maps to message)

| Code | Message |
|---|---|
| 1 | Unknown instruction |
| 2 | Invalid register |
| 3 | Missing operand |
| 4 | Extra operand |
| 5 | Invalid number |
| 6 | Jump target out of range |
| 7 | Too many lines (max 50) |
| 8 | First operand must be a register |
| 9 | program.txt not found (written as `ERR 0 9`, then `END ERRSTOP 0`) |

---

## 3. Examples

### All valid (program above)
```
STATUS OK
STEP 1 1 5 0 0 0 0 0 0
STEP 2 2 5 3 0 0 0 0 0
STEP 3 3 8 3 0 0 0 0 0
STEP 4 4 8 3 0 0 1 0 0
STEP 5 5 8 3 0 0 1 0 0
STEP 6 7 8 3 0 0 1 0 0
END HALT 6
```

### With errors
program.txt:
```
MOV AX, 5
MOV BX, 3
MOVV CX, 1
JZ 99
HLT
```
result.txt:
```
STATUS ERR
ERR 3 1
ERR 4 6
STEP 1 1 5 0 0 0 0 0 0
STEP 2 2 5 3 0 0 0 0 0
END ERRSTOP 3
```

---

## Appendix A — Labels (added later; everything above is unchanged)

A line may start with a label `NAME:`. A jump may use the label instead of a line number:

```
MOV AX, 0
MOV CX, 5
L1: ADD AX, CX
DEC CX
JNZ L1
HLT
```

- The label belongs to the line it is on. `JNZ L1` jumps to line 3, exactly like `JNZ 3`.
  A label alone on a line (`L1:`) is an empty line.
- Names: 1–12 characters, letters / digits / `_`, starting with a letter, case-insensitive,
  not an instruction or register name. One label per line.
- Labels can be used only with jumps (`JMP`, `JZ`, `JNZ`, `JS`, `JNS`, `JC`, `JNC`). Jumps still accept line numbers.
- `result.txt` is unchanged: STEP and ERR lines always use **line numbers**, never labels.

New error codes:

| Code | Message |
|---|---|
| 10 | Undefined label |
| 11 | Duplicate label (reported on the second definition) |
| 12 | Invalid label name |

---

## Appendix B — Sign Flag and Carry Flag (added later)

Two flags were added next to ZF, with the real x86 rules. ZF is unchanged.

| Instruction | ZF | SF | CF |
|---|---|---|---|
| MOV | unchanged | unchanged | unchanged |
| ADD dst, src | result = 0 | bit 31 of the result (1 = negative) | carry out of bit 31 (unsigned) |
| SUB dst, src | result = 0 | bit 31 of the result | borrow: unsigned dst < unsigned src |
| CMP dst, src | dst = src | like SUB (registers unchanged) | like SUB |
| INC / DEC | result = 0 | bit 31 of the result | **unchanged** |
| jumps / HLT | unchanged | unchanged | unchanged |

Examples:

| Program | After the last line |
|---|---|
| `MOV AX, 0` / `SUB AX, 1` | AX = -1, SF = 1, CF = 1 (borrow) |
| `MOV AX, -1` / `ADD AX, 1` | AX = 0, ZF = 1, SF = 0, CF = 1 (carry) |
| `MOV AX, 5` / `CMP AX, 9` | SF = 1, CF = 1 (5 < 9) |
| `SUB` that sets CF = 1, then `INC AX` | CF stays 1 |

The STEP line has the two new fields at the end (section 2).
