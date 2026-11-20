// toast.js - one small message at a time, bottom right.
// tone: "green" | "amber" | "red" | "" ; sticky toasts stay until closed.

let current = null;
let timer = null;

export function toast(message, tone = "", { sticky = false } = {}) {
  const host = document.getElementById("toastHost");
  clearTimeout(timer);
  if (current) current.remove();

  const el = document.createElement("div");
  el.className = "toast" + (tone ? " toast-" + tone : "");
  el.setAttribute("role", tone === "red" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);

  if (sticky) {
    const close = document.createElement("button");
    close.className = "btn-icon toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
    close.addEventListener("click", () => el.remove());
    el.append(close);
  } else {
    timer = setTimeout(() => el.remove(), 3000);
  }
  host.append(el);
  current = el;
}
