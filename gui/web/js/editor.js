// editor.js - the code editor (CodeMirror 5) drawn as a ruled school notebook:
// ink-weight syntax, pencil notes (inline results), the teacher's red pen for errors,
// and live mode.
//
// Live mode: Enter runs CPU.exe at once; any other edit runs it 700 ms after the
// user stops typing. The actual run is done by main.js (hooks.liveRun).

import { state, stateAt, describeStep, errorOnLine, indexes, REG_NAMES } from "./state.js";
import { errorInfo } from "./errors.js";
import { penStrokes } from "./pen.js";

const OPCODES = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT"];
const LIVE_DELAY_MS = 700;
const SVG = "http://www.w3.org/2000/svg";
const LINE_PAD = 12;        // left padding of a code line (editor.css)

let cm = null;
let hooks = null;
let liveTimer = null;
let decorations = [];       // undo functions for everything drawn by the last redraw
let lastResult;
let lastCursor = -1;
const drawnPens = new Set(); // red-pen marks already animated once (no re-animation on redraw)

// ------------------------------------------------------------------ syntax mode
// Ink weight only. Whether a line is valid is decided by CPU.exe, never here.
// Registers also get "reg-AX" etc. so linked highlighting can find every AX.
CodeMirror.defineMode("minicpu", () => ({
  startState: () => ({ word: 0 }),
  token(stream, st) {
    if (stream.sol()) st.word = 0;
    if (stream.eatSpace()) return null;
    if (stream.eat(",")) return "comma";
    const w = stream.match(/^[^\s,]+/)[0].toUpperCase();
    st.word += 1;
    if (st.word === 1 && OPCODES.includes(w)) return "opcode";
    if (st.word > 1 && REG_NAMES.includes(w)) return `register reg-${w}`;
    if (st.word > 1 && /^[-+]?\d+$/.test(w)) return "number";
    return null;
  },
}));

// ------------------------------------------------------------------ setup
export function initEditor(host, editorHooks) {
  hooks = editorHooks;
  cm = CodeMirror(host, {
    value: "",
    mode: "minicpu",
    theme: "notebook",
    lineNumbers: true,
    gutters: ["bp-gutter", "CodeMirror-linenumbers"],
    placeholder: "MOV AX, 5",
    indentUnit: 0,
    smartIndent: false,
    electricChars: false,
    lineWrapping: false,
    extraKeys: { Enter: onEnter },
  });

  cm.on("changes", (_, changes) => {
    const programmatic = changes.every((c) => c.origin === "setValue");
    hooks.onCodeChange(cm.getValue(), { programmatic });
    if (!programmatic) scheduleLiveRun();
  });
  cm.on("cursorActivity", markActiveLine);
  // the margin: line number = jump to that line's last execution; left strip = breakpoint
  cm.on("gutterClick", (_, line, gutter) => {
    if (gutter === "bp-gutter") hooks.onToggleBreakpoint(line + 1);
    else hooks.onJumpToLine(line + 1);
  });

  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener("mousemove", onHover);
  wrapper.addEventListener("mouseleave", () => { hideSlip(); hooks.onHighlight(null); });
  markActiveLine();
  return cm;
}

export function getEditor() {
  return cm;
}

export function setCode(code) {
  cm.setValue(code);
  cm.clearHistory();
}

// Insert example text on a new line below the cursor (used by the help sheet).
export function insertLine(text) {
  const line = cm.getCursor().line;
  const current = cm.getLine(line);
  if (current.trim() === "") cm.replaceRange(text, { line, ch: 0 }, { line, ch: current.length });
  else cm.replaceRange("\n" + text, { line, ch: current.length });
  cm.focus();
}

// ------------------------------------------------------------------ live mode
function onEnter(editor) {
  const lineBefore = editor.getCursor().line + 1;        // the line the user just finished
  editor.execCommand("newlineAndIndent");
  clearTimeout(liveTimer);
  hooks.liveRun(editor.getValue(), lineBefore);
}

function scheduleLiveRun() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => hooks.liveRun(cm.getValue(), cm.getCursor().line + 1), LIVE_DELAY_MS);
}

export function cancelLiveRun() {
  clearTimeout(liveTimer);
}

// ------------------------------------------------------------------ render
export function renderEditor(s, patch) {
  if (!cm) return;
  if ("running" in patch) document.getElementById("runProgress").classList.toggle("active", s.running);
  if ("code" in patch || "result" in patch) renderHeader(s);
  if (s.result !== lastResult || s.cursor !== lastCursor || "code" in patch || "breakpoints" in patch) {
    lastResult = s.result;
    lastCursor = s.cursor;
    cm.operation(redrawDecorations);
  }
}

// Program line count, counted like CPU.exe does (a final newline adds no line).
function programLineCount(code) {
  if (code === "") return 0;
  return code.replace(/\n$/, "").split("\n").length;
}

// "7 LINES · 0 ERRORS · 7/50" (the errors part in red when there are any)
function renderHeader(s) {
  const count = programLineCount(s.code);
  const errors = s.result ? s.result.errors.length : 0;
  const el = document.getElementById("programStatus");
  el.innerHTML = "";
  const part = (text, bad) => {
    const span = document.createElement("span");
    span.textContent = text;
    if (bad) span.className = "bad";
    el.append(span);
  };
  part(`${count} ${count === 1 ? "LINE" : "LINES"} · `);
  part(`${errors} ${errors === 1 ? "ERROR" : "ERRORS"}`, errors > 0);
  part(` · ${count}/50`, count >= 50);
}

function clearDecorations() {
  for (const undo of decorations) undo();
  decorations = [];
  cm.clearGutter("bp-gutter");
}

function addLineClass(line, where, cls) {
  cm.addLineClass(line, where, cls);
  decorations.push(() => cm.removeLineClass(line, where, cls));
}

function widgetAt(line, ch, el) {
  const mark = cm.setBookmark({ line, ch }, { widget: el, insertLeft: true });
  decorations.push(() => mark.clear());
}

function note(line, html, cls = "") {
  const el = document.createElement("span");
  el.className = "pencil " + cls;
  el.innerHTML = html;
  widgetAt(line, cm.getLine(line).length, el);
}

// Redraw breakpoints, the current line, pencil notes and red-pen marks for state.cursor.
function redrawDecorations() {
  clearDecorations();
  for (const n of state.breakpoints || []) {
    if (n <= cm.lineCount()) {
      const sq = document.createElement("span");
      sq.className = "bp-mark";
      sq.textContent = "■";
      cm.setGutterMarker(n - 1, "bp-gutter", sq);
    }
  }
  const r = state.result;
  if (!r) return;
  const k = state.cursor;

  // last execution (step number) and execution count of each line, up to step k
  const lastExec = new Map();
  const execCount = new Map();
  for (let i = 0; i < k && i < r.steps.length; i++) {
    const ln = r.steps[i].line;
    lastExec.set(ln, i + 1);
    execCount.set(ln, (execCount.get(ln) || 0) + 1);
  }
  const pcLine = stateAt(k).line;

  for (let n = 1; n <= cm.lineCount(); n++) {
    const idx = n - 1;
    const code = errorOnLine(n);
    if (code) {
      addLineClass(idx, "wrap", "line-error");
      redPen(idx, `${n}:${cm.getLine(idx)}:${code}`);
      note(idx, `✗ E${code} ${errorInfo(code).message}`, "pencil-err");
      continue;
    }
    if (n === pcLine) {
      addLineClass(idx, "gutter", "pc-line-gutter");
      addLineClass(idx, "background", "line-pc");
    }
    if (lastExec.has(n)) note(idx, noteHtml(lastExec.get(n), execCount.get(n)));
  }
}

// The pencil note for a line's last execution (step j), from result.txt data.
function noteHtml(j, count) {
  const d = describeStep(j);
  let html;
  if (d.op === "HLT") html = "■ HALT";
  else if (d.op === "CMP") html = `ZF ← ${d.after.zf}`;
  else if (d.isJump) html = d.taken ? `→ L${d.next}` : (d.next ? `↓ L${d.next}` : "↓");
  else {
    const reg = REG_NAMES.indexOf(d.a);
    const i = reg >= 0 ? reg : d.changed[0];
    html = i === undefined ? "" : `${REG_NAMES[i]} ← ${d.after.regs[i]}`;
  }
  if (count > 1) html += `<span class="pencil-count">×${count}</span>`;
  return html;
}

// ------------------------------------------------------------------ the red pen
// A hand-drawn ellipse around the text of an error line: two slightly different
// strokes (rotated ±2°), drawn with stroke-dashoffset the first time it appears.
function redPen(idx, key) {
  const text = cm.getLine(idx);
  const start = text.search(/\S/);
  if (start < 0) return;
  const end = text.trimEnd().length;
  const cw = cm.defaultCharWidth();
  const w = (end - start) * cw + 18;
  const h = 19;                                      // fits inside one 24px ruled line
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "red-pen" + (drawnPens.has(key) ? " drawn" : ""));
  svg.setAttribute("width", w + 8);
  svg.setAttribute("height", h + 6);
  // centre the ellipse on the text: the path's centre is at w/2 + 4 inside the svg
  svg.style.left = `${LINE_PAD + start * cw + (end - start) * cw / 2 - (w / 2 + 4)}px`;
  svg.style.top = "-1px";                            // centre on the line: (24 - (h + 6)) / 2
  penStrokes(svg, w, h);
  drawnPens.add(key);
  const holder = document.createElement("span");
  holder.className = "pen-holder";
  holder.append(svg);
  widgetAt(idx, 0, holder);
}

function markActiveLine() {
  const line = cm.getCursor().line;
  if (markActiveLine.prev !== undefined) cm.removeLineClass(markActiveLine.prev, "background", "cm-active-line");
  cm.addLineClass(line, "background", "cm-active-line");
  markActiveLine.prev = line;
}

// ------------------------------------------------------------------ linked highlight (step)
// A hovered step (waveform column / log row) underlines its line: a band, NOT the
// solid wash + ▶ of the current step, so the two never look the same.
let linkedLine = null;
export function setLinkedLine(line) {
  if (linkedLine !== null && linkedLine <= cm.lineCount()) cm.removeLineClass(linkedLine - 1, "wrap", "line-linked");
  linkedLine = line !== null && line <= cm.lineCount() ? line : null;
  if (linkedLine !== null) cm.addLineClass(linkedLine - 1, "wrap", "line-linked");
}

// ------------------------------------------------------------------ hover
// A register token -> highlight that register everywhere. Anywhere else on a line ->
// highlight the line, and show a slip: the error, or "Ran 5× · last at step 15 · AX ← 15".
function lineUnderMouse(e) {
  const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, "window");
  const box = cm.charCoords({ line: pos.line, ch: 0 }, "window");
  if (e.clientY < box.top || e.clientY > box.bottom) return null;
  return { line: pos.line + 1, box };
}

function onHover(e) {
  const token = e.target.closest && e.target.closest(".cm-register");
  const hit = lineUnderMouse(e);
  if (token) {
    const cls = [...token.classList].find((c) => c.startsWith("cm-reg-"));
    hooks.onHighlight({ kind: "reg", value: cls.slice("cm-reg-".length) });
  } else {
    hooks.onHighlight(hit && cm.getLine(hit.line - 1).trim() ? { kind: "line", value: hit.line } : null);
  }
  if (!hit || !state.result || !cm.getLine(hit.line - 1).trim()) { hideSlip(); return; }

  const code = errorOnLine(hit.line);
  if (code) {
    const info = errorInfo(code);
    showSlip(e, hit.box,
      `<div class="slip-head"><b class="slip-code">E${code}</b> ${info.message}</div>` +
      `<div class="slip-hint">${info.hint}</div>`);
    return;
  }
  // time-travel preview: how often this line ran, when it last ran, and what it did
  const runs = indexes().byLine.get(hit.line) || [];
  if (runs.length === 0) {
    showSlip(e, hit.box, `<div class="slip-head">Not run</div>`);
    return;
  }
  const last = runs[runs.length - 1];
  const did = noteHtml(last, 1).replace(/<[^>]+>/g, "");
  showSlip(e, hit.box,
    `<div class="slip-head">Ran ${runs.length}× · last at step ${last}${did ? " · " + did : ""}</div>` +
    `<div class="slip-hint">Click the line number to jump there.</div>`);
}

function showSlip(e, box, html) {
  const tip = document.getElementById("errTip");
  tip.innerHTML = html;
  const app = document.getElementById("app").getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX - app.left + 12, app.width - 330)}px`;
  tip.style.top = `${box.bottom - app.top + 6}px`;
  tip.hidden = false;
}

function hideSlip() {
  document.getElementById("errTip").hidden = true;
}
