# Mini CPU Simulator — COAL Lab Project

University COAL (Computer Organization & Assembly Language) lab project, FAST Karachi.
A virtual CPU with 4 registers (AX, BX, CX, DX), a program counter and three flags
(ZF, SF, CF; see `docs/flags_explained.md`) that
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
  gui/app.py         # GUI: pywebview window showing gui/web/ (HTML/CSS/JS)
  tests/             # test programs: <name>.txt and expected <name>.expected.txt
```

## Build / test
- Assembly is built in Visual Studio (Windows). If you cannot build it yourself, give me
  the code and I will build it and paste back any errors.
- Every test in `tests/` must produce output matching its `.expected.txt` exactly.

## GUI (gui/ — see gui/README.md)
- **pywebview** (the only dependency) opens a desktop window that shows `gui/web/index.html`
  (vanilla HTML/CSS/JS, ES modules, no build step, fully offline: CodeMirror 5 and the
  IBM Plex fonts are vendored with their licences).
- Python (`gui/bridge.py`) only writes `program.txt`, runs `CPU.exe` in `gui/runtime/`
  (`subprocess.run`, no console window), and parses `result.txt` (`gui/result_parser.py`).
  The GUI contains NO CPU logic: every value it shows comes from result.txt.
- `gui/mock_cpu.py` is DEV ONLY (`--mock`), for working without MASM; never a fallback.
- Design: a "1978 CPU datasheet" page — paper, black ink, one spot red (`css/tokens.css`).
  Program = ruled notebook with red-pen errors; Fig. 1 = datapath as a textbook figure;
  execution log; Fig. 2 = signal trace (timing-diagram timeline). Hovering a register,
  line or step highlights it in every panel.
- Live mode: CPU.exe re-runs on the whole program once the user stops typing for 900 ms
  (every key, Enter too, restarts the timer); old results stay dimmed meanwhile.
  Ctrl+Enter / RUN runs at once, animated.
- Three sheets: Cover, Workbench, Analysis. Run / Reset, step and play in the signal trace
  (F10 / Shift+F10), breakpoints (GUI only), Open / Save, demos, help (F1).
- Must fit at 1366x768 and 1440x900 (`gui/dev/screenshots_v5.js` checks for overflow).
- Labels (`L1: ...`, `JNZ L1`) are resolved by CPU.asm in two passes (CONTRACT.md appendix A,
  `docs/labels_explained.md`); the GUI only displays them.
