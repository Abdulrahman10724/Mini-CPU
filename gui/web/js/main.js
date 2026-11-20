// main.js - boot the editor page and wire everything together.
// Flow of one run:  editor text -> api.run() -> Python writes program.txt, runs CPU.exe,
// parses result.txt -> state.result -> every component re-renders from state.

import { state, update, subscribe, totalSteps, errorOnLine } from "./state.js";
import { api } from "./api.js";
import { toast } from "./toast.js";
import { initEditor, renderEditor, setCode, cancelLiveRun } from "./editor.js";
import { buildDatapath, showState, renderDatapathText } from "./datapath.js";
import { playStep, cancelAnimation, isAnimating, STEP_MS } from "./animator.js";
import { errorInfo } from "./errors.js";

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ running CPU.exe
let runBusy = false;
let queued = null;          // only the LATEST request waits while a run is busy

async function runCode(code, mode, lineHint = null) {
  if (state.engine.state === "missing") {
    if (mode !== "live") toast("CPU engine not found. See the engine status in the top bar.", "red");
    return;
  }
  if (runBusy) { queued = { code, mode, lineHint }; return; }
  runBusy = true;
  update({ running: true });
  const res = await api.run(code);
  runBusy = false;
  update({ running: false });

  if (!res.ok) {
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
  $("analysisBtn").hidden = false;

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
    if (j > 0 && state.speed !== "instant") playStep(j, STEP_MS[state.speed], N);
  }
}

// ------------------------------------------------------------------ playback
// goTo moves the timeline. With animate = true it plays the transition k-1 -> k.
function goTo(k, { animate = false } = {}) {
  k = Math.max(0, Math.min(k, totalSteps()));
  if (animate && k >= 1 && state.speed !== "instant") {
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
  if (state.speed === "instant") {
    goTo(N);
  } else {
    while (token === playToken && state.cursor < N) {
      const finished = await goTo(state.cursor + 1, { animate: true });
      if (!finished) break;
    }
  }
  if (token === playToken) {
    update({ playing: false });
    if (state.cursor === N) announceEnd();
  }
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
  if (changed && !isAnimating()) showState(s.cursor);     // the animator draws while it runs
  renderDatapathText(s);
}

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
    const btn = $("engineBtn");
    btn.dataset.state = s.engine.state;
    $("engineText").textContent = {
      ready: "Engine ready", missing: "Engine not found", mock: "MOCK ENGINE", checking: "Checking engine…",
    }[s.engine.state];
    btn.title = s.engine.path || "";
  }
}

function confirmDiscard() {
  return !state.dirty || window.confirm("You have unsaved changes. Discard them?");
}

function loadProgram(code, fileName, filePath) {
  cancelLiveRun();
  setCode(code);
  update({ code, fileName, filePath, dirty: false, result: null, resultCode: "", cursor: 0, playing: false });
  runCode(code, "live");
}

async function openFile() {
  if (!confirmDiscard()) return;
  const res = await api.openFile();
  if (res.ok) loadProgram(res.code.replace(/\r\n?/g, "\n"), res.name, res.path);
  else if (!res.cancelled) toast(res.error, "red");
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
      if (!confirmDiscard()) return;
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

function navigate(page) {
  toast(page === "home" ? "Home page: coming soon" : "Analysis page: coming soon");
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
  $("logoBtn").addEventListener("click", () => navigate("home"));
  $("analysisBtn").addEventListener("click", () => navigate("analysis"));
  $("runBtn").addEventListener("click", () => runCode(state.code, "run"));
  $("stepBtn").addEventListener("click", stepForward);
  $("resetBtn").addEventListener("click", resetTimeline);
}

// ------------------------------------------------------------------ boot
async function boot() {
  subscribe(renderTopBar);
  subscribe(renderEditor);
  buildDatapath($("datapath"), { onFormatChange: (f) => update({ regFormat: f }) });
  subscribe(renderDatapath);

  initEditor($("editorHost"), {
    onCodeChange: (code, { programmatic }) => update({ code, dirty: programmatic ? state.dirty : true }),
    liveRun: (code, lineHint) => runCode(code, "live", lineHint),
  });
  wireTopBar();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  update({ speed: reduced ? "instant" : "1", fileName: state.fileName, dirty: false, code: "" });

  update({ engine: await api.engineStatus() });
  buildDemosMenu();
}

boot();

// Small handle for debugging in the web inspector (and for the dev screenshot script).
window.miniCpu = { state, update, goTo, play };

export { runCode, totalSteps };
