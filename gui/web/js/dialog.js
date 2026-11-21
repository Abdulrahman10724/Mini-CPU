// dialog.js - a small confirm dialog drawn as a paper slip (replaces window.confirm).
// confirmDialog("...") resolves true (Discard) or false (Cancel / Esc / click outside).

export function confirmDialog(message, { confirm = "Discard", cancel = "Cancel" } = {}) {
  const backdrop = document.getElementById("dialog");
  const before = document.activeElement;
  backdrop.innerHTML = `
    <div class="slip dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialogText">
      <p id="dialogText"></p>
      <div class="dialog-actions">
        <button class="ctl" data-answer="no">${cancel.toUpperCase()}</button>
        <button class="btn-outline danger" data-answer="yes">${confirm.toUpperCase()}</button>
      </div>
    </div>`;
  backdrop.querySelector("#dialogText").textContent = message;
  backdrop.hidden = false;
  const buttons = [...backdrop.querySelectorAll("button")];
  buttons[0].focus();                                   // the safe choice has focus

  return new Promise((resolve) => {
    const close = (answer) => {
      backdrop.hidden = true;
      backdrop.removeEventListener("click", onClick);
      backdrop.removeEventListener("keydown", onKey);
      if (before) before.focus();
      resolve(answer);
    };
    const onClick = (e) => {
      const b = e.target.closest("button");
      if (b) close(b.dataset.answer === "yes");
      else if (e.target === backdrop) close(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(false); }
      if (e.key === "Tab") {                            // keep focus inside the dialog
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    };
    backdrop.addEventListener("click", onClick);
    backdrop.addEventListener("keydown", onKey);
  });
}
