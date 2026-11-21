// toast.js - one small paper slip at a time, bottom right.
// tone "red" = an error (red rule on the left); anything else is plain ink.
// Sticky toasts stay until closed.

let current = null;
let timer = null;

export function toast(message, tone = "", { sticky = false } = {}) {
  const host = document.getElementById("toastHost");
  clearTimeout(timer);
  if (current) current.remove();

  const el = document.createElement("div");
  el.className = "slip toast" + (tone === "red" ? " toast-red" : "");
  el.setAttribute("role", tone === "red" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);

  if (sticky) {
    const close = document.createElement("button");
    close.className = "ctl-icon toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
    close.addEventListener("click", () => el.remove());
    el.append(close);
  } else {
    timer = setTimeout(() => el.remove(), 3000);
  }
  el.dataset.sticky = sticky ? "1" : "";
  host.append(el);
  current = el;
}

// Turning to another sheet removes a short-lived toast (it belongs to the old page).
// Sticky toasts stay until the user closes them.
export function clearToast() {
  if (current && !current.dataset.sticky) { clearTimeout(timer); current.remove(); current = null; }
}
