// main.js - boot the editor page and wire everything together.
// Flow of one run:  editor text -> api.run() -> Python writes program.txt, runs CPU.exe,
// parses result.txt -> state.result -> every component re-renders from state.

import { state, update, subscribe, totalSteps } from "./state.js";
import { api } from "./api.js";
import { toast } from "./toast.js";
import { initEditor, renderEditor, setCode, cancelLiveRun } from "./editor.js";

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

function applyResult(result, code, mode) {
  update({ result, resultCode: code, cursor: result.steps.length, playing: false });
  $("analysisBtn").hidden = false;
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
}

// ------------------------------------------------------------------ boot
async function boot() {
  subscribe(renderTopBar);
  subscribe(renderEditor);

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

export { runCode, totalSteps };
