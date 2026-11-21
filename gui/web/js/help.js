// help.js - the help sheet (F1 or the ? button), laid out like the appendix pages of a
// datasheet: A instruction set, B error codes, C shortcuts.
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
  ["JNZ", "L1", "Go to the line labelled L1: if ZF is 0", "unchanged"],
  ["HLT", "", "Stop the program", "unchanged"],
];

// Labels: what they look like and what they do (help text only).
const LABELS = [
  ["L1: ADD AX, CX", "A label in front of an instruction. JNZ L1 jumps to this line; falling into it from the line above works too."],
  ["LOOP:", "A label alone on a line. It is an empty line: a jump to it continues with the next line."],
  ["JNZ L1 · JNZ 3", "Jumps take a label or a line number. A label may be defined below the jump."],
  ["Names", "1–12 letters, digits or _, starting with a letter; not an instruction or register name; one label per line; any case (l1 = L1)."],
  ["MOV AX, L1", "Not allowed (E2): labels can only be used with JMP, JZ, JNZ. The CPU has no memory, so a label is only a place to jump to."],
];

const SHORTCUTS = [
  ["Stop typing (0.9 s)", "Live run: results update by themselves"],
  ["Ctrl+Enter", "Run (animated)"],
  ["F10", "Step forward"],
  ["Shift+F10", "Step back"],
  ["Ctrl+Space", "Play / pause (Space outside the editor)"],
  ["Home / End", "First / last step (outside the editor)"],
  ["Ctrl+O / Ctrl+S", "Open / save"],
  ["F1", "Help"],
  ["Esc", "Close this panel or a popup"],
  ["Click a line number", "Jump to the last time that line ran"],
  ["Click the left margin", "Set or clear a breakpoint (Run pauses there)"],
  ["← / → in the trace", "Step back / forward (Home / End: first / last)"],
  ["Ctrl + wheel on the trace", "Zoom in / out; the wheel scrolls"],
];

let onClose = () => {};

export function initHelp(hooks) {
  onClose = hooks.onClose;
  const drawer = document.getElementById("helpDrawer");
  const rows = INSTRUCTIONS.map(([op, args, what, zf], i) => `
    <tr><td class="mono"><b>${op}</b> ${args}</td><td>${what}</td><td class="mono">${zf}</td>
        <td><button class="ctl insert" data-i="${i}" aria-label="Insert ${op} ${args}">INSERT</button></td></tr>`).join("");
  const errors = Object.entries(ERRORS).map(([code, e]) => `
    <tr><td class="mono code">E${code}</td><td><b>${e.message}</b></td><td>${e.hint}</td></tr>`).join("");
  const labelRows = LABELS.map(([ex, what]) => `<tr><td class="mono">${ex}</td><td>${what}</td></tr>`).join("");
  const keys = SHORTCUTS.map(([k, what]) => `<tr><td class="mono">${k}</td><td>${what}</td></tr>`).join("");

  drawer.innerHTML = `
    <div class="sec-head"><h2 class="sec-title">Appendices</h2>
      <button class="ctl" id="helpClose" aria-label="Close help">CLOSE <svg class="icon"><use href="#i-close"/></svg></button></div>
    <div class="help-body">
      <h3 class="appendix">Appendix A — Instruction set</h3>
      <table class="sheet-table"><thead><tr><th>Syntax</th><th>Effect</th><th>ZF</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      <p class="tcaption">Labels</p>
      <table class="sheet-table"><tbody>${labelRows}</tbody></table>
      <h3 class="appendix">Appendix B — Error codes</h3>
      <table class="sheet-table"><thead><tr><th>Code</th><th>Message</th><th>Hint</th></tr></thead>
        <tbody>${errors}</tbody></table>
      <h3 class="appendix">Appendix C — Shortcuts</h3>
      <table class="sheet-table"><tbody>${keys}</tbody></table>
    </div>`;

  drawer.querySelector("#helpClose").addEventListener("click", onClose);
  drawer.addEventListener("click", (e) => {
    const b = e.target.closest(".insert");
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
