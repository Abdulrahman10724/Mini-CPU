# Phase 3 — How the parser works (viva notes)

**Idea.** Every line becomes one of three things: an empty line (`instOp = 0`, no error),
an error (`lineErr = code`), or a parsed instruction stored in four parallel arrays
(`instOp`, `instDst`, `instSrcType`, `instSrc`) at index `line - 1`. The executor (Phase 4)
only reads these arrays. It never looks at the text again.

**Return convention.** The `Parse...` helpers use the Carry flag like Irvine's own
procedures do: `CF = 0` means success and the result is in EAX. `CF = 1` means failure and
EAX holds the error code. `stc` sets the Carry flag and `clc` clears it. `jc` jumps when it is set.

## PROCs

**GetTokenAddress.** Same idea as GetLineAddress: token K is at `OFFSET tokens + K * 16`.

**Tokenize.** First clears all 64 bytes of `tokens` to 0, so every stored word already ends
with a 0. Then it alternates between two loops. `SkipSeparators` skips spaces and commas, and
`WordChars` copies one word. Every word increases `tokCount`. Only the first 4 are stored
(EDX = 1 means store, 0 means count only), and at most 15 chars each, so it can never write
outside the array. `MOV AX BX CX DX EX` still gives tokCount = 6, which is how error 4 is found.

**StrEquals.** Compares two strings one char at a time. It stops at the first difference
(not equal), or when both strings reach their 0 together (equal). I used my own loop
instead of Irvine's `Str_compare`, because it returns a plain 1 or 0 in EAX, which is easier
to explain than reading CPU flags.

**LookupOpcode.** Walks through `opNames`, which has 10 names in 4-byte slots, calling
StrEquals for each one. If slot `i` matches, the opcode is `i + 1` (MOV = 1 … HLT = 10).
No match gives 0, which means error 1.

**LookupRegister.** The same search over `regNames` (3-byte slots). It returns 0..3 for
AX..DX, or -1 if the word is not a register.

**IsNumberStart.** Returns 1 if the first char is a digit or `-`. This is how we tell
`MOV 5, AX` (error 8, "first operand must be a register") apart from `MOV EX, 5`
(error 2, "invalid register").

**StrToInt.** Reads an optional `-`, then digits only. For each digit:
`value = value * 10 + digit`. Three checks catch overflow before it can wrap around:
`MUL` putting anything in EDX (the result needed more than 32 bits), a carry after `ADD`, and
`value > limit`. The limit is 2147483647, or 2147483648 if there was a minus sign. At the end,
`NEG` makes the value negative. `"-"`, `"5A"`, `"--3"` and `"+5"` are all invalid.

**ParseRegOperand.** Operand 1 of MOV/ADD/SUB/CMP/INC/DEC. It returns the register index,
or error 8 if the word looks like a number, otherwise error 2.

**ParseSrcOperand.** Operand 2 of MOV/ADD/SUB/CMP. A register gives `EDX = 1` and
EAX = register index. A word starting with a digit or `-` must pass StrToInt, giving
`EDX = 2` and EAX = value, or error 5 if it fails. Anything else is error 2.

**ParseJumpTarget.** The operand of JMP/JZ/JNZ. It must be a number (error 5 if not) and
between 1 and lineCount (error 6 if not). It uses signed jumps (`jl`/`jg`) because the
number can be negative, like `JZ -1`.

**ParseLine.** Clears this line's entries, gets the line's address, tokenizes it, then
checks in this fixed order:
opcode (1) → operand count too small (3) → operand 1 → operand 2 → operand count too
big (4). The number of operands each opcode needs comes from the small table
`opOperandCount`. The first error found jumps to `SetError`, which stores the code and
removes any fields stored before the error. If everything is fine, `instOp` is stored last.

**ParseAllLines.** Calls ParseLine for lines 1..lineCount. If `tooManyLines = 1`, it puts
error 7 at index 50 (line 51).

**DebugPrintParsed.** Prints one line per program line: `EMPTY`, `ERR=code`, or all the
fields. Irvine's `WriteInt` prints a `+` in front of positive numbers (`+5`), so SRC uses
`WriteDec` for values ≥ 0 and `WriteInt` only for negative ones. That way the output is
`SRC=5` and `SRC=-5`.

## Walk-through 1: `MOV AX, -5`

1. Tokenize: tokens = `MOV`, `AX`, `-5`, so tokCount = 3. (The comma is a separator.)
2. LookupOpcode(`MOV`) matches slot 0, so opcode = 1, and `opOperandCount[0]` = 2 operands needed.
3. Missing operand? There are 3 - 1 = 2 operands, and 2 ≥ 2, so no error.
4. Operand 1: LookupRegister(`AX`) = 0, so `instDst = 0`.
5. Operand 2: LookupRegister(`-5`) = -1, so it's not a register. IsNumberStart sees `-`
   and returns 1. StrToInt: there's a minus sign, so the limit is 2147483648. The digit 5
   gives value 0*10+5 = 5, the end of the word is reached, and NEG gives -5 with CF = 0.
   So `instSrcType = 2` and `instSrc = -5`.
6. Extra operand? 2 > 2 is false, so no error.
7. Store `instOp = 1`. Debug prints `OP=1 DST=0 SRCTYPE=2 SRC=-5`.

## Walk-through 2: `ADD AX`

1. Tokenize: tokens = `ADD`, `AX`, so tokCount = 2.
2. LookupOpcode(`ADD`) matches slot 1, so opcode = 2, and 2 operands are needed.
3. Missing operand? There are 2 - 1 = 1 operands, and 1 < 2, so it's error 3. Jump to SetError.
4. `lineErr = 3` and `instOp` stays 0. Debug prints `ERR=3`. The operands are never
   checked, because only the first error found on a line is reported.
