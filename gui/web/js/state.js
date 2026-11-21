// state.js - the ONE state object of the editor page.
// Every component renders from it. Components never talk to each other directly:
// they call update(), and update() tells every subscriber what changed.
//
// All CPU facts (register values, ZF/SF/CF, which line ran, errors, how it ended) come
// from result.txt via state.result. The helpers below only LOOK UP that data.

// The instruction names and which ones are jumps (display only; CPU.asm decides).
export const OPCODES = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT", "JS", "JNS", "JC", "JNC"];
export const JUMP_OPS = ["JMP", "JZ", "JNZ", "JS", "JNS", "JC", "JNC"];
export const FLAG_NAMES = ["ZF", "SF", "CF"];
// The flag a conditional jump reads, and the value that makes it jump.
export const JUMP_COND = { JZ: ["ZF", 1], JNZ: ["ZF", 0], JS: ["SF", 1], JNS: ["SF", 0], JC: ["CF", 1], JNC: ["CF", 0] };

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
  speed: "1",               // "0.25" | "0.5" | "1" | "2" (shown); "instant" = internal (dev scripts)
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
  if (k <= 0 || steps.length === 0) return { k: 0, regs: [0, 0, 0, 0], zf: 0, sf: 0, cf: 0, line: null };
  const s = steps[Math.min(k, steps.length) - 1];
  return { k, regs: [s.ax, s.bx, s.cx, s.dx], zf: s.zf, sf: s.sf, cf: s.cf, line: s.line };
}

// Line n of the program that produced the result (1-based), trimmed.
export function lineText(n) {
  if (!n) return "";
  const lines = state.resultCode.split("\n");
  return (lines[n - 1] || "").trim();
}

// ------------------------------------------------------------------ labels (display only)
// "L1: ADD AX, CX" -> label "L1". CPU.exe already resolved every jump (PASS 1/2 in
// CPU.asm) and result.txt only has line numbers; the GUI reads labels only to SHOW them.
const LABEL_AT_START = /^\s*([^\s,:]*):/;

// { label: "L1" or null, rest: "ADD AX, CX", restStart: index where rest begins }
export function splitLabel(text) {
  const m = text.match(LABEL_AT_START);
  return m ? { label: m[1].toUpperCase(), rest: text.slice(m[0].length), restStart: m[0].length }
           : { label: null, rest: text, restStart: 0 };
}

// Map NAME -> line number (first definition wins, like CPU.asm), for lines of text.
const labelCache = { code: null, map: new Map() };
export function labelsIn(code) {
  if (labelCache.code === code) return labelCache.map;
  const map = new Map();
  code.split("\n").forEach((t, i) => {
    const { label } = splitLabel(t);
    if (label && !map.has(label)) map.set(label, i + 1);
  });
  labelCache.code = code;
  labelCache.map = map;
  return map;
}

// The line a jump operand points to: a line number, or a label's line (null if unknown).
export function jumpTargetOf(word, code) {
  if (/^[-+]?\d+$/.test(word)) return parseInt(word, 10);
  return labelsIn(code).get(word.toUpperCase()) ?? null;
}

// Where execution continues after going to line n: empty and label-only lines make no
// STEP, so it is the first non-empty line from n on (null = past the last line).
function landing(n, lines) {
  while (n >= 1 && n <= lines.length && words(lines[n - 1]).length === 0) n++;
  return n >= 1 && n <= lines.length ? n : null;
}

// Did the jump on `line` (operand `a`) go to its target? Read from the data: `next` is
// the line result.txt ran after it. Same rule as gui/analysis_stats.py.
export function jumpTaken(op, a, line, next, code) {
  const target = jumpTargetOf(a, code);
  if (target === null) return false;
  const lines = code.split("\n");
  const goesTo = landing(target, lines);
  const fallsTo = landing(line + 1, lines);
  return next === goesTo && (goesTo !== fallsTo || op === "JMP");
}

// Split a line into words, for DISPLAY only (colours, which wires to light).
// A label in front ("L1:") is not a word of the instruction.
export function words(text) {
  return splitLabel(text).rest.toUpperCase().split(/[\s,]+/).filter(Boolean);
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
  const isJump = JUMP_OPS.includes(op);
  const target = isJump ? jumpTargetOf(a, state.resultCode || "") : null;
  return {
    k, line: after.line, text, op, a, b, before, after, next, isJump, target,
    taken: isJump && jumpTaken(op, a, after.line, next, state.resultCode || ""),   // from the data
    changed: [0, 1, 2, 3].filter((i) => before.regs[i] !== after.regs[i]),
    zfChanged: before.zf !== after.zf,
    // flags that changed in this step, e.g. ["SF", "CF"]
    flagsChanged: FLAG_NAMES.filter((f) => before[f.toLowerCase()] !== after[f.toLowerCase()]),
  };
}

// Error code on line n (from the ERR lines), or 0.
export function errorOnLine(n) {
  const r = state.result;
  if (!r) return 0;
  const e = r.errors.find((x) => x.line === n);
  return e ? e.code : 0;
}

// Look-up tables built ONCE per result, so linked highlighting stays fast at 500 steps:
//   byLine.get(3) -> [3, 6, 9, ...]   steps that executed line 3
//   byReg.AX      -> [1, 3, 6, ...]   steps that changed AX
let indexCache = { result: undefined, byLine: new Map(), byReg: {} };

export function indexes() {
  if (indexCache.result === state.result) return indexCache;
  const byLine = new Map();
  const byReg = { AX: [], BX: [], CX: [], DX: [] };
  const steps = state.result ? state.result.steps : [];
  steps.forEach((st, i) => {
    const k = i + 1;
    if (!byLine.has(st.line)) byLine.set(st.line, []);
    byLine.get(st.line).push(k);
    const before = stateAt(k - 1).regs;
    [st.ax, st.bx, st.cx, st.dx].forEach((v, r) => { if (v !== before[r]) byReg[REG_NAMES[r]].push(k); });
  });
  indexCache = { result: state.result, byLine, byReg };
  return indexCache;
}
