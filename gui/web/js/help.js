// help.js - the help drawer (F1 or the ? button): instructions, error codes, shortcuts.
// The instruction text here is help text only; CPU.exe decides what is valid.

import { ERRORS } from "./errors.js";

const INSTRUCTIONS = [
  ["MOV", "AX, 5", "Copy a number or register into a register", "unchanged"],
  ["ADD", "AX, BX", "Add the source to the register", "1 if result is 0"],
  ["SUB", "AX, 2", "Subtract the source from the register", "1 if result is 0"],
  ["CMP", "AX, 8", "Compare; registers do not change", "1 if equal"],
  ["INC", "CX", "Add 1 to the register", "1 if result is 0"],
  ["DEC", "CX", "Subtract 1 from the register", "1 if result is 0"],
  ["JMP", "3", "Go to line 3", "unchanged"],
  ["JZ", "7", "Go to line 7 if ZF is 1", "unchanged"],
  ["JNZ", "3", "Go to line 3 if ZF is 0", "unchanged"],
  ["HLT", "", "Stop the program", "unchanged"],
];

const SHORTCUTS = [
  ["Enter", "New line and live run"],
  ["Ctrl+Enter", "Run (animated)"],
  ["F10", "Step forward"],
  ["Shift+F10", "Step back"],
  ["Ctrl+Space", "Play / pause (Space outside the editor)"],
  ["Home / End", "First / last step (outside the editor)"],
  ["Ctrl+O / Ctrl+S", "Open / save"],
  ["F1", "Help"],
  ["Esc", "Close this panel or a popup"],
];

let onClose = () => {};

export function initHelp(hooks) {
  onClose = hooks.onClose;
  const drawer = document.getElementById("helpDrawer");
  const rows = INSTRUCTIONS.map(([op, args, what, zf], i) => `
    <tr><td><span class="help-syntax"><span class="op">${op}</span> ${args}</span></td>
        <td>${what}<br><span class="help-zf">ZF: ${zf}</span></td>
        <td><button class="insert-btn" data-i="${i}" aria-label="Insert ${op} ${args}">Insert</button></td></tr>`).join("");
  const errors = Object.entries(ERRORS).map(([code, e]) => `
    <tr><td><span class="err-code">${code}</span></td><td><b>${e.message}</b><br>${e.hint}</td></tr>`).join("");
  const keys = SHORTCUTS.map(([k, what]) => `<tr><td><span class="kbd">${k}</span></td><td>${what}</td></tr>`).join("");

  drawer.innerHTML = `
    <div class="panel-head"><h2 class="panel-title">Help</h2>
      <button class="btn-icon" id="helpClose" aria-label="Close help"><svg class="icon"><use href="#i-close"/></svg></button></div>
    <div class="help-body">
      <h3>Instructions</h3><table class="help-table">${rows}</table>
      <h3>Errors</h3><table class="help-table">${errors}</table>
      <h3>Shortcuts</h3><table class="help-table">${keys}</table>
    </div>`;

  drawer.querySelector("#helpClose").addEventListener("click", onClose);
  drawer.addEventListener("click", (e) => {
    const b = e.target.closest(".insert-btn");
    if (!b) return;
    const [op, args] = INSTRUCTIONS[Number(b.dataset.i)];
    hooks.onInsert(args ? `${op} ${args}` : op);
  });
}

let wasOpen = false;

export function renderHelp(s) {
  const drawer = document.getElementById("helpDrawer");
  drawer.hidden = !s.helpOpen;
  document.getElementById("helpBtn").setAttribute("aria-expanded", String(s.helpOpen));
  if (s.helpOpen && !wasOpen) document.getElementById("helpClose").focus();
  if (!s.helpOpen && wasOpen && drawer.contains(document.activeElement)) document.getElementById("helpBtn").focus();
  wasOpen = s.helpOpen;
}
