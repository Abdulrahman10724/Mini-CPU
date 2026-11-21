# The GUI: how it works (viva notes)

The GUI looks like a page from a 1978 CPU datasheet: paper, black ink and one red. The program
is a ruled notebook (errors are circled in red pen), Fig. 1 is the datapath as a textbook
figure, and Fig. 2 is a timing diagram of the whole run. Colour is used only for moving data,
the current step and errors.

## 1. How Python talks to CPU.exe

```
editor text --(JS: api.run)--> bridge.py --writes--> gui/runtime/program.txt
                                         --runs----> CPU.exe   (cwd = gui/runtime)
JS state <--(dict)-- result_parser.py <--reads-- gui/runtime/result.txt
```

1. The page is HTML/JS inside a pywebview window. pywebview gives JavaScript an object
   `window.pywebview.api`, whose methods are the methods of our Python class `Api`
   (bridge.py). `api.js` is the only JS file that uses it.
2. `Api.run(code)` writes the code to `program.txt`, deletes any old `result.txt`, and runs
   CPU.exe with `subprocess.run(..., cwd=runtime, timeout=5, creationflags=CREATE_NO_WINDOW)`,
   so no console window appears.
3. `result_parser.py` reads `result.txt` line by line and checks that it follows
   CONTRACT.md exactly: STATUS first, then ERR lines in order, STEP numbers 1, 2, 3, ...,
   7 numbers per STEP, and one END. If anything is wrong it raises an error, and the GUI
   shows "result.txt is not valid" instead of a wrong picture.
4. The dict goes back to JavaScript as JSON:
   `{status, errors: [{line, code}], steps: [{n, line, ax, bx, cx, dx, zf}], end: {type, value}}`.

## 2. Why the GUI contains no CPU logic

The project is graded as an assembly project, so everything a CPU does is in `CPU.asm`:
reading the file, parsing, error checking, executing, flags and jumps. The GUI never decides
whether a line is valid, never computes a register value, and never decides where a jump
goes. Every number on screen comes from a STEP line in `result.txt`:

- register values, ZF and the executed line come straight from the STEP lines;
- whether a jump was taken comes from the next STEP's line number (where the CPU actually went);
- errors come from the ERR lines; the GUI only turns the code number into words (errors.js).

The only "knowledge" the GUI has about instructions is cosmetic: syntax colours, which
wires to light up for an ADD, and the help text.

`mock_cpu.py` is a separate development tool for machines without MASM. The real app
never uses it unless started with `--mock`, and then it shows a MOCK ENGINE badge.

## 3. How stateAt(k) works

The timeline has positions 0 to N (N = number of STEP lines).

```js
stateAt(0)  -> AX=BX=CX=DX=0, ZF=0, no line     // before the first instruction
stateAt(k)  -> the values in STEP line k          // after instruction k ran
```

Because every STEP line already holds the full state after that step, we never "replay"
anything. Jumping to step 300 is a direct array lookup: `steps[299]`. This is why
dragging the slider is instant and always correct.

Every part of the screen (editor marks, datapath, history, timeline) renders from one
object in `state.js`. When something changes, `update()` tells every part to redraw.
The animation only adds the in-between movement. When it finishes it calls
`showState(k)`, which draws the exact state from the data. So even if an animation is
cancelled halfway, the screen ends up correct.

## 4. How one ADD step is animated

Example: step 6 of the loop demo, `ADD AX, CX`, where AX goes from 5 to 9 and CX = 4.
`choreography.js` returns a list of timed "beats". `animator.js` plays them with
`requestAnimationFrame`. At 1× the whole step takes 1200 ms. The figure works like print:
an active wire is drawn heavy (3px ink instead of a thin grey rule), an active block is
hatched, and **data travels as a small red label carrying the real value**.

| Time | Phase | What you see |
|---|---|---|
| 0–25 % | FETCH | The FETCH tab is underlined in red, the PC block is hatched and its cells roll to 03, and a red `L3` label travels PC → IMEM. IMEM marks line 03 with ▶. |
| 25–45 % | DECODE | A red `ADD` label travels IMEM → DECODER, and the decoder "types in" `op +`, `dst AX`, `src CX`. A label `AX` goes down the register-select wire. |
| 45–62 % | EXECUTE | Two red labels travel at the same time: `5` (AX) into ALU input A and `4` (CX) into input B. They wait at the inputs. |
| 60–72 % | EXECUTE | The ALU is hatched and shows `+`. The two inputs disappear and a single result label `9` appears inside the ALU. |
| 72–90 % | EXECUTE | `9` travels down the write-back wire to the register file, and `ZF 0` travels to the flags. |
| 86–100 % | EXECUTE | ZF stays a hollow ring (9 ≠ 0). In the ledger, AX's old value 5 moves to PREV and gets struck through, and 9 is written in NOW in red, then settles to black ink. |
| 100 % | — | `showState(6)` draws the exact state from STEP line 6. |

## 5. The signal trace (Fig. 2)

Real CPU datasheets show bus timing as a **timing diagram**, and Fig. 2 draws the whole run the
same way. Each column is one step: column 0 is the start (everything 0), column k is the state
after step k.

- **PC, AX, BX, CX, DX** are "bus" rows. A value is drawn as a long hexagon, and where the value
  changes the lines cross in an X. Students can see at a glance when a register changed and for
  how long it kept its value.
- **ZF** is a single wire, drawn as a square wave: high = 1, low = 0.
- **JMP** shows ↶ at every step where a jump was taken.

It is drawn on a `<canvas>`, because 500 steps × 7 rows would be thousands of SVG elements.
The canvas only redraws when the result, the zoom, the scroll position or the size changes,
and then only the columns you can see. The red cursor line, its `t = 6` flag and the red values
for the current step are small HTML elements on top (an "overlay"), so moving through time
never redraws the canvas. Click or drag to move the cursor, Ctrl + wheel to zoom, FIT to see
everything. All values are read from the STEP lines of result.txt.

## 6. Linked highlighting

Hover over something and it lights up in every panel at once:

| You hover… | It also highlights… |
|---|---|
| a register (`AX` in the editor, its ledger row, the `AX` trace label, `AX` in the log) | every AX in the editor (red underline), the AX ledger row (hatched), the AX trace row (light band), the wires that carry AX in this step (heavy), and log rows that changed AX (red rule) |
| an editor line | its log rows, a red tick on the trace ruler at every step it ran, and its IMEM row |
| a trace column or a log row (a step) | the line that ran (red band under it), the IMEM row, and a preview of that step's values, without moving the cursor (click to go there) |

How it works: `highlight.js` holds **one** small value, for example `{ kind: "reg", value: "AX" }`,
**separate from the main state**, so hovering never re-renders the page or re-runs CPU.exe.
Every panel listens and shows the link in its own way. A hover link never looks like the current
step (the current step is a solid red wash with ▶; links are underlines, bands, hatching or rules).
For speed with 500 steps, `state.js` builds two lookup tables once per result, `byLine`
(which steps ran line 3) and `byReg` (which steps changed AX), so a hover never scans the
whole program.

**Breakpoints** are GUI-only: click left of a line number to set ■. Run pauses on the first step
that runs that line. CPU.exe is never told about breakpoints, because they only change *where
the timeline stops*, not what the CPU computed.
