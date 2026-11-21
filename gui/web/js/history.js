// history.js - the execution log: a ruled table  # · L · INSTRUCTION · Δ,
// one row per executed step, then the END row.
// Rows are built ONCE per result (up to 500); moving the cursor only moves the
// "current" mark, so long programs stay smooth.

import { describeStep, indexes, REG_NAMES } from "./state.js";
import { compact } from "./charts.js";

let rows = [];
let currentRow = null;
let builtFor;
let hooks = null;
let marked = [];

export function initHistory(historyHooks) {
  hooks = historyHooks;
  const list = document.getElementById("historyList");
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".log-row[data-k]");
    if (row) hooks.onSelect(Number(row.dataset.k));
  });
  list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".log-row[data-k]");
    if (!row) return;
    const k = Number(row.dataset.k);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hooks.onSelect(k); }
    if (e.key === "ArrowDown" && rows[k]) { e.preventDefault(); rows[k].focus(); }
    if (e.key === "ArrowUp" && k > 1) { e.preventDefault(); rows[k - 2].focus(); }
  });
  // linked highlighting: a register name -> that register; anywhere else -> that step
  list.addEventListener("mouseover", (e) => {
    const reg = e.target.closest("[data-reg]");
    const row = e.target.closest(".log-row[data-k]");
    if (reg) hooks.onHighlight({ kind: "reg", value: reg.dataset.reg });
    else if (row) hooks.onHighlight({ kind: "step", value: Number(row.dataset.k) });
  });
  list.addEventListener("mouseleave", () => hooks.onHighlight(null));
  list.addEventListener("focusin", (e) => {
    const row = e.target.closest(".log-row[data-k]");
    if (row) hooks.onHighlight({ kind: "step", value: Number(row.dataset.k) });
  });
  list.addEventListener("focusout", () => hooks.onHighlight(null));
}

export function renderHistory(s) {
  if (s.result !== builtFor) build(s);
  highlight(s.cursor);
}

const escapeHtml = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const regTag = (i) => `<span class="reg" data-reg="${REG_NAMES[i]}">${REG_NAMES[i]}</span>`;

// The Δ column: what this step changed, from the step's data.
function changeHtml(d) {
  if (d.op === "HLT") return "■ HALT";
  if (d.isJump) return d.taken ? `→ L${d.next}` : "↓";
  // flags that changed: "SF↑ CF↑" (↑ = became 1, ↓ = became 0)
  const flags = d.flagsChanged.map((f) => `<span class="flag-chg">${f}${d.after[f.toLowerCase()] ? "↑" : "↓"}</span>`).join(" ");
  if (d.op === "CMP") return flags || `ZF ${d.after.zf}`;
  const i = d.changed.length ? d.changed[0] : REG_NAMES.indexOf(d.a);
  if (i < 0) return flags;
  // with flag changes next to it, big values are shortened (2147483647 -> 2.1G) to fit
  const v = (x) => (flags ? compact(x) : x);
  const reg = d.changed.length ? `${regTag(i)} ${v(d.before.regs[i])}→<b>${v(d.after.regs[i])}</b>` : `${regTag(i)} ${v(d.after.regs[i])}`;
  return flags ? `${reg} ${flags}` : reg;
}

function build(s) {
  builtFor = s.result;
  currentRow = null;
  marked = [];
  const list = document.getElementById("historyList");
  const r = s.result;
  const N = r ? r.steps.length : 0;
  document.getElementById("stepCountChip").textContent = `${N} ${N === 1 ? "STEP" : "STEPS"}`;
  document.getElementById("historyEmpty").hidden = Boolean(r) && (N > 0 || r.end.type === "ERRSTOP");
  if (!r) { list.innerHTML = ""; rows = []; return; }

  let html = "";
  for (let k = 1; k <= N; k++) {
    const d = describeStep(k);
    const chg = d.changed.map((i) => REG_NAMES[i]).join(" ");
    html += `<li class="log-row" data-k="${k}" data-line="${d.line}" data-chg="${chg}" tabindex="-1">` +
      `<span class="c-n">${k}</span><span class="c-l">L${d.line}</span>` +
      `<span class="c-ins">${escapeHtml(d.text)}</span><span class="c-d">${changeHtml(d)}</span></li>`;
  }
  const end = r.end;
  const detail = end.type === "ERRSTOP" ? `L${end.value}` : `${end.value}`;
  const red = end.type === "ERRSTOP" || end.type === "LOOP" ? " end-red" : "";
  html += `<li class="log-end"><span class="end-tag${red}">${end.type} ${detail}</span></li>`;
  list.innerHTML = html;
  rows = [...list.querySelectorAll(".log-row[data-k]")];
}

function highlight(k) {
  if (currentRow) { currentRow.classList.remove("current"); currentRow.tabIndex = -1; currentRow.removeAttribute("aria-current"); }
  currentRow = rows[k - 1] || null;
  if (rows[0]) rows[0].tabIndex = 0;                     // the list is reachable with Tab
  if (!currentRow) return;
  currentRow.classList.add("current");
  currentRow.tabIndex = 0;
  currentRow.setAttribute("aria-current", "step");
  currentRow.scrollIntoView({ block: "nearest" });
}

// Linked highlighting: mark the rows of every step that ran `line` (null = none).
export function markLineRows(line) {
  for (const row of marked) row.classList.remove("linked");
  marked = [];
  if (line === null) return;
  for (const k of indexes().byLine.get(line) || []) {
    const row = rows[k - 1];
    if (row) { row.classList.add("linked"); marked.push(row); }
  }
}
