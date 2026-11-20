# Phase 2 — How the code works (viva notes)

**Data layout.** The virtual CPU (AX, BX, CX, DX, ZF, PC) is stored in ordinary memory
variables (`regs`, `zeroFlag`, `pc`), not in real CPU registers. Each program line has a
fixed 64-byte slot in `lineText`, so line N is always at `(N-1) * 64`. Parsed instructions
use "parallel arrays": `instOp[i]`, `instDst[i]`, `instSrc[i]` and `lineErr[i]` all describe
the same line, i = line - 1. The whole data section is declared now, so the memory layout
won't change in later phases.

**main.** The starting point. It calls each stage in order: read the file, split it into
lines (only if the file was read), print debug output, then exit. It never waits for a
key, so the GUI and the test runner don't hang.

**ReadProgramFile.** Opens `program.txt` with Irvine's `OpenInputFile`. If that returns
`INVALID_HANDLE_VALUE`, the file doesn't exist, so we set `fileMissing = 1` (later this becomes
error 9). Otherwise `ReadFromFile` reads up to 4096 bytes into `fileBuf`. EAX returns how many
bytes were read, and the Carry flag means the read failed. We put a 0 after the last byte and
close the file.

**SplitLines.** Reads `fileBuf` one byte at a time (EBX is the position) and copies characters
into the current line's slot (EDI is the write pointer, EDX counts the characters). LF ends
a line. CR is skipped, so Windows (CRLF) and Linux (LF) files both work. TAB becomes a space.
After 63 characters, extra characters are skipped so we never write past the 64-byte slot.
If 50 lines are already stored and bytes are still left, it sets `tooManyLines = 1` (error 7).
A newline at the very end doesn't create an extra line, because we only start a new line
when there are bytes left.

**ToUpperLine.** Walks one line until the 0 byte. Any character from 'a' to 'z' has 32
subtracted, because in ASCII lowercase letters are exactly 32 higher than uppercase ones
('a' = 97, 'A' = 65). This makes `mov ax, 5` and `MOV AX, 5` the same.

**GetLineAddress.** Turns a line number into a memory address:
`OFFSET lineText + (N - 1) * 64`. It uses `MUL`, which also changes EDX, so EDX is saved with
`USES`. Every phase uses this procedure, so the address calculation is written only once.

**DebugPrintLines.** If `DEBUG = 1`, it prints the byte count, the line count, an optional
`TOO MANY LINES`, and each line inside `[ ]` so you can see leading and trailing spaces.
It uses Irvine's `WriteString`, `WriteDec` and `Crlf`, which print only to the console.
With `DEBUG = 0` it returns straight away.

**Why `.386` / `.model flat, stdcall` aren't written in CPU.asm:** `Irvine32.inc` already
contains them, and writing `.model` a second time can give an assembler error.
