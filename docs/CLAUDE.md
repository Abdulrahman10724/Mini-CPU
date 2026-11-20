# Mini CPU Simulator — COAL Lab Project

University COAL (Computer Organization & Assembly Language) lab project, FAST Karachi.
A virtual CPU with 4 registers (AX, BX, CX, DX), a program counter and a Zero Flag that
parses and executes a small instruction set, with a live-coding Python GUI.

## Hard rules
- **All CPU logic lives in assembly**: file reading, parsing, syntax/error checking,
  execution, and writing results. Python is only a front-end that displays results.
  This is graded as an assembly project — never move logic into Python.
- The file format in `CONTRACT.md` is **locked**. Follow it exactly. Never change it.
- Assembly: x86 32-bit MASM with the Irvine32 library (`INCLUDE Irvine32.inc`), Visual Studio.
- Use Irvine32 file procedures: `OpenInputFile`, `ReadFromFile`, `CreateOutputFile`,
  `WriteToFile`, `CloseFile`.
- `WriteDec`/`WriteInt` only print to console. To write numbers to a file, use our own
  `IntToStr` procedure (must handle negative numbers).
- Build the whole `result.txt` content in an output buffer and write it once at the end.
- Virtual registers are memory variables (`regs SDWORD 4 DUP(0)`), not real CPU registers.
- Keep a `DEBUG` constant; when 1, also print each step to console.
- Code must be readable for a viva: one PROC per task, comments on every PROC and on
  non-obvious lines, no clever tricks. Students must be able to explain every line.

## Structure
```
mini-cpu/
  CLAUDE.md
  CONTRACT.md
  asm/CPU.asm        # whole simulator (may split into .inc files if large)
  gui/app.py         # CustomTkinter GUI
  tests/             # test programs: <name>.txt and expected <name>.expected.txt
```

## Build / test
- Assembly is built in Visual Studio (Windows). If you cannot build it yourself, give me
  the code and I will build it and paste back any errors.
- Every test in `tests/` must produce output matching its `.expected.txt` exactly.

## GUI (gui/app.py)
- CustomTkinter. Left: code editor with line numbers. Right: AX, BX, CX, DX, ZF panel.
- On Enter: save editor text to `program.txt`, run `CPU.exe` with `subprocess.run`
  (same working directory), parse `result.txt`, show ✓ / ❌ + message next to each line.
- Buttons: Run, Step (walks STEP lines from result.txt, no re-run), Reset, Open, Save.
- Highlight the current line and any register that changed in the last step.
