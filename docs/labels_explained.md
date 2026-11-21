# Labels: the two-pass assembler (viva notes)

Instead of counting lines for a jump (`JNZ 3`), a program can give a line a **name**:

```
MOV AX, 0
MOV CX, 5
L1: ADD AX, CX      ; line 3 is called L1
DEC CX
JNZ L1              ; = JNZ 3
HLT
```

`JNZ L1` and `JNZ 3` do exactly the same thing. `result.txt` does not change: STEP and ERR
lines still use line numbers (tests 05 and 26 give byte-identical results).

## 1. Why two passes?

A jump may use a label that is defined **further down** (a forward reference):

```
JMP SKIP            ; line 1: where is SKIP? We have not read that line yet!
MOV AX, 99
SKIP: MOV BX, 1     ; line 3
```

If we checked the lines only once, from top to bottom, line 1 could not know where
`SKIP` is. So, like a real assembler (MASM does the same), CPU.asm reads the program
**twice**:

| | Procedure | What it does |
|---|---|---|
| PASS 1 | `CollectLabels` | Look only at the first word of every line. If it ends with `:`, write the name and the line number into the **symbol table**, then erase `NAME:` from the line. |
| PASS 2 | `ParseAllLines` | The old parser. When a jump's operand is not a number, `LookupLabel` finds its line number in the symbol table. |

When pass 2 starts, the symbol table is already complete, so forward jumps work.

## 2. The symbol table

It is two **parallel arrays** (like `instOp` / `instDst`):

```
labelNames  BYTE  50*16 DUP(0)   ; name i at offset i*16, 0-terminated
labelLines  DWORD 50 DUP(0)      ; line number of name i
labelCount  DWORD 0
```

For the loop-sum program, after pass 1:

| i | labelNames (16 bytes) | labelLines |
|---|---|---|
| 0 | `L1`,0,0,... | 3 |

Every name gets a **fixed 16-byte slot**, so entry *i* is simply at `OFFSET labelNames + i*16`
(the same idea as `lineText` with 64-byte slots). 50 entries are always enough: at most
one label per line, and at most 50 lines.

`LookupLabel` walks the table with `StrEquals` (the same compare loop as `LookupOpcode`)
and returns the line number with Carry = 0, or Carry = 1 if the name is not there.

## 3. Pass 1 on one line (`CollectLineLabel`)

Line 3 is `L1: ADD AX, CX`:

1. Skip leading spaces, then walk the first word. We reach `:` before a space, so the
   first word is a label.
2. Copy `L1` into `labelWord`.
3. Overwrite `L1:` with spaces: the line becomes `    ADD AX, CX`. Pass 2 now sees a normal
   instruction, so the old parser did not need to change.
4. Check the name (`IsValidLabelName`), make sure it is new (`LookupLabel`), add it
   (`AddLabel`).
5. Make sure there is no second `:` on the line (only one label per line).

A label **alone** on a line (`LOOP:`) becomes an empty line after step 3. Empty lines make no
STEP, so a jump to it simply continues with the next line. A label alone on the **last** line
works the same way: there is no next line, so the program ends with `END NOHLT`.

## 4. Pass 2: the jump operand (`ParseJumpTarget`)

```
does the operand start with a digit, '-' or '+'?
  yes -> a line number, checked as before (error 5 bad number, 6 out of range)
  no  -> a label: LookupLabel -> its line, or error 10 (undefined label)
```

A label's line is always inside the program, so it can never be "out of range".
The execution engine never sees labels: `instSrc` holds the line number in both cases.

## 5. Errors

| Code | When | Example |
|---|---|---|
| 10 | A jump uses a name that is not in the symbol table | `JMP NOWHERE` (and `JMP AX`) |
| 11 | The same name is defined again (reported on the **second** one; the first stays valid) | `A: INC AX` then `A: DEC AX` |
| 12 | Bad name: empty, longer than 12, not letters/digits/`_`, starts with a digit, an instruction or register name, or a second label on the line | `1ABC:`, `MOV:`, `CX:`, `X: Y: MOV BX, 2` |
| 2 | A label used where a register or number is needed | `MOV AX, L1` |

Why is `MOV AX, L1` an error? Our CPU has **no memory**: a label is only a place in the
program to jump to, not a value. In real x86, `MOV EAX, L1` would load an address; we have no
addresses, so only `JMP`, `JZ` and `JNZ` accept labels.

A line with a label error is not parsed further (one error per line), and execution stops
there like on any other error line.

## 6. What the GUI does with labels

Display only (CPU.exe has already resolved every jump):
- the editor shows labels in ink italic with their colon;
- the log and the analysis page show the source text, and match a jump to its label's line
  to draw "→ L3" and the branch arcs;
- the help sheet (Appendix A) explains labels, and errors 10–12 have hints.

## 7. Tests

| Test | Checks |
|---|---|
| `26_labels_loop` | label on an instruction line, reached by falling through AND by jumps; an unused label |
| `27_label_errors` | errors 10, 11, 12 (all kinds) and 2 (label in MOV / ADD) |
| `28_label_alone_line` | label alone on a line; jump to a label alone on the last line → `END NOHLT` |
| `29_mixed_number_and_label_jumps` | forward reference, lowercase names, `L:INC` without a space, 12-char name, label and number jumps together |
