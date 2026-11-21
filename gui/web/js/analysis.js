// analysis.js - §3 ANALYSIS: the "characterization report" of the last run.
// All numbers come from api.analysis() (gui/analysis_stats.py), i.e. they are
// counts of what result.txt says. This file only lays them out and draws them.

import { api } from "./api.js";
import { registerChart } from "./charts.js";

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
        <figure class="an-block an-fig4" id="fig4Block"></figure>
        <figure class="an-block an-fig3">
          <div class="chart-host" id="fig3"></div>
          <figcaption class="caption">Fig. 3 — Register values per step (AX solid, BX dashed, CX dotted,
            DX dash-dot) with the Zero Flag below. Hover to read a step; click to open it in §2.</figcaption>
        </figure>
        <div class="an-rest" id="anRest"></div>
      </div>
    </div>`;
  $("anExport").addEventListener("click", hooks.exportTrace);
  $("anPrint").addEventListener("click", () => window.print());
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

function drawCharts() {
  registerChart($("fig3"), stats, {
    describe: (k) => {
      const v = (r) => stats.values[r][k];
      const where = k === 0 ? "start" : `L${hooks.lineOfStep(k)} ${hooks.textOfStep(k).replace(/,\s*/g, ",")}`;
      return `t=${k} · ${where} · AX ${v("AX")} · BX ${v("BX")} · CX ${v("CX")} · DX ${v("DX")} · ZF ${stats.zf[k]}`;
    },
    onPick: (k) => hooks.openAt(k),
  });
}
