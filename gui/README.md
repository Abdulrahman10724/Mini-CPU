# Mini CPU Simulator: GUI

A desktop window (pywebview, using Edge WebView2 on Windows) that lets you write a
Mini CPU program and watch the assembly engine `CPU.exe` run it on an animated datapath.

The GUI contains **no CPU logic**. It writes `program.txt`, runs `CPU.exe`, reads
`result.txt` (format: `docs/CONTRACT.md`) and displays it.

## Install (Windows 10/11, Python 3.10+)

    pip install pywebview

That is the only dependency. CodeMirror and the fonts are already in `gui/web/vendor`
and `gui/web/fonts`, so the app works fully offline.

## Run

    python gui/app.py --exe "C:\path\to\Debug\Project.exe"

How the engine is found, in this order:

1. `--exe <path>` on the command line
2. `"exe_path"` in `gui/config.json`
3. automatic search: `CPU.exe` in the project root, `asm\`, `asm\Debug\`, `asm\Release\`,
   `Debug\` or `Release\` (the same search as `tests/run_tests.py`)

If none is found, the app shows "Engine not found" and explains these three options.
After fixing it, press **Retry**.

Add `--debug` to open the web inspector.

### Mock mode (development only)

    python gui/app.py --mock

This uses `gui/mock_cpu.py`, a Python copy of the contract, so the GUI can be developed
and screenshotted where MASM is not available. The header then shows a dashed red
**MOCK ENGINE** badge. It is never used automatically. The mock passes the same tests:

    python tests/run_tests.py --mock

## Tests

    python gui/tests/test_result_parser.py     # parses every tests/*.expected.txt + bad files

## Folder map

    gui/
      app.py              start the window; choose the engine (--exe / config.json / search)
      bridge.py           Api called from JavaScript: run, open/save, demos, engine status
      result_parser.py    result.txt -> dict, strictly checked against CONTRACT.md
      mock_cpu.py         DEV ONLY Python engine (used only with --mock)
      config.json         optional saved exe_path
      runtime/            program.txt + result.txt live here (not in git)
      demos/              the 3 demo programs
      tests/              result_parser tests
      dev/                DEV ONLY: dev_server.py + shim.js (browser preview), screenshots.js
      web/
        index.html          the page: masthead, Program, Fig. 1, log, Fig. 2; icons + hatch
        css/tokens.css      the design system: paper, ink, one spot red, IBM Plex fonts
        css/layout.css      the sheet: grid, rules, crop marks, masthead, printed controls, slips
        css/editor.css      the ruled notebook, pencil notes, red pen
        css/datapath.css    Fig. 1 as a textbook figure
        css/waveform.css    Fig. 2, the signal trace
        css/sheets.css      execution log, help appendices, toasts, dialog, engine slip
        js/main.js          boot + wiring: runs, playback, breakpoints, shortcuts, linked highlights
        js/state.js         the single state object, stateAt(k), describeStep(k), indexes()
        js/highlight.js     the one transient "linked highlight" (register / line / step)
        js/api.js           the only file that calls Python
        js/editor.js        CodeMirror notebook, pencil notes, red pen, hover preview, live mode
        js/pen.js           the hand-drawn red ellipse (editor + decoder)
        js/datapath.js      Fig. 1: SVG figure, ledger, setters
        js/choreography.js  which wires/blocks light up for each opcode, and when
        js/animator.js      plays one step: heavy wires, hatching, red data labels
        js/waveform.js      Fig. 2: canvas timing diagram, cursor, zoom, scrub
        js/history.js       execution log table
        js/help.js          help appendices A-C
        js/dialog.js        paper-slip confirm dialog
        js/engine.js        engine status label, popover, "engine missing" slip
        js/errors.js        error code -> message + hint (one place)
        js/toast.js         small paper-slip messages
        vendor/codemirror   CodeMirror 5 (MIT, LICENSE included)
        fonts/              IBM Plex Sans, Mono, Serif Italic (OFL, LICENSE in each folder)

## Using it

- Type a program; **Enter** runs it at once (live mode), any other edit runs it 700 ms later.
- **RUN** animates from step 0; **STEP** / F10 one step; **RESET** back to step 0.
- **Fig. 2 (signal trace):** click or drag to move through time; Ctrl + wheel zooms, the
  wheel scrolls, **FIT** shows all steps; ← / → step when the trace has focus. Drag its top
  double rule to make it taller or shorter.
- **Hover** a register, a line, a log row or a trace column: it is highlighted everywhere.
- Click a **line number** to jump to the last time that line ran; click the strip left of
  it to set a **breakpoint** (Run pauses there; CPU.exe never sees breakpoints).

## Previewing in a normal browser (development)

    python gui/dev/dev_server.py --port 8765        # serves gui/web + answers api calls (mock)
    node gui/dev/screenshots.js                     # writes docs/screens/v2/*.png (needs Playwright)

`screenshots.js` also expects `python gui/dev/dev_server.py --port 8766 --missing`.
