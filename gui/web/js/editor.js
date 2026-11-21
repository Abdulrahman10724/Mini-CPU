// editor.js - the code editor (CodeMirror 5) drawn as a ruled school notebook:
// ink-weight syntax, pencil notes (inline results), the teacher's red pen for errors,
// and live mode.
//
// Live mode: CPU.exe runs only after the user STOPS typing for 900 ms (every key,
// Enter too, restarts the timer). While waiting, the old results stay visible but
// dimmed, and the line being typed shows no error. The run itself is in main.js.

import { state, stateAt, describeStep, errorOnLine, indexes, REG_NAMES, splitLabel, labelsIn, words } from "./state.js";
import { errorInfo } from "./errors.js";
import { penStrokes } from "./pen.js";

const OPCODES = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT"];
const LIVE_DELAY_MS = 900;
const SVG = "http://www.w3.org/2000/svg";
const LINE_PAD = 12;        // left padding of a code line (editor.css)

let cm = null;
let hooks = null;
let liveTimer = null;
let decorations = [];       // undo functions for everything drawn by the last redraw
let lastResult;
let lastCursor = -1;
let waiting = false;        // edited since the last result: what is shown is "old"
let lastEditLine = 1;       // the line of the latest edit (for the live replay)
const drawnPens = new Set(); // red-pen marks already animated once (no re-animation on redraw)

// ------------------------------------------------------------------ syntax mode
// Ink weight only. Whether a line is valid is decided by CPU.exe, never here.
// Registers also get "reg-AX" etc. so linked highlighting can find every AX.
CodeMirror.defineMode("minicpu", () => ({
  startState: () => ({ word: 0, label: false }),
  token(stream, st) {
    if (stream.sol()) { st.word = 0; st.label = false; }
    if (stream.eatSpace()) return null;
    if (stream.eat(",")) return "comma";
    // a label at the start of the line ("L1:"), ink italic with its colon
    if (st.word === 0 && !st.label && stream.match(/^[^\s,:]*:/)) { st.label = true; return "label"; }
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
  });

  cm.on("changes", (_, changes) => {
    const programmatic = changes.every((c) => c.origin === "setValue");
    hooks.onCodeChange(cm.getValue(), { programmatic });
    if (!programmatic) {
      lastEditLine = changes[changes.length - 1].from.line + 1;
      setWaiting(true);
      scheduleLiveRun();
    }
  });
  cm.on("cursorActivity", () => {
    markActiveLine();
    if (waiting) cm.operation(redrawDecorations);   // the hidden error follows the cursor
  });
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
// Debounce: every edit restarts the 900 ms timer; CPU.exe runs when it finally fires.
function scheduleLiveRun() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    Promise.resolve(hooks.liveRun(cm.getValue(), lastEditLine)).finally(() => {
      // nothing new typed and no run busy: stop waiting (e.g. engine missing)
      if (liveTimer === null && !state.running) setWaiting(false);
    });
  }, LIVE_DELAY_MS);
}

export function cancelLiveRun() {
  clearTimeout(liveTimer);
  liveTimer = null;
}

// Waiting = results on screen belong to older code: dim them and show "…".
function setWaiting(on) {
  if (waiting === on) return;
  waiting = on;
  const wrapper = cm.getWrapperElement();
  wrapper.classList.toggle("stale", on);
  if (!on) {                                   // new results: fade back in (200 ms)
    wrapper.classList.remove("fresh");
    void wrapper.offsetWidth;
    wrapper.classList.add("fresh");
  }
  renderHeader(state);
  cm.operation(redrawDecorations);
}

// ------------------------------------------------------------------ render
export function renderEditor(s, patch) {
  if (!cm) return;
  if ("running" in patch) document.getElementById("runProgress").classList.toggle("active", s.running);
  if ("result" in patch && liveTimer === null) setWaiting(false);   // the new result arrived
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
  if (waiting) { el.textContent = "…"; el.title = "Waiting for you to stop typing"; return; }
  el.title = "";
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
  const typingLine = waiting ? cm.getCursor().line + 1 : 0;   // no error shown here while typing

  for (let n = 1; n <= cm.lineCount(); n++) {
    const idx = n - 1;
    const code = errorOnLine(n);
    if (code) {
      if (n === typingLine) continue;
      addLineClass(idx, "wrap", "line-error");
      redPen(idx, code);
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
// A hand-drawn ellipse around the FAULTY TOKEN of an error line (two slightly
// different strokes, drawn with stroke-dashoffset the first time it appears).
// Which token to circle is chosen only for display; CPU.exe decided the error.
const OPERANDS = { MOV: 2, ADD: 2, SUB: 2, CMP: 2, INC: 1, DEC: 1, JMP: 1, JZ: 1, JNZ: 1, HLT: 0 };

// The character range to circle: { s, e } (e exclusive), or { s, dot: true } for a
// small circle (missing operand: at the end of the line).
function penTarget(text, code) {
  const { rest, restStart } = splitLabel(text);
  const labelBox = restStart ? { s: text.search(/\S/), e: restStart } : null;   // "L1:" incl. colon
  const words = [...rest.matchAll(/[^\s,]+/g)].map((m) => ({ s: restStart + m.index, e: restStart + m.index + m[0].length, w: m[0].toUpperCase() }));
  if (code === 12 && labelBox) {                     // bad name, or a second label ("X: Y:")
    const name = text.slice(labelBox.s, labelBox.e - 1).toUpperCase();
    const nameOk = /^[A-Z][A-Z0-9_]{0,11}$/.test(name) && !OPCODES.includes(name) && !REG_NAMES.includes(name);
    const second = words.find((w) => w.w.includes(":"));
    return nameOk && second ? second : labelBox;
  }
  if (code === 11 && labelBox) return labelBox;      // duplicate: circle the label
  if (words.length === 0) return labelBox;
  const whole = { s: words[0].s, e: words[words.length - 1].e };
  const isJump = ["JMP", "JZ", "JNZ"].includes(words[0].w);
  switch (code) {
    case 10: return words[1] || whole;                                   // the undefined label
    case 1: return words[0];                                             // unknown opcode
    case 8: return words[1] || whole;                                    // first operand not a register
    case 2: return words[1] && !REG_NAMES.includes(words[1].w) ? words[1] : words[2] || whole;
    case 5: case 6: return (isJump ? words[1] : words[2]) || whole;      // the number
    case 3: return { s: text.trimEnd().length + 1, dot: true };          // something is missing here
    case 4: {                                                            // the extra operand(s)
      const first = words[(OPERANDS[words[0].w] ?? 0) + 1];
      return first ? { s: first.s, e: words[words.length - 1].e } : whole;
    }
    default: return whole;
  }
}

function redPen(idx, code) {
  const text = cm.getLine(idx);
  const t = penTarget(text, code);
  if (!t) return;
  const cw = cm.defaultCharWidth();
  const w = t.dot ? 14 : Math.max(18, (t.e - t.s) * cw + 12);
  const h = t.dot ? 14 : 19;                           // fits inside one 24px ruled line
  const centre = t.dot ? (t.s + 0.5) * cw : ((t.s + t.e) / 2) * cw;
  const key = `${idx}:${text}:${code}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "red-pen" + (drawnPens.has(key) ? " drawn" : ""));
  svg.setAttribute("width", w + 8);
  svg.setAttribute("height", h + 6);
  // the path's centre is at (w/2 + 4, h/2 + 3) inside the svg
  svg.style.left = `${LINE_PAD + centre - (w / 2 + 4)}px`;
  svg.style.top = `${(24 - (h + 6)) / 2}px`;
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
    const labels = labelsIn(cm.getValue());
    const info = errorInfo(code, { labelUsed: words(cm.getLine(hit.line - 1)).slice(1).some((w) => labels.has(w)) });
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

// The slip never covers code or margin notes: it opens just OUTSIDE the notebook's
// right margin, with its bottom edge at the top of the hovered line (or below the
// line when there is no room above).
function showSlip(e, box, html) {
  const tip = document.getElementById("errTip");
  tip.innerHTML = html;
  tip.hidden = false;
  const app = document.getElementById("app").getBoundingClientRect();
  const notebook = cm.getWrapperElement().getBoundingClientRect();
  tip.style.left = `${notebook.right - app.left + 10}px`;
  const above = box.top - app.top - tip.offsetHeight - 2;
  tip.style.top = `${above >= notebook.top - app.top ? above : box.bottom - app.top + 2}px`;
}

function hideSlip() {
  document.getElementById("errTip").hidden = true;
}
