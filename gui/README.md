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
and screenshotted where MASM is not available. The top bar then shows an amber
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
        index.html        page skeleton + icon set
        css/              tokens.css (all colours/fonts), layout, components, datapath
        js/main.js        boot + wiring: runs, playback, shortcuts
        js/state.js       the single state object, stateAt(k), describeStep(k)
        js/api.js         the only file that calls Python
        js/editor.js      CodeMirror, gutters, inline results, live mode
        js/datapath.js    the SVG datapath and its setters
        js/sevenseg.js    7-segment register displays
        js/choreography.js which wires/blocks light up for each opcode, and when
        js/animator.js    plays one step (requestAnimationFrame)
        js/history.js     right-hand step list
        js/timeline.js    bottom transport + slider
        js/help.js        help drawer
        js/engine.js      engine status pill, popover, "not found" card
        js/errors.js      error code -> message + hint (one place)
        js/toast.js       small messages
        vendor/codemirror CodeMirror 5 (MIT, LICENSE included)
        fonts/            Space Grotesk, JetBrains Mono (OFL, LICENSE included)

## Previewing in a normal browser (development)

    python gui/dev/dev_server.py --port 8765        # serves gui/web + answers api calls (mock)
    node gui/dev/screenshots.js                     # writes docs/screens/*.png (needs Playwright)

`screenshots.js` also expects `python gui/dev/dev_server.py --port 8766 --missing`.
