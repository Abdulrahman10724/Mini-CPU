// waveform.js - Fig. 2: the signal trace, drawn like a datasheet timing diagram.
//
//   PC  AX BX CX DX : "bus" rows  -  a hexagon per value, crossing in an X where it changes
//   ZF SF CF        : single-bit square waves (high = 1)
//   JMP             : a mark ↶ at every step where a jump was taken
//
// Column k = the CPU state after step k (column 0 = the start: everything 0).
// All values come from result.txt (state.result.steps).
//
// The plot is a <canvas> (500 steps x 7 rows would be too many SVG nodes). It is
// redrawn only when the result, the zoom, the scroll position or the size changes.
// The cursor, the hover column and the red "just changed" values are DOM elements in
// an overlay, so moving the cursor never redraws the canvas.

import { state, totalSteps, describeStep } from "./state.js";

const $ = (id) => document.getElementById(id);
const ROWS = ["PC", "AX", "BX", "CX", "DX", "ZF", "SF", "CF", "JMP"];
const FLAGS = ["ZF", "SF", "CF"];
const X0 = 8;                 // left margin inside the plot
const END_W = 110;            // room after the last column for the END tag
const RULER_H = 34;           // top band: the "t = N" flag, then the step numbers
const MIN_W = 1.5, MAX_W = 64;

let hooks = null;
let data = null;              // per-result arrays, built once (see prepare)
let colW = 16;                // pixels per step (zoom)
let layout = null;            // row positions, from the plot height
let colours = null;
let builtFor;
let hoverK = null;
let dragging = false;

// ------------------------------------------------------------------ setup
export function initWaveform(waveHooks) {
  hooks = waveHooks;
  $("firstBtn").addEventListener("click", hooks.onFirst);
  $("prevBtn").addEventListener("click", hooks.onPrev);
  $("playBtn").addEventListener("click", hooks.onTogglePlay);
  $("nextBtn").addEventListener("click", hooks.onNext);
  $("lastBtn").addEventListener("click", hooks.onLast);
  $("fitBtn").addEventListener("click", () => { fit(); draw(); placeOverlay(); });

  const labels = $("traceLabels");
  labels.innerHTML = ROWS.map((r) =>
    `<div class="t-label" data-row="${r}"${r.endsWith("X") ? ` data-reg="${r}" tabindex="0"` : ""}>${r}</div>`).join("");
  // linked highlighting: hovering or focusing a register row label
  for (const el of labels.querySelectorAll("[data-reg]")) {
    const reg = el.dataset.reg;
    el.addEventListener("mouseenter", () => hooks.onRegHover(reg));
    el.addEventListener("mouseleave", () => hooks.onRegHover(null));
    el.addEventListener("focus", () => hooks.onRegHover(reg));
    el.addEventListener("blur", () => hooks.onRegHover(null));
  }

  const plot = $("tracePlot");
  plot.addEventListener("scroll", () => draw());
  plot.addEventListener("wheel", onWheel, { passive: false });
  plot.addEventListener("pointerdown", onPointerDown);
  plot.addEventListener("pointermove", onPointerMove);
  plot.addEventListener("pointerup", () => { dragging = false; });
  plot.addEventListener("pointerleave", () => setHover(null));
  plot.addEventListener("keydown", onKey);
  new ResizeObserver(() => { measure(); draw(); placeOverlay(); }).observe(plot);
  document.fonts.ready.then(() => draw());
  initResize();
}

export function renderWaveform(s) {
  const N = totalSteps();
  if (s.result !== builtFor) {
    builtFor = s.result;
    prepare(s);
    colW = N <= 60 ? 0 : 16;                       // 0 = "fit" (needs the width: measure first)
    measure();
    if (colW === 0) fit();
    draw();
  }
  placeOverlay();
  keepCursorVisible();

  $("tlPos").textContent = `STEP ${s.cursor} / ${N}`;
  const hasSteps = Boolean(s.result) && N > 0;
  $("firstBtn").disabled = !hasSteps || s.cursor === 0;
  $("prevBtn").disabled = !hasSteps || s.cursor === 0;
  $("nextBtn").disabled = Boolean(s.result) && s.cursor >= N && s.code === s.resultCode;
  $("lastBtn").disabled = !hasSteps || s.cursor === N;
  $("playBtn").disabled = !hasSteps;
  $("fitBtn").disabled = !hasSteps;
  $("playBtn").querySelector("use").setAttribute("href", s.playing ? "#i-pause" : "#i-play");
  $("playBtn").setAttribute("aria-label", s.playing ? "Pause" : "Play");
  const plot = $("tracePlot");
  plot.setAttribute("aria-valuemax", String(N));
  plot.setAttribute("aria-valuenow", String(s.cursor));
  plot.setAttribute("aria-valuetext", `Step ${s.cursor} of ${N}`);
}

// ------------------------------------------------------------------ data, once per result
function prepare(s) {
  const r = s.result;
  if (!r) { data = null; return; }
  const steps = r.steps;
  const N = steps.length;
  const vals = { PC: [null], AX: [0], BX: [0], CX: [0], DX: [0], ZF: [0], SF: [0], CF: [0] };
  const taken = [false];
  for (let k = 1; k <= N; k++) {
    const st = steps[k - 1];
    vals.PC.push(st.line); vals.AX.push(st.ax); vals.BX.push(st.bx);
    vals.CX.push(st.cx); vals.DX.push(st.dx);
    vals.ZF.push(st.zf); vals.SF.push(st.sf); vals.CF.push(st.cf);
    taken.push(describeStep(k).taken);
  }
  // runs of equal values for the bus rows: [{ s, e, v }], e exclusive
  const runs = {};
  for (const row of ["PC", "AX", "BX", "CX", "DX"]) {
    const list = [];
    for (let k = 0; k <= N; k++) {
      if (k === 0 || vals[row][k] !== vals[row][k - 1]) list.push({ s: k, e: k + 1, v: vals[row][k] });
      else list[list.length - 1].e = k + 1;
    }
    runs[row] = list;
  }
  data = { N, vals, taken, runs, end: r.end };
}

// ------------------------------------------------------------------ geometry
function measure() {
  const plot = $("tracePlot");
  const W = plot.clientWidth;
  const H = plot.clientHeight;
  const jmpH = 16;
  // 5 bus rows + 3 flag rows (each 0.7 of a bus row) + the JMP row, 2px apart:
  // fixed part = ruler + 4 + JMP row + 9 gaps; the rest is shared by 5 + 3 x 0.7 = 7.1 rows
  const fixed = RULER_H + 4 + jmpH + 9 * 2;
  const busH = Math.max(10, Math.min(34, Math.floor((H - fixed) / 7.1)));
  const zfH = Math.max(8, Math.min(22, Math.floor(busH * 0.7)));
  let y = RULER_H + 4;
  const rows = {};
  for (const r of ROWS) {
    const h = FLAGS.includes(r) ? zfH : r === "JMP" ? jmpH : busH;
    rows[r] = { y, h };
    y += h + 2;
  }
  layout = { W, H, rows };
  // keep the fixed label column lined up with the canvas rows
  for (const el of $("traceLabels").children) {
    const row = rows[el.dataset.row];
    el.style.top = `${row.y}px`;
    el.style.height = `${row.h}px`;
  }
  $("traceSpacer").style.width = `${totalWidth()}px`;
}

function totalWidth() {
  return data ? X0 + (data.N + 1) * colW + END_W : 0;
}

const colX = (k) => X0 + k * colW;
const colCentre = (k) => X0 + (k + 0.5) * colW;

function fit() {
  if (!data || !layout) return;
  colW = Math.max(MIN_W, Math.min(MAX_W, (layout.W - X0 - END_W) / (data.N + 1)));
  $("traceSpacer").style.width = `${totalWidth()}px`;
  $("tracePlot").scrollLeft = 0;
}

function columnAt(clientX) {
  const plot = $("tracePlot");
  const x = clientX - plot.getBoundingClientRect().left + plot.scrollLeft;
  return Math.max(0, Math.min(data.N, Math.floor((x - X0) / colW)));
}

// ------------------------------------------------------------------ drawing (canvas)
function readColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return { ink: v("--ink"), ink2: v("--ink-2"), ink3: v("--ink-3"), rule: v("--rule"),
    spot: v("--spot-text"), paper2: v("--paper-2") };
}

function shortValue(v) {                 // "abbreviated if too narrow"
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "G";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return Math.round(v / 1e3) + "k";
  return String(v);
}

function draw() {
  const canvas = $("traceCanvas");
  const plot = $("tracePlot");
  if (!layout) measure();
  colours = colours || readColours();
  const dpr = window.devicePixelRatio || 1;
  const W = plot.clientWidth, H = plot.clientHeight;
  const scroll = plot.scrollLeft;
  canvas.style.left = `${scroll}px`;               // the canvas stays in view; we draw the scrolled part
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, -scroll * dpr, 0);  // draw in content coordinates
  ctx.clearRect(scroll, 0, W, H);
  if (!data) return;

  const first = Math.max(0, Math.floor((scroll - X0) / colW) - 1);
  const last = Math.min(data.N, Math.ceil((scroll + W - X0) / colW) + 1);
  const { rows } = layout;
  const top = rows.PC.y, bottom = rows.JMP.y + rows.JMP.h;

  // step grid + ruler
  ctx.lineWidth = 1;
  ctx.strokeStyle = colours.rule;
  ctx.fillStyle = colours.ink3;
  ctx.font = "500 10px 'IBM Plex Mono'";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const every = [1, 2, 5, 10, 20, 50, 100].find((n) => n * colW >= 26) || 200;
  ctx.beginPath();
  for (let k = first; k <= last + 1; k++) {
    const x = Math.round(colX(k)) + 0.5;
    if (colW >= 5) { ctx.moveTo(x, top - 2); ctx.lineTo(x, bottom); }
    if (k <= data.N && k % every === 0) { ctx.moveTo(x, RULER_H - 5); ctx.lineTo(x, RULER_H); }
  }
  ctx.stroke();
  for (let k = first - (first % every); k <= last; k += every) {
    if (k >= 0) ctx.fillText(String(k), colCentre(k), RULER_H - 8);
  }

  // bus rows
  ctx.strokeStyle = colours.ink;
  ctx.font = "500 11px 'IBM Plex Mono'";
  ctx.textBaseline = "middle";
  for (const row of ["PC", "AX", "BX", "CX", "DX"]) {
    const { y, h } = rows[row];
    for (const run of data.runs[row]) {
      if (run.e <= first || run.s > last + 1) continue;
      drawBus(ctx, run, y + 2, y + h - 2, row === "PC", scroll, W);
    }
  }

  // ZF, SF, CF: square waves
  for (const flag of FLAGS) {
    const { y, h } = rows[flag];
    const hi = y + 3, lo = y + h - 3;
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    for (let k = first; k <= last; k++) {
      const yy = data.vals[flag][k] ? hi : lo;
      if (k === first) ctx.moveTo(colX(k), yy);
      else ctx.lineTo(colX(k), yy);
      ctx.lineTo(colX(k + 1), yy);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // JMP: ↶ at taken jumps
  {
    const { y, h } = rows.JMP;
    ctx.fillStyle = colours.ink;
    ctx.font = "600 12px 'IBM Plex Mono'";
    for (let k = first; k <= last; k++) {
      if (data.taken[k]) ctx.fillText("↶", colCentre(k), y + h / 2 + 1);
    }
  }

  drawEndTag(ctx);
}

// One bus value: a hexagon from column s to e, crossing its neighbours in an X.
function drawBus(ctx, run, y0, y1, isPc, scroll, W) {
  const x0 = colX(run.s), x1 = colX(run.e);
  const mid = (y0 + y1) / 2;
  if (run.v === null) {                           // PC before step 1: no value yet
    ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
    return;
  }
  const c = Math.min(4, (x1 - x0) / 2);
  ctx.beginPath();
  ctx.moveTo(x0, mid); ctx.lineTo(x0 + c, y0); ctx.lineTo(x1 - c, y0); ctx.lineTo(x1, mid);
  ctx.lineTo(x1 - c, y1); ctx.lineTo(x0 + c, y1); ctx.closePath();
  ctx.stroke();
  // the value, centred in the visible part of the hexagon, only if it fits
  const visL = Math.max(x0 + c, scroll), visR = Math.min(x1 - c, scroll + W);
  const room = visR - visL - 6;
  if (room <= 0) return;
  let text = isPc ? `L${run.v}` : String(run.v);
  if (ctx.measureText(text).width > room && !isPc) text = shortValue(run.v);
  if (ctx.measureText(text).width > room) return;
  ctx.fillStyle = colours.ink;
  ctx.fillText(text, (visL + visR) / 2, mid + 0.5);
}

// The END tag after the last column: HALT 18 / LOOP 500 / ERRSTOP L6 / NOHLT 4
function drawEndTag(ctx) {
  const { end, N } = data;
  const text = end.type === "ERRSTOP" ? `ERRSTOP L${end.value}` : `${end.type} ${end.value}`;
  const red = end.type === "ERRSTOP" || end.type === "LOOP";
  const x = colX(N + 1) + 10;
  const y = layout.rows.BX.y;
  ctx.font = "600 11px 'IBM Plex Mono'";
  ctx.textAlign = "left";
  const w = ctx.measureText(text).width + 12;
  ctx.strokeStyle = red ? colours.spot : colours.ink;
  ctx.fillStyle = red ? colours.spot : colours.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, y + 0.5, Math.round(w), 20);
  ctx.fillText(text, x + 6, y + 11);
  ctx.textAlign = "center";
}

// ------------------------------------------------------------------ overlay (DOM)
function placeOverlay() {
  const overlay = $("traceOverlay");
  overlay.style.width = `${totalWidth()}px`;
  overlay.innerHTML = "";
  if (!data || !layout) return;
  const k = state.cursor;

  // the cursor: a red line across all rows with a "t = k" flag (drawn first, so the
  // red values below sit on top of it)
  const cursor = document.createElement("div");
  cursor.className = "t-cursor";
  cursor.style.left = `${colCentre(k) - 1}px`;
  cursor.innerHTML = `<span class="t-flag">t = ${k}</span>`;
  overlay.append(cursor);

  // the red values: rows whose value changed AT the current step
  if (k > 0) {
    for (const row of ["PC", "AX", "BX", "CX", "DX"]) {
      const run = data.runs[row].find((r) => r.s === k);
      if (!run) continue;
      const x0 = colX(run.s) + 4, x1 = colX(run.e) - 4;
      const text = row === "PC" ? `L${run.v}` : String(run.v);
      if ((x1 - x0) < text.length * 6.7 + 4) continue;
      const span = document.createElement("span");
      span.className = "t-now";
      span.textContent = text;
      const { y, h } = layout.rows[row];
      span.style.left = `${(x0 + x1) / 2}px`;
      span.style.top = `${y + h / 2}px`;
      overlay.append(span);
    }
  }
  if (hoverK !== null) overlay.append(hoverBand(hoverK));
  if (extraMarks) overlay.append(extraMarks());
}

function hoverBand(k) {
  const band = document.createElement("div");
  band.className = "t-hover";
  band.style.left = `${colX(k)}px`;
  band.style.width = `${Math.max(colW, 2)}px`;
  return band;
}

function keepCursorVisible() {
  if (!data || !layout) return;
  const plot = $("tracePlot");
  const x = colCentre(state.cursor);
  const left = plot.scrollLeft, right = left + layout.W;
  if (x < left + 30 || x > right - END_W / 2) plot.scrollLeft = Math.max(0, x - layout.W / 3);
}

// ------------------------------------------------------------------ linked highlighting
// reg  -> a light band across that register's row
// line -> a small red tick on the ruler at every step where that line ran
let extraMarks = null;
export function setTraceLink(h, stepsOfLine) {
  extraMarks = null;
  if (h && h.kind === "reg" && layout) {
    extraMarks = () => {
      const { y, h: rowH } = layout.rows[h.value];
      const band = document.createElement("div");
      band.className = "t-band";
      band.style.top = `${y - 1}px`;
      band.style.height = `${rowH + 2}px`;
      return band;
    };
  } else if (h && h.kind === "line" && layout) {
    extraMarks = () => {
      const frag = document.createDocumentFragment();
      for (const k of stepsOfLine) {
        const tick = document.createElement("div");
        tick.className = "t-tick";
        tick.style.left = `${colCentre(k) - 1}px`;
        frag.append(tick);
      }
      return frag;
    };
  }
  const label = h && h.kind === "reg" ? h.value : null;
  for (const el of $("traceLabels").children) el.classList.toggle("linked", el.dataset.row === label);
  placeOverlay();
}

// Show the hover column + tooltip for step k without moving the cursor (a log row
// is hovered). null hides it.
export function previewStep(k) {
  setHover(k, true);
}

// ------------------------------------------------------------------ hover tooltip
function setHover(k, silent = false) {
  if (k === hoverK || !data) return;
  hoverK = k;
  placeOverlay();
  const tip = $("traceTip");
  if (k === null) { tip.hidden = true; if (!silent) hooks.onHover(null); return; }
  const v = data.vals;
  const where = k === 0 ? "start" : `L${v.PC[k]} ${describeStep(k).text}`;
  tip.textContent = `step ${k} · ${where} · AX ${v.AX[k]} BX ${v.BX[k]} CX ${v.CX[k]} DX ${v.DX[k]} · ZF ${v.ZF[k]} SF ${v.SF[k]} CF ${v.CF[k]}`;
  const plot = $("tracePlot");
  const trace = plot.closest(".trace").getBoundingClientRect();
  const x = plot.getBoundingClientRect().left - trace.left + colCentre(k) - plot.scrollLeft;
  tip.style.left = `${Math.min(Math.max(8, x + 10), trace.width - 460)}px`;
  tip.hidden = false;
  if (!silent) hooks.onHover(k);
}

// ------------------------------------------------------------------ input
function onPointerDown(e) {
  if (!data || e.button !== 0) return;
  const plot = $("tracePlot");
  if (e.clientY - plot.getBoundingClientRect().top > plot.clientHeight) return;   // the scrollbar
  dragging = true;
  plot.setPointerCapture(e.pointerId);
  plot.focus();
  hooks.onSeek(columnAt(e.clientX));
}

function onPointerMove(e) {
  if (!data) return;
  const k = columnAt(e.clientX);
  if (dragging) hooks.onSeek(k);
  else setHover(k);
}

// Ctrl + wheel zooms around the mouse; the wheel (or Shift + wheel) scrolls.
function onWheel(e) {
  if (!data) return;
  const plot = $("tracePlot");
  e.preventDefault();
  if (e.ctrlKey) {
    const mouse = e.clientX - plot.getBoundingClientRect().left;
    const step = (mouse + plot.scrollLeft - X0) / colW;          // the step under the mouse
    colW = Math.max(MIN_W, Math.min(MAX_W, colW * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    $("traceSpacer").style.width = `${totalWidth()}px`;
    plot.scrollLeft = X0 + step * colW - mouse;                    // keep it under the mouse
    draw();
    placeOverlay();
  } else {
    plot.scrollLeft += e.deltaY + e.deltaX;
  }
}

function onKey(e) {
  if (!data) return;
  const map = { ArrowLeft: state.cursor - 1, ArrowRight: state.cursor + 1, Home: 0, End: data.N };
  if (e.key in map) {
    e.preventDefault();
    e.stopPropagation();
    hooks.onSeek(Math.max(0, Math.min(data.N, map[e.key])));
  }
}

// ------------------------------------------------------------------ resizable panel (180..400 px)
function initResize() {
  const handle = $("traceResize");
  const setHeight = (h) => {
    h = Math.max(180, Math.min(400, Math.round(h)));
    document.getElementById("app").style.setProperty("--trace-h", `${h}px`);
    try { localStorage.setItem("traceHeight", String(h)); } catch (_) { /* storage off: fine */ }
  };
  try { const saved = Number(localStorage.getItem("traceHeight")); if (saved) setHeight(saved); } catch (_) { /* */ }
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = $("tracePlot").closest(".trace").getBoundingClientRect().height;
    const move = (ev) => setHeight(startH - (ev.clientY - startY));
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("keydown", (e) => {
    const h = $("tracePlot").closest(".trace").getBoundingClientRect().height;
    if (e.key === "ArrowUp") { setHeight(h + 20); e.preventDefault(); }
    if (e.key === "ArrowDown") { setHeight(h - 20); e.preventDefault(); }
  });
}
