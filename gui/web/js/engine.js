// engine.js - the card over the datapath when the CPU engine (CPU.exe) is not found,
// with how to fix it and a Retry button. (There is no engine label in the header.)

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
  const missing = s.engine.state === "missing";
  const card = $("engineCard");
  if (missing) {
    card.innerHTML = `<h3>CPU engine missing</h3><p>The simulator needs <code>CPU.exe</code>, built from
      <code>asm/CPU.asm</code> in Visual Studio.</p>${HOW_TO_FIX}`;
    card.append(retryButton());
  }
  card.hidden = !missing;
  $("dpStage").classList.toggle("engine-missing", missing);
}
