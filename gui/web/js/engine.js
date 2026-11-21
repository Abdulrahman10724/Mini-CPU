// engine.js - shows the state of the CPU engine (CPU.exe): the status pill in the
// top bar, its popover, and the card over the datapath when CPU.exe is not found.

const $ = (id) => document.getElementById(id);

const HOW_TO_FIX = `
  <ol>
    <li>Start the GUI with the path:<br><code>python gui/app.py --exe "C:\\path\\to\\Project.exe"</code></li>
    <li>Or write the path in <code>gui/config.json</code> as <code>"exe_path"</code>.</li>
    <li>Or build <code>CPU.exe</code> into <code>asm\\Debug</code> (or <code>asm</code>, <code>Debug</code>), where it is found automatically.</li>
  </ol>`;

let hooks = null;

export function initEngineUi(engineHooks) {
  hooks = engineHooks;
  $("engineBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#enginePop")) closeEnginePopover();
  });
}

function togglePopover() {
  const pop = $("enginePop");
  if (!pop.hidden) { closeEnginePopover(); return; }
  pop.hidden = false;
  $("engineBtn").setAttribute("aria-expanded", "true");
  const focusable = pop.querySelector("button");
  if (focusable) focusable.focus();
}

export function closeEnginePopover() {
  if ($("enginePop").hidden) return;
  $("enginePop").hidden = true;
  $("engineBtn").setAttribute("aria-expanded", "false");
}

function retryButton() {
  const b = document.createElement("button");
  b.className = "btn-outline";
  b.textContent = "Retry";
  b.addEventListener("click", hooks.onRetry);
  return b;
}

export function renderEngine(s, patch) {
  if (!("engine" in patch)) return;
  const { state: st, path } = s.engine;
  const pop = $("enginePop");
  const card = $("engineCard");

  if (st === "missing") {
    pop.innerHTML = `<h3>CPU engine missing</h3><p>The GUI runs <code>CPU.exe</code> to check and run your
      program. Point it to the exe in one of these ways:</p>${HOW_TO_FIX}`;
    pop.append(retryButton());
    card.innerHTML = `<h3>CPU engine missing</h3><p>The simulator needs <code>CPU.exe</code>, built from
      <code>asm/CPU.asm</code> in Visual Studio.</p>${HOW_TO_FIX}`;
    card.append(retryButton());
  } else if (st === "mock") {
    pop.innerHTML = `<h3>Mock engine (development only)</h3><p>Results come from <code>gui/mock_cpu.py</code>,
      not from the real assembly engine. Start without <code>--mock</code> to use <code>CPU.exe</code>.</p>`;
  } else {
    pop.innerHTML = `<h3>Engine ready</h3><p>Every run executes:</p><p><code></code></p>`;
    pop.querySelector("p:last-child code").textContent = path;
  }
  card.hidden = st !== "missing";
  $("dpStage").classList.toggle("engine-missing", st === "missing");
}
