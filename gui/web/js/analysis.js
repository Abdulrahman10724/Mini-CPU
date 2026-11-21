// analysis.js - §3 ANALYSIS: the "characterization report" of the last run.
// All numbers come from api.analysis() (gui/analysis_stats.py), i.e. they are
// counts of what result.txt says. This file only lays them out and draws them.

import { api } from "./api.js";
import { registerChart, mixBars } from "./charts.js";
import { programProfile } from "./profile.js";

const $ = (id) => document.getElementById(id);

let hooks = null;
let renderedFor;            // the result object the page was built for
let stats = null;

export function initAnalysis(analysisHooks) {
  hooks = analysisHooks;
  window.addEventListener("resize", () => { if (stats && hooks.isVisible()) drawCharts(); });
}

// Called when §3 is shown (and when the result changes while it is shown).
export async function renderAnalysis(s) {
  const page = $("pageAnalysis");
  if (!s.result) {
    renderedFor = null;
    page.innerHTML = `<div class="slip an-empty"><p>No characterization data. Run a program in §2 Workbench first.</p>
      <button class="ctl" id="anGoWb">GO TO WORKBENCH →</button></div>`;
    $("anGoWb").addEventListener("click", () => hooks.goWorkbench());
    return;
  }
  if (renderedFor === s.result) return;
  renderedFor = s.result;
  const res = await api.analysis();
  if (!res.ok) return;
  stats = res.stats;
  build(s, res);
}

const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function build(s, res) {
  const st = stats;
  const end = st.end;
  $("pageAnalysis").innerHTML = `
    <div class="an-wrap">
      <header class="an-head">
        <div>
          <h1 class="an-title">Execution Characteristics</h1>
          <p class="an-sub">Program <code>${esc(s.fileName)}</code> · run at ${res.time} · ${st.steps} ${st.steps === 1 ? "step" : "steps"} · ${end.type}</p>
        </div>
        <div class="an-actions">
          <button class="btn-outline" id="anExport">EXPORT TRACE…</button>
          <button class="btn-outline" id="anPrint">PRINT REPORT</button>
        </div>
      </header>
      <div class="print-head" aria-hidden="true">
        <div class="print-title">MINI-CPU · Execution report</div>
        <div>Program ${esc(s.fileName)} · ${res.date} ${res.time} · Group BDS-3A-07</div>
        <div>Abdul Rahman 25K-2508 · Muhammad Salman 25K-2509 · Shahmir Shahid 25K-2510</div>
      </div>

      <div class="an-grid">
        <section class="an-block an-t1">
          <p class="tcaption">Table 1 — Summary of the last run.</p>
          <table class="sheet-table an-table">
            <thead><tr><th>Parameter</th><th>Value</th><th>Note</th></tr></thead>
            <tbody>${summaryRows(st)}</tbody>
          </table>
        </section>
        <figure class="an-block an-fig4">
          <div class="chart-host" id="fig4"></div>
          <div class="mix-key" aria-hidden="true">
            <span><svg width="22" height="12"><rect width="22" height="12" fill="url(#hatchLight)"/></svg>data</span>
            <span><svg width="22" height="12"><rect width="22" height="12" fill="url(#hatchDense)"/></svg>arithmetic</span>
            <span><svg width="22" height="12"><rect width="22" height="12" fill="url(#hatchCross)"/></svg>compare</span>
            <span><svg width="22" height="12"><rect width="22" height="12" fill="#1B1A17"/></svg>control</span>
          </div>
          <figcaption class="caption">Fig. 4 — Instruction mix: how many steps ran each instruction.</figcaption>
        </figure>
        <figure class="an-block an-fig3">
          <div class="chart-host" id="fig3"></div>
          <figcaption class="caption">Fig. 3 — Register values per step (AX solid, BX dashed, CX dotted,
            DX dash-dot) with the Zero Flag below. Hover to read a step; click to open it in §2.</figcaption>
        </figure>
        <figure class="an-block an-fig5">
          <div id="fig5"></div>
          <figcaption class="caption">Fig. 5 — Program profile. Bars: how often each line ran.
            Arrows: jumps that were taken, with their count. Click a line to open its last run in §2.</figcaption>
        </figure>
        <section class="an-block an-t2">
          <p class="tcaption">Table 2 — Full trace: the registers and ZF after every step.
            Values that changed in that step are marked. Click a row to open that step in §2.</p>
          <div class="tabs trace-filters" id="traceFilters" role="radiogroup" aria-label="Filter the trace">
            <button role="radio" data-f="all" aria-checked="true">All</button>
            <span class="tf-label">Changes to</span>
            ${["AX", "BX", "CX", "DX"].map((r) => `<button role="radio" data-f="reg" data-reg="${r}" aria-checked="false">${r}</button>`).join("")}
            <button role="radio" data-f="jumps" aria-checked="false">Only jumps</button>
            <label class="tf-line"><span class="tf-label">Line =</span>
              <input type="number" min="1" id="tfLine" aria-label="Show only this line"></label>
          </div>
          <table class="sheet-table trace-table" id="traceTable" data-filter="all">
            <thead><tr><th>Step</th><th>Line</th><th>Instruction</th><th>AX</th><th>BX</th><th>CX</th><th>DX</th><th>ZF</th></tr></thead>
            <tbody>${traceRows(st)}</tbody>
          </table>
        </section>
      </div>
    </div>`;
  $("anExport").addEventListener("click", hooks.exportTrace);
  $("anPrint").addEventListener("click", () => window.print());
  wireTraceTable();
  drawCharts();
}

function row(param, value, note = "", red = false) {
  return `<tr><td>${param}</td><td class="mono${red ? " red" : ""}">${value}</td><td>${note}</td></tr>`;
}

function summaryRows(st) {
  const end = st.end;
  const stopRed = end.type === "ERRSTOP" || end.type === "LOOP";
  const where = end.type === "ERRSTOP" ? `stopped at line ${end.value}`
    : end.type === "LOOP" ? "500-step guard" : st.stop_line ? `at line ${st.stop_line}` : "";
  const errs = st.errors.map((e) => `E${e.code} line ${e.line}`).join(", ");
  const range = (r) => `${st.ranges[r].min} → ${st.ranges[r].max}`;
  return [
    row("Total steps", st.steps),
    row("Termination", end.type, where, stopRed),
    row("Lines in program / executed at least once", `${st.lines_total} / ${st.lines_executed}`),
    row("Jumps taken / not taken", `${st.jumps_taken} / ${st.jumps_not_taken}`, st.jump_kinds.join(" + ")),
    row("ZF transitions", st.zf_transitions),
    row("Errors", st.errors.length, esc(errs), st.errors.length > 0),
    ...["AX", "BX", "CX", "DX"].map((r) => row(`${r} range (min → max)`, range(r), `final ${st.ranges[r].final}`)),
  ].join("");
}

// Table 2: all rows are built once (up to 500); filters only change attributes/classes.
function traceRows(st) {
  const taken = new Set(st.taken_steps);
  let html = "";
  for (let k = 1; k <= st.steps; k++) {
    const changed = st.changed[k - 1];
    const line = hooks.lineOfStep(k);
    const zfChanged = st.zf[k] !== st.zf[k - 1];
    const cell = (r) => `<td class="mono${changed.includes(r) ? " chg" : ""}">${st.values[r][k]}</td>`;
    html += `<tr data-k="${k}" data-line="${line}" data-chg="${changed.join(" ")}"${taken.has(k) ? " data-jump" : ""} tabindex="-1">` +
      `<td class="mono">${k}</td><td class="mono">L${line}</td><td class="mono">${esc((st.listing[line - 1] || "").trim())}</td>` +
      cell("AX") + cell("BX") + cell("CX") + cell("DX") +
      `<td class="mono${zfChanged ? " chg" : ""}">${st.zf[k]}</td></tr>`;
  }
  const end = st.end;
  html += `<tr class="trace-end"><td class="mono" colspan="8">END ${end.type} ${end.value}</td></tr>`;
  return html;
}

function wireTraceTable() {
  const table = $("traceTable");
  const filters = $("traceFilters");
  const select = (btn) => {
    for (const b of filters.querySelectorAll("button")) b.setAttribute("aria-checked", String(b === btn));
  };
  filters.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    select(b);
    $("tfLine").value = "";
    clearLineFilter(table);
    table.dataset.filter = b.dataset.f;
    table.dataset.reg = b.dataset.reg || "";
  });
  $("tfLine").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    select(null);
    clearLineFilter(table);
    if (!n) { table.dataset.filter = "all"; select(filters.querySelector('[data-f="all"]')); return; }
    table.dataset.filter = "line";
    for (const tr of table.tBodies[0].rows) if (tr.dataset.line && Number(tr.dataset.line) !== n) tr.classList.add("off");
  });
  table.tBodies[0].addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-k]");
    if (tr) hooks.openAt(Number(tr.dataset.k));
  });
}

function clearLineFilter(table) {
  for (const tr of table.querySelectorAll("tr.off")) tr.classList.remove("off");
}

// Before printing, draw the charts at A4 width; afterwards at screen width again.
window.addEventListener("beforeprint", () => { document.body.classList.add("printing"); if (stats) drawCharts(); });
window.addEventListener("afterprint", () => { document.body.classList.remove("printing"); if (stats) drawCharts(); });

function drawCharts() {
  mixBars($("fig4"), stats);
  programProfile($("fig5"), stats, (line) => hooks.openLine(line));
  registerChart($("fig3"), stats, {
    describe: (k) => {
      const v = (r) => stats.values[r][k];
      const where = k === 0 ? "start" : `L${hooks.lineOfStep(k)} ${hooks.textOfStep(k).replace(/,\s*/g, ",")}`;
      return `t=${k} · ${where} · AX ${v("AX")} · BX ${v("BX")} · CX ${v("CX")} · DX ${v("DX")} · ZF ${stats.zf[k]}`;
    },
    onPick: (k) => hooks.openAt(k),
  });
}
