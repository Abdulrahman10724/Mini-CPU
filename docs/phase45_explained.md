# Phase 4 + 5 — Execution engine and result.txt (viva notes)

## New PROCs

**GetSourceValue.** Every two-operand instruction needs the value of its source operand.
If `instSrcType = 1` (register), the value is `regs[instSrc]`. If it's 2 (number), the value
is `instSrc` itself. It returns the value in EAX.

**SetZeroFlag.** Takes a result in EAX and sets our *virtual* `zeroFlag` to 1 if the result
is 0, otherwise 0. Only ADD, SUB, CMP, INC and DEC call it. MOV and the jumps don't, so they
leave ZF unchanged.

**ExecuteInstruction.** Decode and execute. It reads the opcode and jumps to one small block
per instruction with a compare-and-jump chain (`cmp edx, OP_MOV / je DoMov` ...). Each block
does its work on the memory variables `regs` and `zeroFlag`. It returns the next pc in EAX
(pc + 1, or the jump target) and ECX = 1 if the instruction was HLT. Arithmetic uses the real
32-bit `ADD/SUB/INC/DEC`, so it wraps around exactly like a real CPU:
2147483647 + 1 = -2147483648. CMP works out `dst - src` in a **copy** (EDX), so the virtual
register is not changed. ZF = 1 exactly when the difference is 0, which means they are equal.

**ExecuteProgram.** The main loop (see below). It resets the virtual CPU (all registers 0,
ZF 0, pc 1, stepCount 0), then repeats fetch, decode, execute and write a STEP line, until
one of the four END conditions happens. It stores `endType` and `endValue` for the END line.

**DebugWriteSigned / DebugPrintStep.** Console output only (DEBUG = 1).
`STEP 3 LINE 3: AX=5 BX=0 CX=5 DX=0 ZF=0`. WriteInt prints `+5` for positive numbers, so
DebugWriteSigned uses WriteDec for values ≥ 0 and WriteInt only for negative ones.

**IntToStr.** Turns a signed number into text in `numBuf` (explained in detail below). We need
it because Irvine's WriteDec/WriteInt can only print to the console, not into a buffer.

**AppendChar.** The only PROC that writes into `outBuf`. It stores AL at `outBuf[outPos]` and
adds 1 to outPos. If outPos has reached OUT_SIZE, it does nothing, so we can never write past
the buffer. Every other Append PROC goes through it.

**AppendString / AppendNumber / AppendSpace / AppendNewline.** Small helpers built on
AppendChar: copy a string until its 0, convert a number with IntToStr and append the text,
add one space (field separator), or add LF (byte 10). No CR, as the CONTRACT requires.

**AppendStatusAndErrors.** If program.txt is missing, it writes `STATUS ERR` and `ERR 0 9`, and
sets the END to ERRSTOP 0. Otherwise it first scans `lineErr[0..50]` (lines 1..51) for any
error, then writes `STATUS OK` or `STATUS ERR`. After that it goes through the array again
and writes `ERR <line> <code>` for each error, so they come out in ascending line order.

**AppendStepLine.** `STEP <stepCount> <pc> <AX> <BX> <CX> <DX> <ZF>`. It is called right after
an instruction runs, so it shows the registers *after* execution. pc is still the line that
was just executed, because ExecuteProgram only updates pc after writing the step.

**AppendEndLine.** `END` + the word for endType (`HALT`/`NOHLT`/`ERRSTOP`/`LOOP`) + endValue.

**WriteResultFile.** `CreateOutputFile` (this replaces an old result.txt), then **one**
`WriteToFile` of `outPos` bytes from `outBuf`, then `CloseFile`. If the file can't be created,
it prints a message (DEBUG only) and returns.

## The fetch–decode–execute loop in our code

| CPU idea | Where in CPU.asm |
|---|---|
| Program counter | `pc` (memory variable, a line number starting at 1) |
| **Fetch**: get the instruction at pc | ExecuteProgram: `EBX = pc - 1`, then read `lineErr[EBX]` and `instOp[EBX]` |
| Stop conditions | `pc > lineCount` → NOHLT (or ERRSTOP 51 if there were too many lines); error line → ERRSTOP pc |
| **Decode**: what kind of instruction? | ExecuteInstruction: `cmp edx, OP_xxx / je Doxxx` chain |
| **Execute**: do the work | the `Doxxx` blocks change `regs` and `zeroFlag` |
| Update pc | EAX = pc + 1 or the jump target; ExecuteProgram does `mov pc, eax` |
| Record the step | `inc stepCount`, `AppendStepLine`, `DebugPrintStep` |
| Halt / guard | ECX = 1 → END HALT; `stepCount = 500` → END LOOP |

Empty lines are skipped (`inc pc`) without counting a step. An error line stops execution
only when it is actually **reached**. In tests 11 and 19, a JMP skips over the error line,
so those programs end normally.

## Walk-through: tests/05_jnz_loop_sum (first 6 steps)

```
1 MOV AX, 0
2 MOV CX, 5
3 ADD AX, CX
4 DEC CX
5 JNZ 3
6 HLT
```

| Step | pc | Instruction | What happens | AX | CX | ZF | next pc |
|---|---|---|---|---|---|---|---|
| 1 | 1 | MOV AX, 0 | AX = 0 (MOV leaves ZF alone) | 0 | 0 | 0 | 2 |
| 2 | 2 | MOV CX, 5 | CX = 5 | 0 | 5 | 0 | 3 |
| 3 | 3 | ADD AX, CX | AX = 0 + 5 = 5; result ≠ 0 so ZF = 0 | 5 | 5 | 0 | 4 |
| 4 | 4 | DEC CX | CX = 4; ≠ 0 so ZF = 0 | 5 | 4 | 0 | 5 |
| 5 | 5 | JNZ 3 | ZF = 0, so the jump is taken | 5 | 4 | 0 | **3** |
| 6 | 3 | ADD AX, CX | AX = 5 + 4 = 9, ZF = 0 | 9 | 4 | 0 | 4 |

result.txt gets `STEP 1 1 0 0 0 0 0` … `STEP 6 3 9 0 4 0 0`. The loop continues until DEC CX
makes CX = 0 (ZF = 1) at step 16. Then JNZ is not taken (step 17), HLT runs at step 18, and
AX = 15 = 5+4+3+2+1.

## How IntToStr works

1. If the number is negative, write `-` into numBuf and `NEG` it to make it positive.
2. Repeatedly do an unsigned `DIV` by 10. The remainder (EDX) is the last digit, and the
   quotient (EAX) is what's left. Push each digit on the stack until the quotient is 0.
   The do-while loop runs at least once, so 0 becomes `"0"`.
3. The digits came out last digit first (for 157 that's 7, 5, 1). The stack gives them back
   in reverse, so popping them gives 1, 5, 7. Add `'0'` to each to make it a character,
   then write a 0 at the end.

**The -2147483648 case:** a 32-bit signed number can't hold +2147483648. So `NEG` on
-2147483648 (80000000h) gives 80000000h again, and as a signed number that still looks
negative. But `DIV` is **unsigned**, and unsigned 80000000h is exactly 2147483648, the
correct size. So the digits come out as 2,1,4,7,4,8,3,6,4,8, and with the `-` written in
step 1 the result is `"-2147483648"`. The longest possible text is 11 chars + 0, which fits
in the 16-byte numBuf.

## Why build result.txt in memory and write it once

- **The GUI never sees half a file.** The GUI reads result.txt right after CPU.exe ends. With
  one write at the end, the file is complete or it doesn't exist yet. Many small writes
  could leave a half-written file if something goes wrong in the middle.
- **Simpler and faster.** One `CreateOutputFile`, one `WriteToFile`, one `CloseFile`, instead
  of hundreds of system calls (up to 500 STEP lines).
- **Easy to keep safe.** All output goes through AppendChar, which checks the limit. The
  largest possible output is about 31.5 KB (see the comment at OUT_SIZE), so 40000 bytes is
  always enough.
- It is also a rule in CLAUDE.md: "Build the whole result.txt content in an output buffer
  and write it once at the end."
