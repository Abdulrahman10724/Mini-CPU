// router.js - the three sections of the datasheet, one page each:
//   #cover   #workbench   #analysis   (Alt+1 / Alt+2 / Alt+3)
// It is one single-page app: switching only shows another <div class="page">, so the
// program, the result and the timeline position are kept.

export const PAGES = ["cover", "workbench", "analysis"];

let current = null;
let hooks = null;
let analysisOpen = false;          // Analysis is locked until a result exists

export function initRouter(routerHooks) {
  hooks = routerHooks;
  window.addEventListener("hashchange", () => show(fromHash()));
  document.getElementById("sectionIndex").addEventListener("click", (e) => {
    const link = e.target.closest("a[data-sec]");
    if (!link) return;
    e.preventDefault();
    go(link.dataset.sec);
  });
  // the app always opens on the cover
  history.replaceState(null, "", "#cover");
  show("cover");
}

function fromHash() {
  const page = location.hash.replace("#", "");
  return PAGES.includes(page) ? page : "cover";
}

export function currentPage() {
  return current;
}

export function go(page) {
  if (page === "analysis" && !analysisOpen) return;
  if (location.hash !== "#" + page) location.hash = page;     // triggers show() via hashchange
  else show(page);
}

function show(page) {
  if (page === "analysis" && !analysisOpen) {                 // typed #analysis too early
    history.replaceState(null, "", "#" + (current || "cover"));
    return;
  }
  if (page === current) return;
  const previous = current;
  current = page;
  for (const el of document.querySelectorAll(".page")) {
    const on = el.dataset.page === page;
    el.hidden = !on;
    el.classList.remove("page-in");
    if (on && previous !== null) {
      void el.offsetWidth;                  // reflow, so the animation starts again every visit
      el.classList.add("page-in");          // slide up + fade in (CSS)
    }
  }
  document.getElementById("app").dataset.page = page;
  for (const a of document.querySelectorAll("#sectionIndex a")) {
    if (a.dataset.sec === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.getElementById("sheetFoot").textContent =
    `MINI-CPU DATASHEET · BDS-3A-07 · SHEET ${PAGES.indexOf(page) + 1} OF 3`;
  hooks.onShow(page, previous);
}

// The Analysis page opens once a result exists.
export function setAnalysisAvailable(on) {
  analysisOpen = on;
  const link = document.querySelector('#sectionIndex a[data-sec="analysis"]');
  link.setAttribute("aria-disabled", String(!on));
  if (on) link.removeAttribute("data-tip");
  else link.setAttribute("data-tip", "Run a program first");
  const btn = document.getElementById("analysisBtn");
  btn.disabled = !on;
  if (on) btn.removeAttribute("data-tip");
  else btn.setAttribute("data-tip", "Run a program first");
}
