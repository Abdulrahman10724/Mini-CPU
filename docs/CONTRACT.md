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

| Instruction | Format | Effect |
|---|---|---|
| MOV | `MOV reg, reg/num` | reg = src |
| ADD | `ADD reg, reg/num` | reg = reg + src, update ZF |
| SUB | `SUB reg, reg/num` | reg = reg - src, update ZF |
| CMP | `CMP reg, reg/num` | ZF = 1 if reg == src else 0 (no register change) |
| INC | `INC reg` | reg = reg + 1, update ZF |
| DEC | `DEC reg` | reg = reg - 1, update ZF |
| JMP | `JMP line` | PC = line |
| JZ | `JZ line` | if ZF = 1 then PC = line |
| JNZ | `JNZ line` | if ZF = 0 then PC = line |
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
STEP  <stepNo> <lineNo> <AX> <BX> <CX> <DX> <ZF>
END   HALT|NOHLT|ERRSTOP|LOOP <number>
```

- `STATUS OK` if no parse errors, `STATUS ERR` if at least one.
- `STEP` is written **after** the instruction on `lineNo` executes; register values are the state after execution.
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
STEP 1 1 5 0 0 0 0
STEP 2 2 5 3 0 0 0
STEP 3 3 8 3 0 0 0
STEP 4 4 8 3 0 0 1
STEP 5 5 8 3 0 0 1
STEP 6 7 8 3 0 0 1
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
STEP 1 1 5 0 0 0 0
STEP 2 2 5 3 0 0 0
END ERRSTOP 3
```
