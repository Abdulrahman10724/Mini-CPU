// sevenseg.js - a row of 7-segment digits drawn in SVG (the register displays).
//
//    aaa        Each digit has 7 bars (a..g). A character lights some of them.
//   f   b       Unlit bars stay faintly visible, like a real LED display.
//    ggg        Leading zeros are lit "dim"; real digits are lit "on".
//   e   c
//    ddd

const SVG = "http://www.w3.org/2000/svg";

// which bars are lit for each character
const GLYPHS = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg",
  "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
  A: "abcefg", B: "cdefg", C: "adef", D: "bcdeg", E: "adefg", F: "aefg",
};

// A bar is a long hexagon from (x0,y0) to (x1,y1), t thick.
function bar(x0, y0, x1, y1, t) {
  const h = t / 2;
  if (y0 === y1) {
    return `${x0},${y0} ${x0 + h},${y0 - h} ${x1 - h},${y0 - h} ${x1},${y0} ${x1 - h},${y0 + h} ${x0 + h},${y0 + h}`;
  }
  return `${x0},${y0} ${x0 + h},${y0 + h} ${x0 + h},${y1 - h} ${x0},${y1} ${x0 - h},${y1 - h} ${x0 - h},${y0 + h}`;
}

function barPoints(w, h, t) {
  const g = 0.8;                       // small gap between bars
  const half = t / 2;
  const mid = h / 2;
  return {
    a: bar(half + g, half, w - half - g, half, t),
    b: bar(w - half, half + g, w - half, mid - g, t),
    c: bar(w - half, mid + g, w - half, h - half - g, t),
    d: bar(half + g, h - half, w - half - g, h - half, t),
    e: bar(half, mid + g, half, h - half - g, t),
    f: bar(half, half + g, half, mid - g, t),
    g: bar(half + g, mid, w - half - g, mid, t),
  };
}

// Create `count` digits at (x, y) inside `parent`. Returns { set(text, dim), el }.
export function createSevenSeg(parent, { x, y, count, w = 12, h = 20, pitch = 19, t = 2.6 }) {
  const group = document.createElementNS(SVG, "g");
  group.setAttribute("class", "sevenseg");
  group.setAttribute("transform", `translate(${x} ${y})`);
  const shape = barPoints(w, h, t);
  const digits = [];
  for (let i = 0; i < count; i++) {
    const d = document.createElementNS(SVG, "g");
    // a slight forward lean, like a real LED display
    d.setAttribute("transform", `translate(${i * pitch} 0) skewX(-6) translate(${h * 0.05} 0)`);
    const bars = {};
    for (const name of "abcdefg") {
      const p = document.createElementNS(SVG, "polygon");
      p.setAttribute("points", shape[name]);
      p.setAttribute("class", "seg-off");
      d.append(p);
      bars[name] = p;
    }
    group.append(d);
    digits.push(bars);
  }
  parent.append(group);

  // text is right-aligned; dim[i] = true draws character i of text dim (leading zeros)
  function set(text, dim = []) {
    const pad = count - text.length;
    const chars = text.padStart(count, " ").slice(-count).split("");
    chars.forEach((ch, i) => {
      const lit = GLYPHS[ch.toUpperCase()] || "";
      const cls = dim[i - pad] ? "seg-dim" : "seg-on";
      for (const name of "abcdefg") {
        digits[i][name].setAttribute("class", lit.includes(name) ? cls : "seg-off");
      }
    });
  }
  return { set, el: group };
}
