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
   opcode (1) -> missing operand (3) -> first operand (8 if it starts with a digit or `-`,
   else 2) -> second operand (5 if it starts with a digit or `-` and is not a valid number,
   else 2) -> extra operand (4).
   Jump operand: not a number -> 5, outside 1..total lines -> 6.
4. More than 50 lines: a single `ERR 51 7`; only lines 1-50 are parsed. Running past line 50
   reaches line 51 -> `END ERRSTOP 51`. Jump range is 1..50.
5. MOV and jumps never change ZF. ADD/SUB/INC/DEC set ZF = (result == 0). ZF starts at 0.
6. HLT and jumps count as steps (as in the CONTRACT example).
7. Loop guard: after the 500th step, if not halted, `END LOOP 500`.
8. Missing program.txt: `STATUS ERR`, `ERR 0 9`, `END ERRSTOP 0`.
