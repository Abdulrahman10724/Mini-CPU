// charts.js - the hand-made SVG charts of §3 Analysis (no chart library).
//   registerChart(): Fig. 3, AX..DX as step lines + a ZF strip under it
//   mixBars():       Fig. 4, instruction mix as hatched horizontal bars
// Print convention: everything is ink; lines differ by PATTERN, bars by HATCHING.
// Every value drawn comes from result.txt (via the stats from analysis_stats.py).

const NS = "http://www.w3.org/2000/svg";
const REGS = ["AX", "BX", "CX", "DX"];
// line patterns: AX solid 2px, BX dashed, CX dotted, DX dash-dot
const PATTERN = { AX: "", BX: "7 4", CX: "1.5 3.5", DX: "9 3 1.5 3" };
const WIDTH = { AX: 2, BX: 1.5, CX: 1.8, DX: 1.5 };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function txt(parent, x, y, content, cls, anchor = "start") {
  const t = el("text", { x, y, class: cls, "text-anchor": anchor }, parent);
  t.textContent = content;
  return t;
}

export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "G";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return Math.round(v / 1e3) + "k";
  return String(v);
}

// About 5 "nice" tick values between lo and hi.
function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// ------------------------------------------------------------------ Fig. 3 register traces
// host: an element; stats: from analysis_stats; hooks: { describe(k), onPick(k) }
export function registerChart(host, stats, hooks) {
  host.innerHTML = "";
  const N = stats.steps;
  const W = Math.max(400, host.clientWidth);
  const H = 280, ZH = 46;
  const m = { l: 64, r: 18, t: 14, b: 40 };
  const svg = el("svg", { width: W, height: H + ZH, viewBox: `0 0 ${W} ${H + ZH}`, class: "chart", role: "img",
    "aria-label": "Register values per step" }, host);

  const all = REGS.flatMap((r) => stats.values[r]);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (lo === hi) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;
  const x = (k) => m.l + (N === 0 ? 0 : (k / N) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

  // grid + axes
  const grid = el("g", { class: "chart-grid" }, svg);
  for (const v of niceTicks(lo, hi)) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    txt(svg, m.l - 8, y(v) + 4, compact(v), "chart-tick", "end");
  }
  const every = [1, 2, 5, 10, 20, 50, 100].find((s) => (s / Math.max(N, 1)) * (W - m.l - m.r) >= 34) || 100;
  for (let k = 0; k <= N; k += every) {
    el("line", { x1: x(k), x2: x(k), y1: H - m.b, y2: H - m.b + 4, class: "chart-axis" }, svg);
    txt(svg, x(k), H - m.b + 16, String(k), "chart-tick", "middle");
  }
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "chart-axis" }, svg);
  el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "chart-axis" }, svg);
  txt(svg, W - m.r, H - m.b + 32, "step →", "chart-tick", "end");

  // one step line per register: the value holds from step k until step k + 1
  const lines = {};
  for (const r of REGS) {
    const v = stats.values[r];
    let d = `M ${x(0)} ${y(v[0])}`;
    for (let k = 1; k <= N; k++) d += ` H ${x(k)} V ${y(v[k])}`;
    lines[r] = el("path", { d, class: "reg-line", "data-reg": r, "stroke-width": WIDTH[r],
      "stroke-dasharray": PATTERN[r] }, svg);
  }

  // ZF strip: a square wave under the chart, same x axis
  const zTop = H + 8, zBot = H + ZH - 10;
  txt(svg, m.l - 8, (zTop + zBot) / 2 + 4, "ZF", "chart-label", "end");
  let zd = `M ${x(0)} ${stats.zf[0] ? zTop : zBot}`;
  for (let k = 1; k <= N; k++) zd += ` H ${x(k)} V ${stats.zf[k] ? zTop : zBot}`;
  el("path", { d: zd, class: "zf-line" }, svg);
  el("line", { x1: m.l, x2: W - m.r, y1: zBot + 4, y2: zBot + 4, class: "chart-grid-line" }, svg);

  // crosshair: vertical ink line, a ■ on every register line, and a paper-slip readout
  const cross = el("g", { class: "crosshair", visibility: "hidden" }, svg);
  const vline = el("line", { y1: m.t, y2: zBot }, cross);
  const marks = REGS.map(() => el("rect", { width: 7, height: 7, class: "cross-mark" }, cross));
  const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: zBot - m.t, class: "chart-hit" }, svg);
  const slip = document.createElement("div");
  slip.className = "slip chart-slip";
  slip.hidden = true;
  host.append(slip);

  const stepAt = (e) => {
    const r = svg.getBoundingClientRect();
    return Math.max(0, Math.min(N, Math.round(((e.clientX - r.left - m.l) / (W - m.l - m.r)) * N)));
  };
  hit.addEventListener("mousemove", (e) => {
    const k = stepAt(e);
    cross.setAttribute("visibility", "visible");
    vline.setAttribute("x1", x(k)); vline.setAttribute("x2", x(k));
    REGS.forEach((r, i) => { marks[i].setAttribute("x", x(k) - 3.5); marks[i].setAttribute("y", y(stats.values[r][k]) - 3.5); });
    slip.textContent = hooks.describe(k);
    slip.hidden = false;
    const left = Math.min(x(k) + 12, W - slip.offsetWidth - 4);
    slip.style.left = `${left}px`;
    slip.style.top = `${m.t}px`;
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); slip.hidden = true; });
  hit.addEventListener("click", (e) => hooks.onPick(stepAt(e)));

  // the legend uses the same patterns; hovering an entry dims the other lines
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = REGS.map((r) => `<button class="legend-item" data-reg="${r}">
      <svg width="34" height="10"><line x1="1" y1="5" x2="33" y2="5" stroke-width="${WIDTH[r]}"
        stroke-dasharray="${PATTERN[r]}"/></svg>${r}</button>`).join("") +
    `<span class="legend-item legend-zf"><svg width="34" height="10"><path d="M1 8 H12 V2 H23 V8 H33"/></svg>ZF</span>`;
  host.prepend(legend);
  const focus = (reg) => {
    for (const r of REGS) lines[r].classList.toggle("dim", reg !== null && r !== reg);
  };
  legend.addEventListener("mouseover", (e) => { const b = e.target.closest("[data-reg]"); if (b) focus(b.dataset.reg); });
  legend.addEventListener("mouseleave", () => focus(null));
  legend.addEventListener("focusin", (e) => { const b = e.target.closest("[data-reg]"); if (b) focus(b.dataset.reg); });
  legend.addEventListener("focusout", () => focus(null));
}

// ------------------------------------------------------------------ Fig. 4 instruction mix
// Bars filled with hatching by category instead of colours.
const FILL = { data: "url(#hatchLight)", arith: "url(#hatchDense)", compare: "url(#hatchCross)", control: "var(--ink)" };

export function mixBars(host, stats) {
  host.innerHTML = "";
  const rows = stats.mix;
  const W = Math.max(320, host.clientWidth);
  const bar = 22, gap = 10, m = { l: 52, r: 44, t: 6 };
  const H = m.t + rows.length * (bar + gap) + 4;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Instruction mix" }, host);
  const max = Math.max(1, ...rows.map((r) => r.count));
  rows.forEach((row, i) => {
    const y = m.t + i * (bar + gap);
    const w = Math.max(2, (row.count / max) * (W - m.l - m.r));
    txt(svg, m.l - 10, y + bar / 2 + 4, row.op, "chart-label", "end");
    el("rect", { x: m.l, y, width: w, height: bar, fill: FILL[row.category] || FILL.data, class: "mix-bar" }, svg);
    txt(svg, m.l + w + 8, y + bar / 2 + 4, String(row.count), "chart-value");
  });
  return svg;
}
