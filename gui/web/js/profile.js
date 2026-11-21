// profile.js - Fig. 3, the program profile: the listing (read-only, ruled like the
// notebook) with
//   - a COUNT on the right: how many times the line ran ("×5"); the most-run line
//     is marked "hot" in red
//   - BRANCH ARCS on the left: a curved arrow from every jump that was taken to its
//     target line, with how often it was taken ("4×"). Loops become visible.
// The counts and arcs come from analysis_stats.py (counted from result.txt).

const NS = "http://www.w3.org/2000/svg";
const ROW = 26;          // row height (px)
const GUTTER = 96;       // room for the arcs on the left

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// host: element; stats: from analysis_stats; onLine(n): a line was clicked
export function programProfile(host, stats, onLine) {
  const lines = stats.listing;
  const counts = stats.line_counts;
  const hot = stats.hottest ? stats.hottest.line : null;

  host.innerHTML = `
    <div class="profile" style="--row:${ROW}px; --gutter:${GUTTER}px">
      <ol class="prof-lines">${lines.map((text, i) => {
        const n = i + 1;
        const c = counts[String(n)] || 0;
        const isHot = n === hot && c > 1;
        return `<li class="prof-line${isHot ? " hot" : ""}" data-line="${n}" tabindex="0">
          <span class="prof-no">${n}</span><span class="prof-code">${esc(text) || "&nbsp;"}</span>
          <span class="prof-count">${c ? `<b>×${c}</b>${isHot ? " <em>hot</em>" : ""}` : `<span class="prof-none">${text.trim() ? "not run" : ""}</span>`}</span>
        </li>`;
      }).join("")}</ol>
    </div>`;

  const box = host.querySelector(".profile");
  const svg = el("svg", { class: "prof-arcs", width: GUTTER, height: Math.max(ROW, lines.length * ROW) }, box);
  const defs = el("defs", {}, svg);
  const marker = el("marker", { id: "arcHead", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7",
    markerHeight: "7", orient: "auto" }, defs);
  el("path", { d: "M0 0 L8 4 L0 8 z", class: "arc-head" }, marker);

  // longer arcs go further out, so nested loops do not cross
  const arcs = stats.arcs.slice().sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from));
  const rowOf = (n) => box.querySelector(`.prof-line[data-line="${n}"]`);
  arcs.forEach((arc, i) => {
    const y1 = (arc.from - 0.5) * ROW, y2 = (arc.to - 0.5) * ROW;
    const x = GUTTER - 6;
    const bulge = 20 + i * 14;
    const g = el("g", { class: "arc", tabindex: "0", role: "img",
      "aria-label": `Line ${arc.from} jumps to line ${arc.to}, taken ${arc.count} times` }, svg);
    el("path", { d: `M ${x} ${y1} C ${x - bulge} ${y1}, ${x - bulge} ${y2}, ${x - 1} ${y2}`,
      class: "arc-path", "marker-end": "url(#arcHead)" }, g);
    const label = el("text", { x: x - bulge * 0.75 - 4, y: (y1 + y2) / 2 + 4, "text-anchor": "end", class: "arc-count" }, g);
    label.textContent = `${arc.count}×`;
    const mark = (on) => {
      g.classList.toggle("heavy", on);
      for (const n of [arc.from, arc.to]) { const r = rowOf(n); if (r) r.classList.toggle("arc-hl", on); }
    };
    g.addEventListener("mouseenter", () => mark(true));
    g.addEventListener("mouseleave", () => mark(false));
    g.addEventListener("focus", () => mark(true));
    g.addEventListener("blur", () => mark(false));
  });

  box.addEventListener("click", (e) => {
    const row = e.target.closest(".prof-line");
    if (row) onLine(Number(row.dataset.line));
  });
  box.addEventListener("keydown", (e) => {
    const row = e.target.closest(".prof-line");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onLine(Number(row.dataset.line)); }
  });
}
