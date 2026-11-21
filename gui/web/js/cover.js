// cover.js - §1 COVER: the front page of the datasheet.
//   left:  product title, FEATURES, ORDERING INFORMATION (= the main actions)
//   right: Fig. 0 pin configuration (chip.js), and the engineering title block
// The actions are done by main.js through `hooks`; this file only draws and listens.

const $ = (id) => document.getElementById(id);

const FEATURES = [
  "Four 32-bit general-purpose registers: AX, BX, CX, DX",
  "10-instruction set: MOV, ADD, SUB, CMP, INC, DEC, JMP, JZ, JNZ, HLT",
  "Zero Flag with conditional branching",
  "Live syntax checking with 9 diagnostic codes",
  "Programs loaded from and saved to text files",
  "Step-by-step execution trace, up to 500 steps",
  "Engine written in x86 MASM with the Irvine32 library",
];

// part number, description, action word, what it does
const ORDERS = [
  ["MCPU-NEW", "Blank program", "OPEN", { act: "new" }],
  ["MCPU-D01", "Demo · Arithmetic (MOV, ADD, SUB)", "OPEN", { act: "demo", id: "01_arithmetic" }],
  ["MCPU-D02", "Demo · Compare & jump (CMP, JZ)", "OPEN", { act: "demo", id: "02_compare_jump" }],
  ["MCPU-D03", "Demo · Loop sum 5+4+3+2+1 (DEC, JNZ)", "OPEN", { act: "demo", id: "03_loop_sum" }],
  ["MCPU-FILE", "Open a .txt program from disk…", "BROWSE", { act: "file" }],
];

let hooks = null;
let rowsBody = null;

export function initCover(coverHooks, session) {
  hooks = coverHooks;
  const page = $("pageCover");
  page.innerHTML = `
    <div class="cover-grid">
      <div class="cover-left">
        <p class="advance">ADVANCE INFORMATION · REV 1.0 · NOV 2026</p>
        <h1 class="cover-title">MINI-CPU</h1>
        <p class="cover-sub">4-Register Educational Microprocessor — Simulated in x86 Assembly</p>
        <div class="double-rule" aria-hidden="true"></div>

        <section class="cover-sec" aria-labelledby="featTitle">
          <h2 class="sec-title cover-head" id="featTitle">Features</h2>
          <ul class="features">${FEATURES.map((f) => `<li>${f}</li>`).join("")}</ul>
        </section>

        <section class="cover-sec ordering" id="ordering" aria-labelledby="ordTitle">
          <h2 class="sec-title cover-head" id="ordTitle">Ordering information</h2>
          <table class="order-table">
            <thead><tr><th>Part no.</th><th>Description</th><th></th></tr></thead>
            <tbody id="orderRows"></tbody>
          </table>
          <p class="drop-hint" id="dropHint">Or drop a .txt program anywhere on this page.</p>
        </section>
      </div>

      <div class="cover-right">
        <figure class="chip-fig" id="chipFig">
          <svg id="chip" viewBox="112 20 336 590" preserveAspectRatio="xMidYMid meet" role="img"
               aria-labelledby="chipTitle"><title id="chipTitle">Pin configuration of the MINI-CPU, a 40-pin DIP</title></svg>
          <p class="chip-readout" id="chipReadout" aria-live="off"></p>
          <figcaption class="caption">Fig. 0 — Pin configuration (top view).</figcaption>
        </figure>

        <table class="drawing-block" aria-label="Title block">
          <tr><th>TITLE</th><td class="tb-title">MINI CPU SIMULATOR</td><td class="tb-side">SHEET 1/3</td></tr>
          <tr><th>DRAWN BY</th><td>Abdul Rahman&nbsp;&nbsp;25K-2508<br>Muhammad Salman&nbsp;&nbsp;25K-2509<br>Shahmir Shahid&nbsp;&nbsp;25K-2510</td><td class="tb-side">REV 1.0</td></tr>
          <tr><th>CHECKED BY</th><td colspan="2">Abdullah Sheikh (Lab Instructor)</td></tr>
          <tr><th>COURSE</th><td colspan="2">EL-2003 COAL Lab · BDS-3A · Fall 2026</td></tr>
          <tr><th>INSTITUTION</th><td colspan="2">FAST NUCES Karachi</td></tr>
          <tr><th>ENGINE</th><td colspan="2"><button class="tb-engine" id="tbEngine"></button></td></tr>
        </table>
      </div>
    </div>`;

  rowsBody = $("orderRows");
  renderOrders(session);
  rowsBody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-i]");
    if (row) act(Number(row.dataset.i));
  });
  rowsBody.addEventListener("keydown", (e) => {
    const row = e.target.closest("tr[data-i]");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(Number(row.dataset.i)); }
  });
  $("tbEngine").addEventListener("click", () => hooks.onEngineHelp());
  initDrop(page);
}

let orders = ORDERS;

// The Continue row appears only when a previous session exists.
export function renderOrders(session) {
  orders = ORDERS.slice();
  if (session && session.code) {
    orders.push(["MCPU-CONT", `Continue: ${session.fileName || "untitled.txt"}`, "RESUME", { act: "resume" }]);
  }
  rowsBody.innerHTML = orders.map(([part, desc, word], i) => `
    <tr data-i="${i}" tabindex="0">
      <td class="part">${part}</td><td class="desc"></td>
      <td class="go"><span class="go-word">${word}</span> <span class="arrow">→</span></td></tr>`).join("");
  rowsBody.querySelectorAll("tr").forEach((tr, i) => { tr.querySelector(".desc").textContent = orders[i][1]; });
}

function act(i) {
  const action = orders[i][3];
  hooks.onAction(action);
}

// Cover keys: N new, 1/2/3 demos, O open file.
export function coverKeys(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  const map = { n: 0, 1: 1, 2: 2, 3: 3, o: 4 };
  if (key in map) { e.preventDefault(); act(map[key]); }
}

// ------------------------------------------------------------------ engine row (live)
export function renderCoverEngine(s, patch) {
  if (!("engine" in patch)) return;
  const btn = $("tbEngine");
  if (!btn) return;
  const text = { ready: "● CPU.exe found", missing: "○ CPU.exe not found (click for help)",
    mock: "MOCK ENGINE (development only)", checking: "…" }[s.engine.state];
  btn.textContent = text;
  btn.dataset.state = s.engine.state;
  btn.title = s.engine.path || "";
}

// ------------------------------------------------------------------ drag and drop a .txt file
function initDrop(page) {
  let depth = 0;                                   // dragenter/leave fire for every child
  const table = $("ordering");
  page.addEventListener("dragenter", (e) => { e.preventDefault(); depth += 1; table.classList.add("dragging"); });
  page.addEventListener("dragover", (e) => e.preventDefault());
  page.addEventListener("dragleave", () => { depth -= 1; if (depth <= 0) { depth = 0; table.classList.remove("dragging"); } });
  page.addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    table.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) { hooks.onDropError(`${file.name} is not a .txt program`); return; }
    hooks.onAction({ act: "drop", name: file.name, code: await file.text() });
  });
}
