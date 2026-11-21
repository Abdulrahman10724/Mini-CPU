# Tests

Run on Windows after building CPU.exe:

    python tests/run_tests.py                 # auto-finds CPU.exe
    python tests/run_tests.py --exe path\to\CPU.exe
    python tests/run_tests.py 05              # only tests whose name contains "05"

`17_error_9_no_file` has no `.txt` on purpose: the runner deletes program.txt to test error 9.
`08_lowercase_spaces_crlf.txt` uses CRLF line endings (kept byte-exact by `.gitattributes`).

## Rules where CONTRACT.md is silent (the tests assume these)

1. A final newline does not start an extra line (`"HLT\n"` is 1 line).
2. Empty / spaces-only lines produce no STEP; execution just moves to the next line.
   Jumping to an empty line is allowed (it is within 1..total lines).
3. One error per line: the first one found, checked left to right:
   opcode (1) -> missing operand (3) -> first operand (8 if it starts with a digit, `-` or `+`,
   else 2) -> second operand (5 if it starts with a digit, `-` or `+` and is not a valid number,
   else 2) -> extra operand (4).
   A valid number is an optional `-` followed by digits only, so `+5` is error 5 (or 8 as
   operand 1).
   Jump operand: looks like a number (starts with a digit, `-` or `+`): not a valid number
   -> 5, outside 1..total lines -> 6. Anything else is a label name: not defined -> 10
   (so `JMP ABC` and `JMP AX` are error 10; before labels existed they were error 5).
4. More than 50 lines: a single `ERR 51 7`; only lines 1-50 are parsed. Running past line 50
   reaches line 51 -> `END ERRSTOP 51`. Jump range is 1..50.
5. MOV and jumps never change ZF. ADD/SUB/INC/DEC set ZF = (result == 0). ZF starts at 0.
   SF and CF (CONTRACT.md appendix B): ADD/SUB/CMP set SF = bit 31 of the result and CF =
   unsigned carry (ADD) / borrow (SUB, CMP). INC/DEC set SF only and keep CF. MOV, jumps
   and HLT change no flag. Both start at 0. STEP lines end with `<ZF> <SF> <CF>`.
6. HLT and jumps count as steps (as in the CONTRACT example).
7. Loop guard: after the 500th step, if not halted, `END LOOP 500`.
8. Missing program.txt: `STATUS ERR`, `ERR 0 9`, `END ERRSTOP 0`.
9. Arithmetic wraps around like a real 32-bit CPU (two's complement), with no error:
   `2147483647 + 1 = -2147483648`. CMP sets ZF = 1 exactly when both values are equal.
10. If HLT runs as step 500, the result is `END HALT 500` (HLT is checked before the guard).
11. Labels (CONTRACT.md appendix A), two passes:
    - Pass 1 looks only at the FIRST word of every line. If it ends with `:` it is a label;
      `NAME:` is removed from the line and the rest is parsed normally. `L1:ADD AX, CX`
      (no space) also works.
    - A label alone on a line makes it an empty line (no STEP). A jump to it continues
      with the next line; to a label alone on the LAST line -> `END NOHLT`.
    - Name check (error 12): 1-12 chars, letters/digits/`_`, starts with a letter, not an
      opcode or register name. Case-insensitive (`skip:` = `SKIP:`). `: HLT` (no name) -> 12.
    - Duplicate (error 11): reported on the SECOND definition; the first one stays valid.
    - A second label on the same line (`X: Y: MOV BX, 2`) -> 12; the first label (`X`) is
      still defined.
    - A line with a label error is not parsed further (one error per line).
    - Labels are only jump targets: `MOV AX, L1` -> 2, as any non-register word.
      All seven jumps (JMP JZ JNZ JS JNS JC JNC) take a line number or a label.
    - Unused labels are fine (no error). Jumps still accept line numbers (`JNZ 3`).
