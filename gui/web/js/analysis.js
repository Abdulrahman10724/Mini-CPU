// analysis.js - ANALYSIS: the "characterization report" of the last run.
//   Table 1 (summary) | Fig. 3 (program profile)
//   Table 2 (full trace)
// All numbers come from api.analysis() (gui/analysis_stats.py), i.e. they are
// counts of what result.txt says. This file only lays them out.

import { api } from "./api.js";
import { programProfile } from "./profile.js";

const $ = (id) => document.getElementById(id);

let hooks = null;
let renderedFor;            // the result object the page was built for
let stats = null;

export function initAnalysis(analysisHooks) {
  hooks = analysisHooks;
}

// Called when the Analysis page is shown (and when the result changes while it is shown).
export async function renderAnalysis(s) {
  const page = $("pageAnalysis");
  if (!s.result) {
    renderedFor = null;
    page.innerHTML = `<div class="slip an-empty"><p>No characterization data. Run a program in the Workbench first.</p>
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
        <figure class="an-block an-prof">
          <p class="tcaption">Fig. 3 — Program profile: how often each line ran (×N), and arrows for the
            jumps that were taken, with their count. Click a line to open its last run in the Workbench.</p>
          <div class="prof-host" id="fig3"></div>
        </figure>
        <section class="an-block an-t2">
          <p class="tcaption">Table 2 — Full trace: the registers and flags after every step.
            Values that changed in that step are marked. Click a row to open that step in the Workbench.</p>
          <div class="tabs trace-filters" id="traceFilters" role="radiogroup" aria-label="Filter the trace">
            <button role="radio" data-f="all" aria-checked="true">All</button>
            <span class="tf-label">Changes to</span>
            ${["AX", "BX", "CX", "DX"].map((r) => `<button role="radio" data-f="reg" data-reg="${r}" aria-checked="false">${r}</button>`).join("")}
            <button role="radio" data-f="jumps" aria-checked="false">Only jumps</button>
            <label class="tf-line"><span class="tf-label">Line =</span>
              <input type="number" min="1" id="tfLine" aria-label="Show only this line"></label>
          </div>
          <table class="sheet-table trace-table" id="traceTable" data-filter="all">
            <thead><tr><th>Step</th><th>Line</th><th>Instruction</th><th>AX</th><th>BX</th><th>CX</th><th>DX</th><th>ZF</th><th>SF</th><th>CF</th></tr></thead>
            <tbody>${traceRows(st)}</tbody>
          </table>
        </section>
      </div>
    </div>`;
  $("anExport").addEventListener("click", hooks.exportTrace);
  $("anPrint").addEventListener("click", () => window.print());
  wireTraceTable();
  programProfile($("fig3"), stats, (line) => hooks.openLine(line));
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
    row("Flag transitions ZF / SF / CF", `${st.zf_transitions} / ${st.sf_transitions} / ${st.cf_transitions}`),
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
    const flag = (f) => `<td class="mono${st[f][k] !== st[f][k - 1] ? " chg" : ""}">${st[f][k]}</td>`;
    const cell = (r) => `<td class="mono${changed.includes(r) ? " chg" : ""}">${st.values[r][k]}</td>`;
    html += `<tr data-k="${k}" data-line="${line}" data-chg="${changed.join(" ")}"${taken.has(k) ? " data-jump" : ""} tabindex="-1">` +
      `<td class="mono">${k}</td><td class="mono">L${line}</td><td class="mono">${esc((st.listing[line - 1] || "").trim())}</td>` +
      cell("AX") + cell("BX") + cell("CX") + cell("DX") +
      flag("zf") + flag("sf") + flag("cf") + `</tr>`;
  }
  const end = st.end;
  html += `<tr class="trace-end"><td class="mono" colspan="10">END ${end.type} ${end.value}</td></tr>`;
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
