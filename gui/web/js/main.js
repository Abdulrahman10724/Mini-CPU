// main.js - boot the editor page and wire everything together.
// Flow of one run:  editor text -> api.run() -> Python writes program.txt, runs CPU.exe,
// parses result.txt -> state.result -> every component re-renders from state.

import { state, update, subscribe, totalSteps, errorOnLine, stateAt, indexes } from "./state.js";
import { setHighlight, getHighlight, onHighlight } from "./highlight.js";
import { api } from "./api.js";
import { toast, clearToast } from "./toast.js";
import { initEditor, renderEditor, setCode, cancelLiveRun, insertLine, setLinkedLine, getEditor } from "./editor.js";
import { buildDatapath, showState, renderDatapathText, setRegWires, setImemHover } from "./datapath.js";
import { playStep, cancelAnimation, isAnimating, STEP_MS } from "./animator.js";
import { errorInfo } from "./errors.js";
import { confirmDialog } from "./dialog.js";
import { initRouter, go, currentPage, setAnalysisAvailable, PAGES } from "./router.js";
import { initCover, renderOrders, coverKeys } from "./cover.js";
import { initChip, chipShown, chipHidden, setDemoTrace } from "./chip.js";
import { initAnalysis, renderAnalysis } from "./analysis.js";
import { initHistory, renderHistory, markLineRows } from "./history.js";
import { initWaveform, renderWaveform, setTraceLink, previewStep } from "./waveform.js";
import { initHelp, renderHelp } from "./help.js";
import { initEngineUi, renderEngine } from "./engine.js";

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ running CPU.exe
let runBusy = false;
let queued = null;          // only the LATEST request waits while a run is busy

async function runCode(code, mode, lineHint = null) {
  if (state.engine.state === "missing") {
    if (mode !== "live") toast("CPU engine not found. See the card in the Workbench datapath.", "red");
    return;
  }
  if (runBusy) { queued = { code, mode, lineHint }; return; }
  runBusy = true;
  update({ running: true });
  const res = await api.run(code);
  runBusy = false;
  update({ running: false });

  if (!res.ok) {
    if (res.engine) update({ engine: res.engine });   // CPU.exe vanished: show the "missing" card
    toast(res.error, "red", { sticky: true });
    if (res.raw) console.warn("result.txt was:\n" + res.raw);
  } else {
    applyResult(res.result, code, mode, lineHint);
  }
  if (queued) {
    const q = queued;
    queued = null;
    runCode(q.code, q.mode, q.lineHint);
  }
}

function applyResult(result, code, mode, lineHint) {
  stopPlaying();
  const N = result.steps.length;
  setAnalysisAvailable(true);                       // the Analysis page now has data

  if (mode === "run") {                     // Run: from step 0, animated to the end
    update({ result, resultCode: code, cursor: 0 });
    play();
  } else if (mode === "step") {             // Step with no result yet: run, then step 1
    update({ result, resultCode: code, cursor: 0 });
    if (N > 0) goTo(1, { animate: true });
    else announceEnd();
  } else {                                  // live: jump to the last step at once
    update({ result, resultCode: code, cursor: N });
    // replay only the last execution of the line the user just finished, once
    let j = 0;
    result.steps.forEach((st, i) => { if (st.line === lineHint) j = i + 1; });
    if (j > 0 && !noAnimation()) playStep(j, STEP_MS[state.speed], N);
  }
}

// ------------------------------------------------------------------ playback
// No step animation when the system asks for reduced motion (there is no UI option
// for it). "instant" is also an internal speed, used by the dev screenshot scripts.
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const noAnimation = () => REDUCED_MOTION || state.speed === "instant";

// goTo moves the timeline. With animate = true it plays the transition k-1 -> k.
function goTo(k, { animate = false } = {}) {
  k = Math.max(0, Math.min(k, totalSteps()));
  if (animate && k >= 1 && !noAnimation()) {
    const done = playStep(k, STEP_MS[state.speed]);   // starts before update(), so the
    update({ cursor: k });                             // datapath waits for the animation
    return done;
  }
  cancelAnimation();
  update({ cursor: k });
  return Promise.resolve(true);
}

let playToken = 0;                         // a new token cancels an older play loop

async function play() {
  if (!state.result) return;
  const N = totalSteps();
  if (state.cursor >= N) goTo(0);
  const token = ++playToken;
  update({ playing: true });
  if (noAnimation()) {
    goTo(nextBreakpointStep(state.cursor) || N);
  } else {
    while (token === playToken && state.cursor < N) {
      const finished = await goTo(state.cursor + 1, { animate: true });
      if (!finished || atBreakpoint()) break;
    }
  }
  if (token === playToken) {
    update({ playing: false });
    if (atBreakpoint() && state.cursor < N) toast(`Paused at breakpoint, line ${stateAt(state.cursor).line}`);
    else if (state.cursor === N) announceEnd();
  }
}

// Breakpoints (GUI only): playback stops on a step whose line has a breakpoint.
function atBreakpoint() {
  return state.cursor > 0 && state.breakpoints.has(stateAt(state.cursor).line);
}

function nextBreakpointStep(from) {
  const steps = state.result.steps;
  for (let k = from + 1; k <= steps.length; k++) if (state.breakpoints.has(steps[k - 1].line)) return k;
  return 0;
}

function toggleBreakpoint(line) {
  const set = new Set(state.breakpoints);
  if (set.has(line)) set.delete(line);
  else set.add(line);
  update({ breakpoints: set });
}

// Click on a line number: jump to the LAST time that line ran.
function jumpToLine(line) {
  const runs = indexes().byLine.get(line);
  if (!runs) { toast(`Line ${line} has not run`); return; }
  stopPlaying();
  goTo(runs[runs.length - 1]);
}

function stopPlaying() {
  playToken++;
  if (state.playing) update({ playing: false });
  if (isAnimating()) { cancelAnimation(); showState(state.cursor); }
}

function togglePlay() {
  if (state.playing) stopPlaying();
  else play();
}

async function stepForward() {
  if (!state.result || state.code !== state.resultCode) { runCode(state.code, "step"); return; }
  stopPlaying();
  if (state.cursor >= totalSteps()) return;
  await goTo(state.cursor + 1, { animate: true });
  if (state.cursor === totalSteps()) announceEnd();
}

function stepBack() {
  stopPlaying();
  goTo(state.cursor - 1);
}

function resetTimeline() {
  stopPlaying();
  goTo(0);
}

// Toast when the program reaches its END line.
function announceEnd() {
  const { end, steps } = state.result;
  if (end.type === "HALT") toast(`Halted after ${steps.length} ${steps.length === 1 ? "step" : "steps"}`, "green");
  else if (end.type === "LOOP") toast(`Stopped: infinite loop (${end.value} steps)`, "amber");
  else if (end.type === "ERRSTOP") {
    const code = errorOnLine(end.value) || 9;
    toast(end.value === 0 ? errorInfo(9).message : `Stopped at line ${end.value}: ${errorInfo(code).message}`, "red");
  } else toast(`Ran past the last line after ${end.value} steps (no HLT)`);
}

// ------------------------------------------------------------------ datapath
function renderDatapath(s, patch) {
  const changed = "result" in patch || "cursor" in patch || "regFormat" in patch || "code" in patch;
  if (changed && !isAnimating()) {
    showState(s.cursor);                                    // the animator draws while it runs
    renderLinks(getHighlight());                            // keep a linked highlight up to date
  }
  renderDatapathText(s);
}

// ------------------------------------------------------------------ linked highlighting
// One hovered thing (a register, a line or a step) is shown in every panel at once.
function renderLinks(h) {
  const kind = h ? h.kind : null;
  const reg = kind === "reg" ? h.value : null;
  const stepLine = kind === "step" && h.value > 0 ? stateAt(h.value).line : null;
  const line = kind === "line" ? h.value : stepLine;

  $("app").dataset.hlReg = reg || "";               // CSS: editor tokens, ledger row, log rows
  setRegWires(reg);                                  // datapath wires that carry it
  setImemHover(line);                                // the IMEM row of that line
  markLineRows(kind === "line" ? h.value : null);    // log rows that ran the line
  setLinkedLine(stepLine);                           // editor line of a hovered step
  setTraceLink(h, kind === "line" ? indexes().byLine.get(h.value) || [] : []);
  if (kind === "step") previewStep(h.value);
}

const highlightReg = (reg) => setHighlight(reg ? { kind: "reg", value: reg } : null);

// ------------------------------------------------------------------ top bar
function renderTopBar(s, patch) {
  if ("fileName" in patch || "dirty" in patch || "filePath" in patch) {
    $("fileName").textContent = s.fileName;
    $("fileChip").title = s.filePath || "Not saved yet";
    $("dirtyDot").hidden = !s.dirty;
  }
  if ("speed" in patch) {
    for (const b of $("speedSeg").querySelectorAll("button")) {
      b.setAttribute("aria-checked", String(b.dataset.speed === s.speed));
      b.tabIndex = b.dataset.speed === s.speed ? 0 : -1;
    }
  }
  if ("engine" in patch) {
    $("runBtn").disabled = s.engine.state === "missing";
  }
}

// Ask before throwing away unsaved changes (a paper-slip dialog, not window.confirm).
async function confirmDiscard() {
  return !state.dirty || confirmDialog("This program has unsaved changes. Discard them?");
}

// mode "live": just check it; "run": run it animated (demos from the cover)
function loadProgram(code, fileName, filePath, mode = "live") {
  cancelLiveRun();
  setCode(code);
  update({ code, fileName, filePath, dirty: false, result: null, resultCode: "", cursor: 0, playing: false,
    breakpoints: new Set() });
  setAnalysisAvailable(false);
  if (code.trim()) runCode(code, mode);
}

// Returns true when a file was opened.
async function openFile() {
  if (!(await confirmDiscard())) return false;
  const res = await api.openFile();
  if (res.ok) { loadProgram(res.code.replace(/\r\n?/g, "\n"), res.name, res.path); return true; }
  if (!res.cancelled) toast(res.error, "red");
  return false;
}

async function saveFile() {
  const res = await api.saveFile(state.code, state.filePath);
  if (res.ok) { update({ filePath: res.path, fileName: res.name, dirty: false }); toast("Saved", "green"); }
  else if (!res.cancelled) toast(res.error, "red");
}

async function buildDemosMenu() {
  const menu = $("demosMenu");
  const demos = await api.listDemos();
  menu.innerHTML = "";
  for (const d of Array.isArray(demos) ? demos : []) {
    const item = document.createElement("button");
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.innerHTML = `<span class="menu-item-title"></span><span class="menu-item-desc"></span>`;
    item.children[0].textContent = d.title;
    item.children[1].textContent = d.description;
    item.addEventListener("click", async () => {
      closeDemos();
      if (!(await confirmDiscard())) return;
      const res = await api.loadDemo(d.id);
      if (res.ok) loadProgram(res.code, d.id + ".txt", null);
    });
    menu.append(item);
  }
}

function openDemos() {
  $("demosMenu").hidden = false;
  $("demosBtn").setAttribute("aria-expanded", "true");
  const first = $("demosMenu").querySelector(".menu-item");
  if (first) first.focus();
}

function closeDemos() {
  $("demosMenu").hidden = true;
  $("demosBtn").setAttribute("aria-expanded", "false");
}

// ------------------------------------------------------------------ sections and session
// Called by the router whenever a section becomes visible.
function onShowPage(page) {
  clearToast();
  if (page === "cover") chipShown();
  else chipHidden();
  if (page === "analysis") renderAnalysis(state);
  if (page === "workbench") {
    getEditor().refresh();                          // CodeMirror measures itself again
    window.dispatchEvent(new Event("resize"));
  }
}

// The cover's ordering table: every row opens the Workbench with a program.
async function coverAction(a) {
  if (a.act === "file") { if (await openFile()) go("workbench"); return; }
  if (!(await confirmDiscard())) return;
  if (a.act === "new") loadProgram("", "untitled.txt", null);
  else if (a.act === "resume") loadProgram(lastSession.code, lastSession.fileName, lastSession.filePath);
  else if (a.act === "drop") loadProgram(a.code.replace(/\r\n?/g, "\n"), a.name, null);
  else if (a.act === "demo") {
    const res = await api.loadDemo(a.id);
    if (!res.ok) { toast(res.error, "red"); return; }
    go("workbench");
    loadProgram(res.code, a.id + ".txt", null, "run");      // demos run once, animated
    return;
  }
  go("workbench");
  getEditor().focus();
}

// A paper slip next to a hovered chip pin (null hides it).
function showPinSlip(text, rect) {
  const tip = $("errTip");
  if (!text) { tip.hidden = true; return; }
  tip.innerHTML = `<div class="slip-head"></div>`;
  tip.firstChild.textContent = text;
  tip.hidden = false;
  const app = $("app").getBoundingClientRect();
  const left = Math.min(rect.right - app.left + 8, app.width - tip.offsetWidth - 16);
  tip.style.left = `${Math.max(16, left)}px`;
  tip.style.top = `${rect.top - app.top - tip.offsetHeight - 4}px`;
}

// The last program is remembered (gui/runtime/session.json) for the cover's Continue row.
let lastSession = null;
let sessionTimer = null;
function saveSessionSoon(s, patch) {
  if (!("code" in patch) && !("fileName" in patch)) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    if (s.code.trim()) api.saveSession({ code: s.code, fileName: s.fileName, filePath: s.filePath });
  }, 800);
}

function wireTopBar() {
  $("speedSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) update({ speed: b.dataset.speed });
  });
  $("demosBtn").addEventListener("click", () => ($("demosMenu").hidden ? openDemos() : closeDemos()));
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeDemos(); });
  $("openBtn").addEventListener("click", openFile);
  $("saveBtn").addEventListener("click", saveFile);
  $("logoBtn").addEventListener("click", () => go("cover"));
  $("analysisBtn").addEventListener("click", () => go("analysis"));
  $("runBtn").addEventListener("click", () => { cancelLiveRun(); runCode(state.code, "run"); });
  $("resetBtn").addEventListener("click", resetTimeline);
}

// ------------------------------------------------------------------ keyboard shortcuts
function inEditor(e) {
  return Boolean(e.target.closest && e.target.closest(".CodeMirror"));
}

function onKeyDown(e) {
  if (!$("dialog").hidden) return;                 // a dialog handles its own keys
  const ctrl = e.ctrlKey || e.metaKey;
  const typing = inEditor(e) || ["INPUT", "TEXTAREA"].includes(e.target.tagName);
  let handled = true;
  if (e.altKey && ["1", "2", "3"].includes(e.key)) { go(PAGES[Number(e.key) - 1]); e.preventDefault(); return; }
  if (currentPage() !== "workbench" && !["F1", "Escape"].includes(e.key) && !(ctrl && e.key.toLowerCase() === "o")) {
    if (pageKeys[currentPage()]) pageKeys[currentPage()](e);   // each section's own keys
    return;
  }
  if (ctrl && e.key === "Enter") { cancelLiveRun(); runCode(state.code, "run"); }
  else if (e.key === "F10" && e.shiftKey) stepBack();
  else if (e.key === "F10") stepForward();
  else if (ctrl && e.code === "Space") togglePlay();
  else if (e.code === "Space" && !typing && !e.target.closest("button, [role=button], .log-row, .trace-plot")) togglePlay();
  else if (e.key === "Home" && !typing) { stopPlaying(); goTo(0); }
  else if (e.key === "End" && !typing) { stopPlaying(); goTo(totalSteps()); }
  else if (ctrl && e.key.toLowerCase() === "o") openFile();
  else if (ctrl && e.key.toLowerCase() === "s") saveFile();
  else if (e.key === "F1") update({ helpOpen: !state.helpOpen });
  else if (e.key === "Escape") closeOverlays();
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// Keyboard handlers of the other sections (filled in by cover.js / analysis.js).
const pageKeys = {};

function closeOverlays() {
  if (!$("demosMenu").hidden) { closeDemos(); $("demosBtn").focus(); return; }
  if (state.helpOpen) update({ helpOpen: false });
}

// Arrow keys inside the speed control and the demos menu.
function wireArrowKeys() {
  $("speedSeg").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = [...$("speedSeg").querySelectorAll("button")];
    const i = buttons.findIndex((b) => b.dataset.speed === state.speed);
    const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    update({ speed: next.dataset.speed });
    next.focus();
    e.preventDefault();
  });
  $("demosMenu").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...$("demosMenu").querySelectorAll(".menu-item")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    e.preventDefault();
  });
}

async function retryEngine() {
  const engine = await api.recheckEngine();
  update({ engine });
  if (engine.state === "missing") toast("CPU.exe is still not found", "red");
  else { toast("Engine ready", "green"); if (state.code) runCode(state.code, "live"); }
}

// ------------------------------------------------------------------ boot
async function boot() {
  // crop marks on the corners of every panel (print production marks)
  for (const panel of document.querySelectorAll(".panel")) {
    const crop = document.createElement("i");
    crop.className = "crop";
    crop.setAttribute("aria-hidden", "true");
    panel.append(crop);
  }
  subscribe(renderTopBar);
  subscribe(renderEditor);
  buildDatapath($("datapath"), { onFormatChange: (f) => update({ regFormat: f }), onRegHover: highlightReg });
  onHighlight(renderLinks);
  subscribe(renderDatapath);
  initHistory({ onSelect: (k) => { stopPlaying(); goTo(k); }, onHighlight: setHighlight });
  subscribe(renderHistory);
  initWaveform({
    onSeek: (k) => { if (k !== state.cursor) { stopPlaying(); goTo(k); } },
    onFirst: () => { stopPlaying(); goTo(0); },
    onPrev: stepBack,
    onTogglePlay: togglePlay,
    onNext: stepForward,
    onLast: () => { stopPlaying(); goTo(totalSteps()); },
    onHover: (k) => setHighlight(k === null ? null : { kind: "step", value: k }),
    onRegHover: highlightReg,
  });
  subscribe(renderWaveform);
  window.addEventListener("keydown", onKeyDown, true);   // capture: before CodeMirror
  initHelp({ onClose: () => update({ helpOpen: false }), onInsert: insertLine });
  subscribe(renderHelp);
  initEngineUi({ onRetry: retryEngine });
  subscribe(renderEngine);
  wireArrowKeys();

  initEditor($("editorHost"), {
    onCodeChange: (code, { programmatic }) => update({ code, dirty: programmatic ? state.dirty : true }),
    liveRun: (code, lineHint) => runCode(code, "live", lineHint),
    onHighlight: setHighlight,
    onJumpToLine: jumpToLine,
    onToggleBreakpoint: toggleBreakpoint,
  });
  wireTopBar();

  update({ speed: "1", fileName: state.fileName, dirty: false, code: "" });

  subscribe(saveSessionSoon);
  const session = await api.loadSession();
  lastSession = session && session.ok ? session : null;
  initCover({
    onAction: coverAction,
    onDropError: (msg) => toast(msg, "red"),
  }, lastSession);
  pageKeys.cover = coverKeys;
  initChip({
    onPinHover: showPinSlip,
    onEnterDie: () => {                              // the chip body was clicked
      if (!state.code.trim() && lastSession) loadProgram(lastSession.code, lastSession.fileName, lastSession.filePath);
      go("workbench");
    },
  });
  initAnalysis({
    goWorkbench: () => go("workbench"),
    openAt: (k) => { go("workbench"); stopPlaying(); goTo(k); },
    openLine: (line) => { go("workbench"); jumpToLine(line); },
    lineOfStep: (k) => stateAt(k).line,
    exportTrace: async () => {
      const res = await api.exportTrace(state.fileName.replace(/\.txt$/i, "") + "_trace.csv");
      if (res.ok) toast(`Saved ${res.name}`);
      else if (!res.cancelled) toast(res.error, "red");
    },
  });
  subscribe((s, patch) => { if ("result" in patch && currentPage() === "analysis") renderAnalysis(s); });
  initRouter({ onShow: onShowPage });               // after the cover and chip exist
  update({ engine: await api.engineStatus() });
  if (state.engine.state !== "missing") {           // the chip's idle demo: demo 03's real trace
    api.runDemo("03_loop_sum").then((res) => setDemoTrace(res && res.ok ? res : null));
  }
  buildDemosMenu();
}

boot();

// Small handle for debugging in the web inspector (and for the dev screenshot script).
window.miniCpu = { state, update, goTo, play, go };

export { runCode, totalSteps };
