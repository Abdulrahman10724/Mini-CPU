// history.js - the right-hand list: one row per executed step, then the END row.
// Rows are built ONCE per result (up to 500); moving the timeline only moves the
// highlight, so long programs stay smooth.

import { describeStep, REG_NAMES } from "./state.js";

let rows = [];
let currentRow = null;
let builtFor = null;
let onSelect = () => {};

export function initHistory(hooks) {
  onSelect = hooks.onSelect;
  const list = document.getElementById("historyList");
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".h-row[data-k]");
    if (row) onSelect(Number(row.dataset.k));
  });
  list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".h-row[data-k]");
    if (!row) return;
    const k = Number(row.dataset.k);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(k); }
    if (e.key === "ArrowDown" && rows[k]) { e.preventDefault(); rows[k].focus(); }
    if (e.key === "ArrowUp" && k > 1) { e.preventDefault(); rows[k - 2].focus(); }
  });
}

export function renderHistory(s) {
  if (s.result !== builtFor) build(s);
  highlight(s.cursor);
}

const escapeHtml = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// The "what changed" column, from the step's data.
function changeHtml(d) {
  if (d.op === "HLT") return `<span class="zf1">halt</span>`;
  if (d.isJump) return d.taken ? `<span class="jump">→ L${d.next}</span>` : "↓ next";
  if (d.op === "CMP") {
    const z = d.after.zf;
    return d.zfChanged ? `ZF ${d.before.zf}→<b class="${z ? "zf1" : ""}">${z}</b>` : `ZF = ${z}`;
  }
  const i = d.changed.length ? d.changed[0] : REG_NAMES.indexOf(d.a);
  if (i < 0) return "";
  if (!d.changed.length) return `<span class="reg">${REG_NAMES[i]}</span> = ${d.after.regs[i]}`;
  return `<span class="reg">${REG_NAMES[i]}</span> ${d.before.regs[i]}→<b>${d.after.regs[i]}</b>`;
}

function build(s) {
  builtFor = s.result;
  currentRow = null;
  const list = document.getElementById("historyList");
  const r = s.result;
  const N = r ? r.steps.length : 0;
  document.getElementById("stepCountChip").textContent = `${N} ${N === 1 ? "step" : "steps"}`;
  document.getElementById("historyEmpty").hidden = Boolean(r) && (N > 0 || r.end.type === "ERRSTOP");
  if (!r) { list.innerHTML = ""; rows = []; return; }

  let html = "";
  for (let k = 1; k <= N; k++) {
    const d = describeStep(k);
    html += `<li class="h-row" data-k="${k}" tabindex="-1">` +
      `<span class="h-n">#${k}</span><span class="h-line">L${d.line}</span>` +
      `<span class="h-ins">${escapeHtml(d.text)}</span><span class="h-chg">${changeHtml(d)}</span></li>`;
  }
  const end = r.end;
  const detail = end.type === "ERRSTOP" ? `line ${end.value}` : `${end.value} ${end.value === 1 ? "step" : "steps"}`;
  html += `<li class="h-row h-end"><span class="h-n">end</span>` +
    `<span><span class="end-badge end-${end.type}">${end.type}</span><span class="end-value">${detail}</span></span></li>`;
  list.innerHTML = html;
  rows = [...list.querySelectorAll(".h-row[data-k]")];
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
