// editor.js - the code editor (CodeMirror 5): syntax colours, gutters,
// inline results next to each line, error marks, and live mode.
//
// Live mode: Enter runs CPU.exe at once; any other edit runs it 700 ms after the
// user stops typing. The actual run is done by main.js (hooks.liveRun).

import { state, stateAt, describeStep, errorOnLine, REG_NAMES } from "./state.js";
import { errorInfo } from "./errors.js";

const OPCODES = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT"];
const REGISTERS = ["AX", "BX", "CX", "DX"];
const LIVE_DELAY_MS = 700;

let cm = null;
let hooks = null;
let liveTimer = null;
let decorations = [];       // things to remove before the next redraw
let lastResult = undefined;
let lastCursor = -1;

// ------------------------------------------------------------------ syntax mode
// Colours only. Whether a line is valid is decided by CPU.exe, never here.
CodeMirror.defineMode("minicpu", () => ({
  startState: () => ({ word: 0 }),
  token(stream, st) {
    if (stream.sol()) st.word = 0;
    if (stream.eatSpace()) return null;
    if (stream.eat(",")) return "comma";
    const w = stream.match(/^[^\s,]+/)[0].toUpperCase();
    st.word += 1;
    if (st.word === 1 && OPCODES.includes(w)) return "opcode";
    if (st.word > 1 && REGISTERS.includes(w)) return "register";
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
    theme: "minicpu",
    lineNumbers: true,
    gutters: ["CodeMirror-linenumbers", "cpu-status-gutter"],
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
    updateGhostColumn();
    if (!programmatic) scheduleLiveRun();
  });
  cm.on("cursorActivity", markActiveLine);

  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener("mousemove", showErrorTip);
  wrapper.addEventListener("mouseleave", hideErrorTip);
  markActiveLine();
  updateGhostColumn();
  return cm;
}

export function setCode(code) {
  cm.setValue(code);
  cm.clearHistory();
}

export function focusEditor() {
  cm.focus();
}

// Insert example text on a new line below the cursor (used by the help drawer).
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
  if ("running" in patch) {
    document.getElementById("runProgress").classList.toggle("active", s.running);
  }
  if ("code" in patch || "result" in patch) renderHeader(s);
  if (s.result !== lastResult || s.cursor !== lastCursor || "code" in patch) {
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

function renderHeader(s) {
  const count = programLineCount(s.code);
  const counter = document.getElementById("lineCount");
  counter.textContent = `${count} / 50`;
  counter.classList.toggle("warn", count >= 45 && count < 50);
  counter.classList.toggle("full", count >= 50);

  const chip = document.getElementById("parseChip");
  if (!s.result) { chip.hidden = true; return; }
  chip.hidden = false;
  const n = s.result.errors.length;
  if (n === 0) {
    chip.className = "chip chip-ok";
    chip.textContent = `✓ ${count} ${count === 1 ? "line" : "lines"} · no errors`;
  } else {
    chip.className = "chip chip-err";
    chip.textContent = `${n} ${n === 1 ? "error" : "errors"}`;
  }
}

function clearDecorations() {
  for (const d of decorations) d();
  decorations = [];
  cm.clearGutter("cpu-status-gutter");
}

function addLineClass(line, where, cls) {
  cm.addLineClass(line, where, cls);
  decorations.push(() => cm.removeLineClass(line, where, cls));
}

function gutterMark(line, cls) {
  const el = document.createElement("span");
  el.className = "st-mark " + cls;
  cm.setGutterMarker(line, "cpu-status-gutter", el);
}

function ghost(line, html) {
  const el = document.createElement("span");
  el.className = "ghost";
  el.innerHTML = html;
  const mark = cm.setBookmark({ line, ch: cm.getLine(line).length }, { widget: el, insertLeft: true });
  decorations.push(() => mark.clear());
}

// Redraw status marks + inline results for timeline position state.cursor.
function redrawDecorations() {
  clearDecorations();
  const r = state.result;
  if (!r) return;
  const k = state.cursor;
  const lineCount = cm.lineCount();
  const resultLines = state.resultCode.split("\n");

  // last execution (step number) and execution count of each line, up to step k
  const lastExec = new Map();
  const execCount = new Map();
  for (let i = 0; i < k && i < r.steps.length; i++) {
    const ln = r.steps[i].line;
    lastExec.set(ln, i + 1);
    execCount.set(ln, (execCount.get(ln) || 0) + 1);
  }
  const pcLine = stateAt(k).line;

  for (let n = 1; n <= lineCount; n++) {
    const idx = n - 1;
    const code = errorOnLine(n);
    const isEmpty = (resultLines[idx] || "").trim() === "" || n > resultLines.length;

    if (code) {
      gutterMark(idx, "st-err");
      addLineClass(idx, "wrap", "line-error");
      const m = cm.markText({ line: idx, ch: 0 }, { line: idx, ch: cm.getLine(idx).length },
                            { className: "cm-err-text" });
      decorations.push(() => m.clear());
      ghost(idx, `<span class="g-err">${errorInfo(code).message}</span>`);
      continue;
    }
    if (n === pcLine) {
      gutterMark(idx, "st-pc");
      addLineClass(idx, "gutter", "pc-line-gutter");
      addLineClass(idx, "background", "line-pc");
    } else if (!isEmpty) {
      gutterMark(idx, "st-ok");
    }
    if (lastExec.has(n)) ghost(idx, ghostHtml(lastExec.get(n), execCount.get(n)));
  }
}

// Inline result of a line's last execution (step j), from result.txt data.
function ghostHtml(j, count) {
  const d = describeStep(j);
  let html;
  if (d.op === "HLT") {
    html = `<span class="g-halt">■ halt</span>`;
  } else if (d.op === "CMP") {
    html = `<span class="g-reg">ZF</span> = <span class="${d.after.zf ? "g-zf1" : "g-val"}">${d.after.zf}</span>`;
  } else if (d.isJump) {
    html = d.taken ? `<span class="g-jump">→ L${d.next}</span>` : `<span class="g-fall">↓</span>`;
  } else {
    const reg = REG_NAMES.indexOf(d.a);
    const i = reg >= 0 ? reg : d.changed[0];
    html = i === undefined ? "" :
      `<span class="g-reg">${REG_NAMES[i]}</span> = <span class="g-val">${d.after.regs[i]}</span>`;
  }
  if (count > 1) html += ` <span class="g-count">×${count}</span>`;
  return html;
}

// Inline results start in one column, 3 characters right of the longest line.
function updateGhostColumn() {
  let longest = 14;
  cm.eachLine((h) => { longest = Math.max(longest, h.text.length); });
  const px = 12 + (longest + 3) * cm.defaultCharWidth();
  cm.getWrapperElement().style.setProperty("--ghost-left", `${Math.round(px)}px`);
}

function markActiveLine() {
  const line = cm.getCursor().line;
  if (markActiveLine.prev !== undefined) cm.removeLineClass(markActiveLine.prev, "background", "cm-active-line");
  cm.addLineClass(line, "background", "cm-active-line");
  markActiveLine.prev = line;
}

// ------------------------------------------------------------------ error tooltip
function showErrorTip(e) {
  const tip = document.getElementById("errTip");
  const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, "window");
  const n = pos.line + 1;
  const code = errorOnLine(n);
  const lineBox = cm.charCoords({ line: pos.line, ch: 0 }, "window");
  const insideLine = e.clientY >= lineBox.top && e.clientY <= lineBox.bottom;
  if (!code || !insideLine) { tip.hidden = true; return; }
  const info = errorInfo(code);
  tip.innerHTML =
    `<div class="err-tip-head"><span class="err-tip-code">E${code}</span>` +
    `<span class="err-tip-msg">${info.message}</span></div>` +
    `<p class="err-tip-hint">${info.hint}</p>`;
  const app = document.getElementById("app").getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX - app.left + 12, app.width - 320)}px`;
  tip.style.top = `${lineBox.bottom - app.top + 6}px`;
  tip.hidden = false;
}

function hideErrorTip() {
  document.getElementById("errTip").hidden = true;
}
