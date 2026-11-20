# The GUI: how it works (viva notes)

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
`requestAnimationFrame`. At 1× the whole step takes 1200 ms.

| Time | Phase | What you see |
|---|---|---|
| 0–25 % | FETCH | The PC block glows amber and its counter rolls to 03. A cyan pulse labelled `L3` travels PC → IMEM, and the IMEM window highlights line 03. |
| 25–45 % | DECODE | A pulse travels IMEM → DECODER, and the decoder "types in" `op +`, `dst AX`, `src CX`. A purple pulse on the register-select line shows registers are needed. |
| 45–62 % | EXECUTE | Two purple pulses run at the same time: AX's old value `5` into ALU input A, and CX's value `4` into input B. |
| 60–74 % | EXECUTE | The ALU outline glows orange and shows `+`. |
| 70–88 % | EXECUTE | An orange pulse carries the result `9` along the write-back trace to the register file. At the same time a green pulse carries `ZF 0` to the flags. |
| 85–88 % | EXECUTE | The ZF LED is set (off, because 9 ≠ 0). AX's 7-segment digits change to 9, the AX row flashes purple → green, and a `+4` tag floats up. |
| 100 % | — | `showState(6)` draws the exact state from STEP line 6. |

A pulse is a small circle (plus 3 fading copies as a tail) moved along the wire's SVG path
with `path.getPointAtLength()`. While it moves, the wire is coloured, then fades back to
grey. Every value shown on a pulse (`5`, `4`, `9`, `ZF 0`) comes from the STEP lines.
