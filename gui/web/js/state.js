// state.js - the ONE state object of the editor page.
// Every component renders from it. Components never talk to each other directly:
// they call update(), and update() tells every subscriber what changed.
//
// All CPU facts (register values, ZF, which line ran, errors, how it ended) come
// from result.txt via state.result. The helpers below only LOOK UP that data.

export const state = {
  code: "",                 // editor text
  filePath: null,           // path on disk, or null for a new file
  fileName: "untitled.txt",
  dirty: false,             // unsaved changes
  engine: { state: "checking", path: "" },
  running: false,           // CPU.exe is running right now
  result: null,             // parsed result.txt: {status, errors, steps, end}
  resultCode: "",           // the exact code that produced `result`
  cursor: 0,                // timeline position 0..N (0 = before step 1)
  playing: false,
  speed: "1",               // "0.25" | "0.5" | "1" | "2" | "instant"
  regFormat: "dec",         // "dec" | "hex" | "bin"
  helpOpen: false,
  breakpoints: new Set(),   // line numbers; GUI only, CPU.exe never sees them
};

const listeners = [];

export function subscribe(fn) {
  listeners.push(fn);
}

// Change some fields, then let every component re-render.
// `patch` is passed along so a component can skip work when its data did not change.
export function update(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state, patch);
}

export const REG_NAMES = ["AX", "BX", "CX", "DX"];

export function totalSteps() {
  return state.result ? state.result.steps.length : 0;
}

// CPU state after step k (k = 0 means "before step 1": everything is zero).
export function stateAt(k) {
  const steps = state.result ? state.result.steps : [];
  if (k <= 0 || steps.length === 0) return { k: 0, regs: [0, 0, 0, 0], zf: 0, line: null };
  const s = steps[Math.min(k, steps.length) - 1];
  return { k, regs: [s.ax, s.bx, s.cx, s.dx], zf: s.zf, line: s.line };
}

// Line n of the program that produced the result (1-based), trimmed.
export function lineText(n) {
  if (!n) return "";
  const lines = state.resultCode.split("\n");
  return (lines[n - 1] || "").trim();
}

// Split a line into words, for DISPLAY only (labels, colours, which wires to light).
export function words(text) {
  return text.toUpperCase().split(/[\s,]+/).filter(Boolean);
}

// The line that runs after step k, read from result.txt:
// the next STEP's line, or the error line for ERRSTOP, else null.
export function nextLine(k) {
  const r = state.result;
  if (!r) return null;
  if (k < r.steps.length) return r.steps[k].line;
  if (r.end.type === "ERRSTOP") return r.end.value;
  return null;
}

// Everything the UI shows about step k (k >= 1), derived from result.txt data.
export function describeStep(k) {
  const before = stateAt(k - 1);
  const after = stateAt(k);
  const text = lineText(after.line);
  const [op = "", a = "", b = ""] = words(text);
  const next = nextLine(k);
  const isJump = op === "JMP" || op === "JZ" || op === "JNZ";
  const target = isJump ? parseInt(a, 10) : null;
  return {
    k, line: after.line, text, op, a, b, before, after, next, isJump, target,
    taken: isJump && next === target,                       // the data shows where it went
    changed: [0, 1, 2, 3].filter((i) => before.regs[i] !== after.regs[i]),
    zfChanged: before.zf !== after.zf,
  };
}

// Error code on line n (from the ERR lines), or 0.
export function errorOnLine(n) {
  const r = state.result;
  if (!r) return 0;
  const e = r.errors.find((x) => x.line === n);
  return e ? e.code : 0;
}
