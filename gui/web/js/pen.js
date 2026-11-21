// pen.js - the teacher's red pen: a hand-drawn ellipse made of two slightly
// different strokes (rotated -2 and +2 degrees). Used by the editor (error lines)
// and by the datapath (the decoder on ERRSTOP).

const SVG = "http://www.w3.org/2000/svg";

// A wobbly ellipse through 14 points whose radius changes a little. Seeded, so the
// same mark is always drawn the same way. It overshoots its start like a real pen.
// The ellipse fills a w x h box whose top-left corner is at (4, 3).
export function penEllipse(w, h, seed) {
  const cx = w / 2 + 4, cy = h / 2 + 3, rx = w / 2, ry = h / 2;
  const pts = [];
  const steps = 14;
  for (let i = 0; i <= steps + 2; i++) {
    const a = -Math.PI * 0.85 + (i / steps) * Math.PI * 2;
    const wobble = 1 + 0.05 * Math.sin(i * 2.3 + seed * 1.7);
    pts.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d;
}

// Append the two pen strokes to an <svg> or <g>. The CSS class "red-pen" on a parent
// makes them draw themselves (stroke-dashoffset); "drawn" skips the animation.
export function penStrokes(parent, w, h) {
  [[-2, 0], [2, 1]].forEach(([deg, seed]) => {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", penEllipse(w, h, seed));
    p.setAttribute("pathLength", "100");
    p.setAttribute("transform", `rotate(${deg} ${w / 2 + 4} ${h / 2 + 3})`);
    if (seed === 1) p.style.animationDelay = "90ms";
    parent.append(p);
  });
}
