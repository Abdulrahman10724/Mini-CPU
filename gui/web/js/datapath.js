// datapath.js - Fig. 1: the CPU datapath drawn as a printed textbook figure
// (inline SVG, viewBox 840 x 800, close to the shape of the panel).
//
//   [U5 PC] ----> [U6 IMEM] ----> [U1 DECODER]
//      ^                             |imm   |reg select
//      | jump (via condition gate)   v      v
//   [U4 FLAGS] <---- [U2 ALU] <---- [U3 REGFILE]
//                       |                ^
//                       +-- write-back --+
//
// buildDatapath() draws everything once. showState(k) sets every part from
// stateAt(k) (data from result.txt). The small setters are also used by animator.js.
// Print style: idle = thin grey rules, active = heavy ink + hatching, data = red labels.

import { state, stateAt, describeStep, totalSteps, lineText, errorOnLine, REG_NAMES, JUMP_COND } from "./state.js";
import { errorInfo } from "./errors.js";
import { penStrokes } from "./pen.js";

const NS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ geometry
export const BLOCKS = {
  pc:      { x: 30,  y: 50,  w: 160, h: 180, label: "U5 PC" },
  imem:    { x: 240, y: 50,  w: 280, h: 180, label: "U6 IMEM" },
  decoder: { x: 570, y: 50,  w: 240, h: 180, label: "U1 DECODER" },
  flags:   { x: 30,  y: 400, w: 160, h: 240, label: "U4 FLAGS" },
  regfile: { x: 500, y: 390, w: 310, h: 300, label: "U3 REGFILE" },
};
const ALU_SHAPE = "450,410 450,512 430,530 450,548 450,650 250,590 250,470";
export const ALU_CENTRE = { x: 350, y: 530 };
const GATE = { x: 200, y: 300 };
const PC_PITCH = 64;                 // distance between digits on a PC counter strip

// Every wire is a route of points, drawn with sharp right angles (textbook style).
// The first point of each route is where data leaves a block.
export const WIRES = {
  pc_imem:   [[190, 140], [240, 140]],
  imem_dec:  [[520, 140], [570, 140]],
  dec_reg:   [[760, 230], [760, 390]],                                   // register select
  imm_b:     [[620, 230], [620, 330], [480, 330], [480, 450], [450, 450]], // immediate bus
  reg_b:     [[500, 450], [450, 450]],                                   // source register -> B
  reg_a:     [[500, 610], [450, 610]],                                   // destination register -> A
  alu_flags: [[250, 530], [190, 530]],
  writeback: [[250, 530], [220, 530], [220, 740], [655, 740], [655, 690]],
  jump:      [[570, 200], [545, 200], [545, 300], [110, 300], [110, 230]],  // decoder -> PC
  cond:      [[150, 400], [150, 350], [200, 350], [200, 312]],           // flags -> gate
};

// Ledger columns inside U3 REGFILE
const LEDGER = { top: 422, head: 26, row: 58, colReg: 500, colPrev: 556, colNow: 683, right: 810 };

// ------------------------------------------------------------------ svg helpers
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function txt(parent, x, y, content, cls, attrs = {}) {
  const t = el("text", { x, y, class: cls, ...attrs }, parent);
  t.textContent = content;
  return t;
}

const pathOf = (pts) => "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");

// ------------------------------------------------------------------ build
const dp = { wires: {}, blocks: {}, hatches: {}, regs: [], pcDigits: [], imemRows: [] };

export function getDatapath() {
  return dp;
}

export function buildDatapath(svg, hooks) {
  dp.svg = svg;
  dp.hooks = hooks;
  const wireLayer = el("g", { class: "wires" }, svg);
  const blockLayer = el("g", { class: "blocks" }, svg);
  const stubLayer = el("g", { class: "stubs" }, svg);
  dp.pulseLayer = el("g", { class: "pulses" }, svg);

  for (const [id, pts] of Object.entries(WIRES)) {
    dp.wires[id] = el("path", { d: pathOf(pts), class: "wire", "data-wire": id }, wireLayer);
  }
  buildStubs(stubLayer);

  // wire captions, like the small labels next to lines in a figure
  txt(wireLayer, 628, 290, "IMM", "fig-label");
  txt(wireLayer, 768, 320, "REG SEL", "fig-label");
  txt(wireLayer, 236, 762, "WRITE-BACK", "fig-label");
  txt(wireLayer, 300, 292, "JUMP TARGET", "fig-label");
  dp.discard = txt(wireLayer, 440, 732, "result discarded", "discard-label", { visibility: "hidden" });

  buildBlocks(blockLayer);
  buildGate(wireLayer);
  buildStamp(svg);
  dp.penLayer = el("g", { class: "red-pen" }, svg);
}

// Pin stubs: short ink lines where a wire meets a block (both ends of every wire).
function buildStubs(layer) {
  const seen = new Set();
  for (const pts of Object.values(WIRES)) {
    for (const [end, next] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
      const key = end.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = Math.sign(next[0] - end[0]) * 6, dy = Math.sign(next[1] - end[1]) * 6;
      el("line", { x1: end[0], y1: end[1], x2: end[0] + dx, y2: end[1] + dy, class: "stub" }, layer);
    }
  }
}

function block(layer, id) {
  const b = BLOCKS[id];
  const g = el("g", { class: "block", "data-block": id }, layer);
  el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "block-box" }, g);
  dp.hatches[id] = el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "hatch" }, g);
  txt(g, b.x + 10, b.y + 17, b.label, "block-label");
  dp.blocks[id] = g;
  return g;
}

function buildBlocks(layer) {
  // ---- U5 PC: two boxed form-field cells; the digits roll vertically
  const pc = block(layer, "pc");
  for (let i = 0; i < 2; i++) {
    const x = 60 + i * 52;
    el("rect", { x, y: 74, width: 48, height: 66, class: "form-cell" }, pc);
    const clip = el("clipPath", { id: `pcClip${i}` }, pc);
    el("rect", { x, y: 75, width: 48, height: 64 }, clip);
    const viewport = el("g", { "clip-path": `url(#pcClip${i})` }, pc);
    const strip = el("g", { class: "counter-strip" }, viewport);
    "0123456789-".split("").forEach((ch, n) => txt(strip, x + 24, 123 + n * PC_PITCH, ch, "pc-digit"));
    dp.pcDigits.push(strip);
  }
  txt(pc, 110, 160, "LINE", "fig-label", { "text-anchor": "middle" });
  dp.pcNext = txt(pc, 110, 204, "", "pc-next", { "text-anchor": "middle" });

  // ---- U6 IMEM: 5-line window of the program (the middle row is the current line)
  const imem = block(layer, "imem");
  dp.imemHi = el("rect", { x: 250, y: 125, width: 260, height: 26, class: "imem-hi" }, imem);
  for (let r = 0; r < 5; r++) {
    const y = 73 + r * 26;
    const row = el("g", { class: "imem-row" }, imem);
    dp.imemRows.push({
      g: row,
      mark: txt(row, 258, y + 18, "", "imem-mark"),
      num: txt(row, 292, y + 18, "", "imem-num", { "text-anchor": "end" }),
      text: txt(row, 304, y + 18, "", "imem-text"),
      under: el("line", { x1: 304, y1: y + 22, x2: 500, y2: y + 22, class: "imem-under" }, row),
      line: null,
    });
  }

  // ---- U1 DECODER: decoded fields
  const dec = block(layer, "decoder");
  dp.decRows = [];
  ["op", "dst", "src"].forEach((key, r) => {
    const y = 98 + r * 34;
    dp.decRows.push({ key: txt(dec, 590, y, key, "dec-key"), val: txt(dec, 636, y, "", "dec-val") });
  });
  dp.decError = txt(dec, 590, 214, "", "dec-error");
  dp.decQuestion = txt(dec, 690, 144, "", "dec-question", { "text-anchor": "middle" });

  // ---- U3 REGFILE: a ledger table  REG | PREV | NOW, and DEC / HEX / BIN tabs
  const rf = block(layer, "regfile");
  dp.formatButtons = {};
  ["dec", "hex", "bin"].forEach((f, i) => {
    const g = el("g", { class: "fmt-tab", role: "button", tabindex: "0",
      "aria-label": `Show registers in ${f.toUpperCase()}` }, rf);
    el("rect", { x: 690 + i * 38, y: 394, width: 36, height: 22, class: "fmt-hit" }, g);
    txt(g, 708 + i * 38, 409, f.toUpperCase(), "fmt-label", { "text-anchor": "middle" });
    el("line", { x1: 696 + i * 38, y1: 414, x2: 720 + i * 38, y2: 414, class: "fmt-under" }, g);
    g.addEventListener("click", () => dp.hooks.onFormatChange(f));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dp.hooks.onFormatChange(f); }
    });
    dp.formatButtons[f] = g;
  });
  const L = LEDGER;
  const bottom = L.top + L.head + 4 * L.row;
  el("line", { x1: L.colReg, y1: L.top, x2: L.right, y2: L.top, class: "ledger-rule-ink" }, rf);
  el("line", { x1: L.colReg, y1: L.top + L.head, x2: L.right, y2: L.top + L.head, class: "ledger-rule-ink" }, rf);
  el("line", { x1: L.colPrev, y1: L.top, x2: L.colPrev, y2: bottom, class: "ledger-rule" }, rf);
  dp.prevRule = el("line", { x1: L.colNow, y1: L.top, x2: L.colNow, y2: bottom, class: "ledger-rule" }, rf);
  txt(rf, L.colReg + 14, L.top + 17, "REG", "ledger-head");
  dp.prevHead = txt(rf, L.colNow - 10, L.top + 17, "PREV", "ledger-head", { "text-anchor": "end" });
  dp.nowHead = txt(rf, L.right - 10, L.top + 17, "NOW", "ledger-head", { "text-anchor": "end" });
  REG_NAMES.forEach((name, i) => {
    const top = L.top + L.head + i * L.row;
    const row = el("g", { class: "ledger-row", "data-reg": name, tabindex: "-1" }, rf);
    el("rect", { x: L.colReg + 1, y: top + 1, width: L.right - L.colReg - 2, height: L.row - 2, class: "ledger-band" }, row);
    if (i < 3) el("line", { x1: L.colReg, y1: top + L.row, x2: L.right, y2: top + L.row, class: "ledger-rule" }, row);
    txt(row, L.colReg + 14, top + 35, name, "ledger-reg");
    const prev = txt(row, L.colNow - 10, top + 35, "—", "ledger-prev", { "text-anchor": "end" });
    const strike = el("line", { class: "ledger-strike", pathLength: "100", visibility: "hidden" }, row);
    const now = txt(row, L.right - 10, top + 35, "0", "ledger-now", { "text-anchor": "end" });
    dp.regs.push({ row, prev, strike, now, top });
    // linked highlighting: hovering (or focusing) a ledger row highlights that register
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Register ${name}`);
    row.addEventListener("mouseenter", () => dp.hooks.onRegHover(name));
    row.addEventListener("mouseleave", () => dp.hooks.onRegHover(null));
    row.addEventListener("focus", () => dp.hooks.onRegHover(name));
    row.addEventListener("blur", () => dp.hooks.onRegHover(null));
  });

  // ---- U2 ALU: the classic trapezoid with a V-notch
  const alu = el("g", { class: "block alu", "data-block": "alu" }, layer);
  el("polygon", { points: ALU_SHAPE, class: "block-box" }, alu);
  dp.hatches.alu = el("polygon", { points: ALU_SHAPE, class: "hatch" }, alu);
  txt(alu, 250, 424, "U2 ALU", "block-label");
  txt(alu, 440, 455, "B", "alu-port", { "text-anchor": "end" });
  txt(alu, 440, 615, "A", "alu-port", { "text-anchor": "end" });
  dp.aluSymbol = txt(alu, ALU_CENTRE.x + 6, ALU_CENTRE.y + 12, "", "alu-symbol", { "text-anchor": "middle" });
  dp.oneChip = el("g", { class: "one-chip", visibility: "hidden" }, alu);
  el("rect", { x: 458, y: 420, width: 24, height: 20 }, dp.oneChip);
  txt(dp.oneChip, 470, 435, "1", "", { "text-anchor": "middle" });
  dp.blocks.alu = alu;

  // ---- U4 FLAGS: ZF SF CF as printed circles in a row (hollow ring = 0, solid disc = 1)
  const flags = block(layer, "flags");
  const FLAG_INFO = [["ZF", "zero"], ["SF", "sign"], ["CF", "carry"]];
  dp.flagDisc = {};
  dp.flagText = {};
  FLAG_INFO.forEach(([name, meaning], i) => {
    const cx = 60 + i * 50;                   // 3 columns inside the 160 px block (x 30..190)
    dp.flagDisc[name] = el("circle", { cx, cy: 500, r: 19, class: "zf-disc" }, flags);
    txt(flags, cx, 554, name, "flag-name", { "text-anchor": "middle" });
    dp.flagText[name] = txt(flags, cx, 576, "0", "flag-value", { "text-anchor": "middle" });
    txt(flags, cx, 604, meaning, "zf-caption", { "text-anchor": "middle" });
  });
}

function buildGate(layer) {
  const g = el("g", { class: "gate" }, layer);
  const { x, y } = GATE;
  el("polygon", { points: `${x},${y - 12} ${x + 12},${y} ${x},${y + 12} ${x - 12},${y}`, class: "gate-box" }, g);
  dp.gateCross = el("path", { d: `M ${x - 4} ${y - 4} L ${x + 4} ${y + 4} M ${x + 4} ${y - 4} L ${x - 4} ${y + 4}`,
    class: "gate-cross", visibility: "hidden" }, g);
  dp.gate = g;
}

// A red rubber stamp in the empty gap between the two rows (never over the ledger).
function buildStamp(svg) {
  dp.stamp = el("g", { class: "halt-stamp", transform: "rotate(-6 380 312)", visibility: "hidden" }, svg);
  const ink = el("g", { filter: "url(#stampInk)" }, dp.stamp);
  el("rect", { x: 240, y: 272, width: 280, height: 80 }, ink);
  el("rect", { x: 246, y: 278, width: 268, height: 68 }, ink);
  txt(ink, 380, 330, "HALTED", "", { "text-anchor": "middle" });
}

// ------------------------------------------------------------------ setters (also used by the animator)
export function formatValue(v) {
  if (state.regFormat === "hex") return "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
  if (state.regFormat === "bin") return (v >>> 0).toString(2).padStart(32, "0").match(/.{8}/g).join(" ");
  return String(v);
}

// Show register i: `prev` (struck through) only when the value just changed.
export function setRegister(i, now, prev = null, fresh = false) {
  const r = dp.regs[i];
  r.now.textContent = formatValue(now);
  r.now.classList.remove("fresh");
  r.strike.setAttribute("visibility", "hidden");
  const bin = state.regFormat === "bin";
  r.prev.textContent = prev === null || bin ? "—" : formatValue(prev);
  r.prev.setAttribute("visibility", bin ? "hidden" : "visible");
  if (prev !== null && !bin) {
    const width = r.prev.getComputedTextLength();
    const y = r.top + 29;                          // through the middle of the digits
    r.strike.setAttribute("x1", LEDGER.colNow - 12 - width);
    r.strike.setAttribute("x2", LEDGER.colNow - 8);
    r.strike.setAttribute("y1", y);
    r.strike.setAttribute("y2", y - 2);
    r.strike.setAttribute("visibility", "visible");
  }
  if (fresh) {                         // new value written in red, settles to ink (CSS)
    void r.now.getBoundingClientRect();
    r.now.classList.add("fresh");
  }
}

// Show the three flags; f = { zf, sf, cf } (each 0 or 1), e.g. stateAt(k).
export function setFlags(f) {
  for (const name of ["ZF", "SF", "CF"]) {
    const v = f[name.toLowerCase()];
    dp.flagDisc[name].classList.toggle("on", v === 1);
    dp.flagText[name].textContent = String(v);
  }
}

// Roll the PC cells to a line number (null shows "--").
export function rollPC(line) {
  const digits = line == null ? [10, 10] : [Math.floor(line / 10) % 10, line % 10];
  digits.forEach((d, i) => { dp.pcDigits[i].style.transform = `translateY(${-d * PC_PITCH}px)`; });
}

// The small line under the PC cells: "next → 04", "halted", ... tone "" | "spot"
export function setNext(content, tone = "") {
  dp.pcNext.textContent = content;
  dp.pcNext.dataset.tone = tone;
}

// Show lines around `centre` in the IMEM window and mark the centre row.
export function setImem(centre, tone = "current") {
  const lines = state.resultCode ? state.resultCode.split("\n") : state.code.split("\n");
  const first = centre ? centre - 2 : 1;
  dp.imemRows.forEach((row, r) => {
    const n = first + r;
    const exists = n >= 1 && n <= lines.length && !(n === lines.length && lines[n - 1] === "");
    row.line = exists ? n : null;
    row.num.textContent = exists ? String(n).padStart(2, "0") : "";
    const t = exists ? lines[n - 1].trim() : "";
    row.text.textContent = t.length > 22 ? t.slice(0, 21) + "…" : t;     // 22 chars fit at 16px
    const isCentre = Boolean(centre) && n === centre;
    row.mark.textContent = isCentre ? "▶" : "";
    row.g.dataset.current = String(isCentre);
  });
  dp.imemHi.dataset.tone = centre ? tone : "";
  markImemHover();
}

// Linked highlighting: draw the wires that carry register `reg` in the current step
// heavy (dst -> ALU A and the write-back; src -> ALU B). null = none.
export function setRegWires(reg) {
  for (const w of Object.values(dp.wires)) w.classList.remove("linked");
  if (!reg || state.cursor < 1) return;
  const d = describeStep(state.cursor);
  if (!["MOV", "ADD", "SUB", "CMP", "INC", "DEC"].includes(d.op)) return;
  if (d.a === reg) {
    if (d.op !== "MOV") dp.wires.reg_a.classList.add("linked");
    if (d.op !== "CMP") dp.wires.writeback.classList.add("linked");
    dp.wires.dec_reg.classList.add("linked");
  }
  if (d.b === reg) dp.wires.reg_b.classList.add("linked");
}

// Linked highlighting: underline the IMEM row of a highlighted line, if it is visible.
let imemHoverLine = null;
export function setImemHover(line) {
  imemHoverLine = line;
  markImemHover();
}
function markImemHover() {
  for (const row of dp.imemRows) row.g.dataset.hover = String(row.line !== null && row.line === imemHoverLine);
}

const OP_SYMBOL = { MOV: "pass", ADD: "+", SUB: "−", CMP: "cmp", INC: "+1", DEC: "−1",
  JMP: "jmp", JZ: "jz", JNZ: "jnz", JS: "js", JNS: "jns", JC: "jc", JNC: "jnc", HLT: "halt" };

// Decoder fields for a line (display only).
export function decodedFields(op, a, b) {
  const src = (w) => (REG_NAMES.includes(w) ? w : `#${w}`);
  switch (op) {
    case "MOV": case "ADD": case "SUB": case "CMP":
      return [["op", OP_SYMBOL[op]], ["dst", a], ["src", src(b)]];
    case "INC": case "DEC": return [["op", OP_SYMBOL[op]], ["dst", a], ["src", "#1"]];
    case "JMP": return [["op", "jmp"], ["to", `L${a}`], ["if", "always"]];
    case "JZ": case "JNZ": case "JS": case "JNS": case "JC": case "JNC":
      return [["op", OP_SYMBOL[op]], ["to", `L${a}`], ["if", `${JUMP_COND[op][0]} = ${JUMP_COND[op][1]}`]];
    case "HLT": return [["op", "halt"], ["", ""], ["", ""]];
    default: return [["op", ""], ["dst", ""], ["src", ""]];
  }
}

export function setDecoder(fields, { chars = Infinity } = {}) {
  let budget = chars;                        // for the "typing in" effect
  fields.forEach(([k, v], r) => {
    dp.decRows[r].key.textContent = k;
    dp.decRows[r].val.textContent = v.slice(0, Math.max(0, budget));
    budget -= v.length;
  });
}

// ERRSTOP: the red pen circles the decoder, with the note "✗ E1 at line 6".
function setDecoderError(code, line) {
  dp.penLayer.innerHTML = "";
  dp.decError.textContent = "";
  dp.decQuestion.textContent = "";
  if (!code) return;
  const key = `${code}:${line}:${state.resultCode}`;
  dp.penLayer.classList.toggle("drawn", dp.penKey === key);
  dp.penKey = key;
  const g = el("g", { transform: "translate(586 66)" }, dp.penLayer);
  penStrokes(g, 200, 120);
  dp.decError.textContent = `✗ E${code} at line ${line}`;
  dp.decRows.forEach((r) => { r.key.textContent = ""; r.val.textContent = ""; });
  dp.decQuestion.textContent = "?";                  // the decoder could not decode it
}

export function setAluSymbol(op) {
  const sym = { MOV: "PASS", ADD: "+", SUB: "−", CMP: "CMP", INC: "+1", DEC: "−1" }[op] || "";
  dp.aluSymbol.textContent = sym;
  dp.aluSymbol.dataset.size = sym.length > 2 ? "small" : "big";
}

export function setGate(mode) {          // "" | "pass" | "blocked"
  dp.gate.dataset.mode = mode;
  dp.gateCross.setAttribute("visibility", mode === "blocked" ? "visible" : "hidden");
}

// The phase tabs above the figure (null = none active).
const PHASES = ["fetch", "decode", "execute"];
export function setPhase(name) {
  document.querySelectorAll("#phaseStrip li").forEach((li, i) => {
    li.classList.toggle("active", i === PHASES.indexOf(name));
  });
}

export function showOneChip(on) {
  dp.oneChip.setAttribute("visibility", on ? "visible" : "hidden");
}

export function showDiscarded(on) {
  dp.discard.setAttribute("visibility", on ? "visible" : "hidden");
  dp.wires.writeback.classList.toggle("discarded", on);
}

export function showHalted() {
  dp.stamp.setAttribute("visibility", "visible");
  dp.stamp.classList.remove("stamp-in");
  void dp.stamp.getBoundingClientRect();
  dp.stamp.classList.add("stamp-in");
}

// ------------------------------------------------------------------ full state
// Show the complete CPU state after step k. No animation.
export function showState(k) {
  const N = totalSteps();
  const r = state.result;
  const at = stateAt(k);
  const before = stateAt(k - 1);
  const final = r && k === N;
  const errStop = final && r.end.type === "ERRSTOP";
  const halted = final && r.end.type === "HALT" && N > 0;

  at.regs.forEach((v, i) => {
    const changed = k > 0 && before.regs[i] !== v;
    setRegister(i, v, changed ? before.regs[i] : null, false);
  });
  setFlags(at);
  setGate("");
  showDiscarded(false);
  showOneChip(false);
  for (const w of Object.values(dp.wires)) w.removeAttribute("data-on");
  for (const b of Object.values(dp.blocks)) b.removeAttribute("data-on");
  setDecoderError(0);

  if (errStop) {
    const line = r.end.value;
    const code = errorOnLine(line) || (line === 0 ? 9 : 0);
    rollPC(line);
    setNext("stopped here", "spot");
    setImem(line, "error");
    setDecoderError(code, line);
    setAluSymbol("");
  } else if (k > 0) {
    const d = describeStep(k);
    rollPC(d.line);
    if (halted) setNext("halted", "spot");
    else if (d.next) setNext(`next → ${String(d.next).padStart(2, "0")}`, d.taken ? "spot" : "");
    else setNext(r.end.type === "NOHLT" ? "past last line" : "", "");
    setImem(d.line);
    setDecoder(decodedFields(d.op, d.a, d.b));
    setAluSymbol(d.op);
  } else {
    rollPC(null);
    setNext(r ? "ready" : "", "");
    setImem(null);
    setDecoder(decodedFields("", "", ""));
    setAluSymbol("");
  }
  dp.stamp.setAttribute("visibility", halted ? "visible" : "hidden");
  dp.svg.classList.toggle("empty", !state.code.trim());
  renderFormatButtons();
}

function renderFormatButtons() {
  for (const [f, g] of Object.entries(dp.formatButtons)) g.dataset.active = String(state.regFormat === f);
  const bin = state.regFormat === "bin";
  dp.prevHead.setAttribute("visibility", bin ? "hidden" : "visible");
  dp.prevRule.setAttribute("visibility", bin ? "hidden" : "visible");
  dp.nowHead.textContent = bin ? "NOW (BIN)" : "NOW";
  dp.svg.classList.toggle("bin", bin);
}

// Text above the figure + the screen-reader summary of the current step.
export function renderDatapathText(s) {
  const k = s.cursor;
  const r = s.result;
  const cur = document.getElementById("currentInstr");
  const live = document.getElementById("dpLive");
  cur.dataset.tone = "";
  if (r && k === totalSteps() && r.end.type === "ERRSTOP") {
    const line = r.end.value;
    cur.textContent = `L${line} · ${lineText(line) || "error"}`;
    cur.dataset.tone = "spot";
    live.textContent = `Stopped at line ${line}: ${errorInfo(errorOnLine(line) || 9).message}.`;
  } else if (k > 0) {
    const d = describeStep(k);
    cur.textContent = `L${d.line} · ${d.text}`;
    const changed = d.changed.map((i) => `${REG_NAMES[i]} is now ${d.after.regs[i]}`).join(", ");
    live.textContent = `Step ${k}, line ${d.line}, ${d.text}.` + (changed ? ` ${changed}.` : "") +
      d.flagsChanged.map((f) => ` ${f} is now ${d.after[f.toLowerCase()]}.`).join("");
  } else {
    cur.textContent = "";
    live.textContent = r ? "Ready. Step 0." : "";
  }
  document.getElementById("dpCaption").textContent = s.code.trim() === ""
    ? "Write an instruction and press Enter."
    : "Fig. 1 — Mini-CPU datapath. Active paths drawn heavy; data in red.";
}
