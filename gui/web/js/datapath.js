// datapath.js - the CPU datapath drawn as an inline SVG (viewBox 840 x 800,
// close to the real shape of the panel, so nothing is wasted).
//
//   [U5 PC] ----> [U6 IMEM] ----> [U1 DECODER]
//      ^                             |imm   |reg select
//      | jump (via condition gate)   v      v
//   [U4 FLAGS] <---- [U2 ALU] <---- [U3 REGFILE]
//                       |                ^
//                       +-- write-back --+
//
// build() draws everything once. showState(k) sets every part from stateAt(k)
// (data from result.txt). The small setters (setRegister, setZF, rollPC, ...) are
// also used by animator.js while a step is being animated.

import { state, stateAt, describeStep, totalSteps, lineText, errorOnLine, REG_NAMES } from "./state.js";
import { errorInfo } from "./errors.js";
import { createSevenSeg } from "./sevenseg.js";

const NS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ geometry
export const BLOCKS = {
  pc:      { x: 30,  y: 50,  w: 160, h: 180, label: "U5 · PC" },
  imem:    { x: 240, y: 50,  w: 280, h: 180, label: "U6 · IMEM" },
  decoder: { x: 570, y: 50,  w: 240, h: 180, label: "U1 · DECODER" },
  flags:   { x: 30,  y: 400, w: 160, h: 240, label: "U4 · FLAGS" },
  regfile: { x: 500, y: 390, w: 310, h: 300, label: "U3 · REGFILE" },
};
const ALU_SHAPE = "450,410 450,512 430,530 450,548 450,650 250,590 250,470";
const GATE = { x: 200, y: 300 };
const PC_PITCH = 76;                 // distance between digits on the PC counter strip

// Every wire is a route of points; drawn with rounded right-angle corners (PCB traces).
export const WIRES = {
  pc_imem:   [[190, 140], [240, 140]],
  imem_dec:  [[520, 140], [570, 140]],
  dec_reg:   [[760, 230], [760, 390]],                                  // register select
  imm_b:     [[620, 230], [620, 330], [480, 330], [480, 450], [450, 450]], // immediate bus
  reg_b:     [[500, 450], [450, 450]],                                  // source register -> B
  reg_a:     [[500, 610], [450, 610]],                                  // destination register -> A
  alu_flags: [[250, 530], [190, 530]],
  writeback: [[250, 530], [220, 530], [220, 740], [655, 740], [655, 690]],
  jump:      [[570, 200], [545, 200], [545, 300], [110, 300], [110, 230]],  // decoder -> PC
  cond:      [[150, 400], [150, 350], [200, 350], [200, 312]],          // flags -> gate
};
const VIAS = [[190, 140], [240, 140], [520, 140], [570, 140], [760, 230], [760, 390], [620, 230],
  [480, 450], [500, 450], [500, 610], [250, 530], [220, 530], [190, 530], [655, 690],
  [570, 200], [110, 230], [150, 400]];

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

// Path through points with rounded corners of radius r.
export function tracePath(points, r = 10) {
  const sign = (v) => Math.sign(v);
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1];
    const [px, py] = points[i];
    const [bx, by] = points[i + 1];
    const rr = Math.min(r, Math.hypot(px - ax, py - ay) / 2, Math.hypot(bx - px, by - py) / 2);
    d += ` L ${px - sign(px - ax) * rr} ${py - sign(py - ay) * rr}`;
    d += ` Q ${px} ${py} ${px + sign(bx - px) * rr} ${py + sign(by - py) * rr}`;
  }
  const [lx, ly] = points[points.length - 1];
  return d + ` L ${lx} ${ly}`;
}

// ------------------------------------------------------------------ build
const dp = { wires: {}, blocks: {}, regs: [], pcDigits: [] };

export function getDatapath() {
  return dp;
}

export function buildDatapath(svg, { onFormatChange }) {
  dp.svg = svg;
  dp.board = el("g", { class: "dp-board" }, svg);
  const wireLayer = el("g", { class: "wires" }, dp.board);
  const blockLayer = el("g", { class: "blocks" }, dp.board);
  dp.pulseLayer = el("g", { class: "pulses" }, svg);

  for (const [id, pts] of Object.entries(WIRES)) {
    dp.wires[id] = el("path", { d: tracePath(pts), class: "wire", "data-wire": id }, wireLayer);
  }
  for (const [x, y] of VIAS) el("circle", { cx: x, cy: y, r: 3.2, class: "via" }, wireLayer);

  // wire captions (silkscreen next to the traces)
  txt(wireLayer, 628, 290, "IMM", "silk");
  txt(wireLayer, 768, 320, "REG SEL", "silk");
  txt(wireLayer, 236, 762, "WRITE-BACK", "silk");
  txt(wireLayer, 300, 292, "JUMP TARGET", "silk");
  dp.discard = txt(wireLayer, 440, 732, "result discarded", "discard-label", { visibility: "hidden" });

  buildBlocks(blockLayer, onFormatChange);
  buildGate(wireLayer);
  buildStamp(svg);
}

function block(layer, id) {
  const b = BLOCKS[id];
  const g = el("g", { class: "block", "data-block": id }, layer);
  el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, class: "block-box" }, g);
  txt(g, b.x + 12, b.y + 18, b.label, "silk");
  dp.blocks[id] = g;
  return g;
}

function buildBlocks(layer, onFormatChange) {
  // ---- U5 PC: two-digit mechanical counter + "next" line
  const pc = block(layer, "pc");
  for (let i = 0; i < 2; i++) {
    const x = 52 + i * 62;
    el("rect", { x, y: 78, width: 54, height: 80, rx: 6, class: "counter-window" }, pc);
    const clip = el("clipPath", { id: `pcClip${i}` }, pc);
    el("rect", { x, y: 80, width: 54, height: 76 }, clip);
    const viewport = el("g", { "clip-path": `url(#pcClip${i})` }, pc);
    const strip = el("g", { class: "counter-strip" }, viewport);
    // digits 0-9 and a dash stacked 76px apart; the strip slides up and down
    "0123456789-".split("").forEach((ch, n) => txt(strip, x + 27, 137 + n * PC_PITCH, ch, "counter-digit"));
    dp.pcDigits.push(strip);
  }
  dp.pcNext = txt(pc, 110, 200, "", "pc-next", { "text-anchor": "middle" });

  // ---- U6 IMEM: 5-line window of the program
  const imem = block(layer, "imem");
  dp.imemHi = el("rect", { x: 250, y: 127, width: 260, height: 26, rx: 5, class: "imem-hi" }, imem);
  dp.imemRows = [];
  for (let r = 0; r < 5; r++) {
    const y = 75 + r * 26;          // the middle row (r = 2) is the current line
    dp.imemRows.push({
      num: txt(imem, 284, y + 18, "", "imem-num", { "text-anchor": "end" }),
      text: txt(imem, 296, y + 18, "", "imem-text"),
      y,
    });
  }

  // ---- U1 DECODER: decoded fields
  const dec = block(layer, "decoder");
  dp.decRows = [];
  ["op", "dst", "src"].forEach((key, r) => {
    const y = 100 + r * 34;
    dp.decRows.push({
      key: txt(dec, 590, y, key, "dec-key"),
      val: txt(dec, 636, y, "", "dec-val"),
    });
  });
  dp.decQuestion = txt(dec, 772, 158, "?", "dec-question", { "text-anchor": "middle", visibility: "hidden" });
  dp.decError = txt(dec, 590, 212, "", "dec-error");

  // ---- U3 REGFILE: four 7-segment rows + DEC/HEX/BIN toggle
  const rf = block(layer, "regfile");
  dp.formatButtons = {};
  ["dec", "hex", "bin"].forEach((f, i) => {
    const g = el("g", { class: "fmt-btn", role: "button", tabindex: "0",
      "aria-label": `Show registers in ${f.toUpperCase()}` }, rf);
    el("rect", { x: 678 + i * 40, y: 398, width: 36, height: 20, rx: 4, class: "fmt-box" }, g);
    txt(g, 696 + i * 40, 412, f.toUpperCase(), "fmt-label", { "text-anchor": "middle" });
    g.addEventListener("click", () => onFormatChange(f));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFormatChange(f); }
    });
    dp.formatButtons[f] = g;
  });
  REG_NAMES.forEach((name, i) => {
    const top = 434 + i * 62;
    const row = el("g", { class: "reg-row", "data-reg": name }, rf);
    const flash = el("rect", { x: 508, y: top - 6, width: 294, height: 58, rx: 6, class: "reg-flash" }, row);
    txt(row, 516, top + 22, name, "reg-name");
    el("rect", { x: 548, y: top, width: 252, height: 34, rx: 4, class: "seg-window" }, row);
    const seg = createSevenSeg(row, { x: 557, y: top + 5, count: 11, w: 13, h: 24, pitch: 21, t: 3.2 });
    const bin = txt(row, 674, top + 21, "", "reg-bin", { "text-anchor": "middle", visibility: "hidden" });
    const sub = txt(row, 800, top + 48, "", "reg-sub", { "text-anchor": "end" });
    dp.regs.push({ row, flash, seg, bin, sub, top });
  });

  // ---- U2 ALU: chevron shape with A/B inputs and the operation symbol
  const alu = el("g", { class: "block alu", "data-block": "alu" }, layer);
  el("polygon", { points: ALU_SHAPE, class: "block-box alu-box" }, alu);
  txt(alu, 250, 424, "U2 · ALU", "silk");
  txt(alu, 440, 455, "B", "alu-port", { "text-anchor": "end" });
  txt(alu, 440, 615, "A", "alu-port", { "text-anchor": "end" });
  dp.aluSymbol = txt(alu, 356, 544, "", "alu-symbol", { "text-anchor": "middle" });
  dp.oneChip = el("g", { class: "one-chip", visibility: "hidden" }, alu);
  el("rect", { x: 456, y: 420, width: 28, height: 20, rx: 4 }, dp.oneChip);
  txt(dp.oneChip, 470, 434, "1", "", { "text-anchor": "middle" });
  dp.blocks.alu = alu;

  // ---- U4 FLAGS: the ZF LED
  const flags = block(layer, "flags");
  el("circle", { cx: 110, cy: 500, r: 36, class: "led-bezel" }, flags);
  dp.led = el("circle", { cx: 110, cy: 500, r: 26, class: "led" }, flags);
  el("circle", { cx: 101, cy: 490, r: 7, class: "led-shine" }, flags);
  txt(flags, 110, 572, "ZF", "led-label", { "text-anchor": "middle" });
  txt(flags, 110, 596, "= 0 ? 1", "led-caption", { "text-anchor": "middle" });
}

function buildGate(layer) {
  const g = el("g", { class: "gate" }, layer);
  const { x, y } = GATE;
  el("polygon", { points: `${x},${y - 12} ${x + 12},${y} ${x},${y + 12} ${x - 12},${y}`, class: "gate-box" }, g);
  dp.gateCross = el("path", { d: `M ${x - 5} ${y - 5} L ${x + 5} ${y + 5} M ${x + 5} ${y - 5} L ${x - 5} ${y + 5}`,
    class: "gate-cross", visibility: "hidden" }, g);
  dp.gate = g;
}

function buildStamp(svg) {
  // sits in the open gap between the two rows, so the register file stays readable
  dp.stamp = el("g", { class: "halt-stamp", transform: "rotate(-8 380 312)", visibility: "hidden" }, svg);
  el("rect", { x: 220, y: 270, width: 320, height: 84, rx: 12 }, dp.stamp);
  txt(dp.stamp, 380, 333, "HALTED", "", { "text-anchor": "middle" });
}

// ------------------------------------------------------------------ setters (also used by the animator)
function formatReg(v) {
  const fmt = state.regFormat;
  if (fmt === "hex") {
    const hex = (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
    const firstSig = Math.min(hex.search(/[^0]/) === -1 ? 7 : hex.search(/[^0]/), 7);
    return { text: hex, dim: hex.split("").map((_, i) => i < firstSig), sub: `= ${v}` };
  }
  const digits = String(Math.abs(v)).padStart(10, "0");
  const firstSig = Math.min(digits.search(/[^0]/) === -1 ? 9 : digits.search(/[^0]/), 9);
  const text = (v < 0 ? "-" : " ") + digits;
  return {
    text,
    dim: text.split("").map((_, i) => i >= 1 && i - 1 < firstSig),
    sub: "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0"),
  };
}

export function setRegister(i, value) {
  const r = dp.regs[i];
  if (state.regFormat === "bin") {
    const bits = (value >>> 0).toString(2).padStart(32, "0");
    r.bin.textContent = bits.match(/.{8}/g).join(" ");
    r.bin.setAttribute("visibility", "visible");
    r.seg.el.setAttribute("visibility", "hidden");
    r.sub.textContent = `= ${value}`;
  } else {
    const f = formatReg(value);
    r.seg.set(f.text, f.dim);
    r.seg.el.setAttribute("visibility", "visible");
    r.bin.setAttribute("visibility", "hidden");
    r.sub.textContent = f.sub;
  }
}

export function setZF(z) {
  dp.led.classList.toggle("on", z === 1);
}

// Roll the counter to a line number (null shows "--"). colour: "normal" | "amber" | "red"
export function rollPC(line, colour = "normal") {
  const digits = line == null ? [10, 10] : [Math.floor(line / 10) % 10, line % 10];
  digits.forEach((d, i) => { dp.pcDigits[i].style.transform = `translateY(${-d * PC_PITCH}px)`; });
  dp.blocks.pc.dataset.colour = line == null ? "idle" : colour;
}

export function setNext(content, colour = "") {
  dp.pcNext.textContent = content;
  dp.pcNext.dataset.colour = colour;
}

// Show lines around `centre` in the IMEM window; highlight `centre` (tone "cyan" | "red" | "").
export function setImem(centre, tone = "cyan") {
  const lines = state.resultCode ? state.resultCode.split("\n") : state.code.split("\n");
  const first = centre ? centre - 2 : 1;
  dp.imemRows.forEach((row, r) => {
    const n = first + r;
    const exists = n >= 1 && n <= lines.length && !(n === lines.length && lines[n - 1] === "");
    row.num.textContent = exists ? String(n).padStart(2, "0") : "";
    const t = exists ? lines[n - 1].trim() : "";
    row.text.textContent = t.length > 26 ? t.slice(0, 25) + "…" : t;
    row.text.dataset.active = String(Boolean(centre) && n === centre);
  });
  dp.imemHi.dataset.tone = centre ? tone : "";
}

// Decoder fields for a line (display only), or the error view.
const OP_SYMBOL = { MOV: "pass", ADD: "+", SUB: "−", CMP: "cmp", INC: "+1", DEC: "−1",
  JMP: "jmp", JZ: "jz", JNZ: "jnz", HLT: "halt" };

export function decodedFields(op, a, b) {
  const isReg = (w) => REG_NAMES.includes(w);
  const src = (w) => (isReg(w) ? w : `#${w}`);
  switch (op) {
    case "MOV": case "ADD": case "SUB": case "CMP":
      return [["op", OP_SYMBOL[op]], ["dst", a], ["src", src(b)]];
    case "INC": case "DEC": return [["op", OP_SYMBOL[op]], ["dst", a], ["src", "#1"]];
    case "JMP": return [["op", "jmp"], ["to", `L${a}`], ["if", "always"]];
    case "JZ": return [["op", "jz"], ["to", `L${a}`], ["if", "ZF = 1"]];
    case "JNZ": return [["op", "jnz"], ["to", `L${a}`], ["if", "ZF = 0"]];
    case "HLT": return [["op", "halt"], ["", ""], ["", ""]];
    default: return [["op", "—"], ["dst", "—"], ["src", "—"]];
  }
}

export function setDecoder(fields, { error = null, chars = Infinity } = {}) {
  dp.blocks.decoder.dataset.tone = error ? "red" : "";
  dp.decQuestion.setAttribute("visibility", error ? "visible" : "hidden");
  dp.decError.textContent = error || "";
  let budget = chars;                      // for the "typing in" effect
  fields.forEach(([k, v], r) => {
    dp.decRows[r].key.textContent = k;
    const shown = v.slice(0, Math.max(0, budget));
    budget -= v.length;
    dp.decRows[r].val.textContent = shown;
  });
}

export function setAluSymbol(op, active = false) {
  const sym = { MOV: "PASS", ADD: "+", SUB: "−", CMP: "CMP", INC: "+1", DEC: "−1" }[op] || "";
  dp.aluSymbol.textContent = sym || "·";
  dp.aluSymbol.dataset.size = sym.length > 2 ? "small" : "big";
  dp.blocks.alu.dataset.active = String(active && Boolean(sym));
}

export function setGate(mode) {          // "" | "pass" | "blocked"
  dp.gate.dataset.mode = mode;
  dp.gateCross.setAttribute("visibility", mode === "blocked" ? "visible" : "hidden");
}

// Highlight one phase in the strip above the SVG (null = all idle).
const PHASES = ["fetch", "decode", "execute"];
export function setPhase(name) {
  const index = PHASES.indexOf(name);
  document.querySelectorAll("#phaseStrip li").forEach((li, i) => {
    li.classList.toggle("active", i === index);
    li.classList.toggle("done", index >= 0 && i < index);
  });
}

// Purple -> green outline flash on a register, plus a "+4" tag that floats up.
export function flashRegister(i, delta) {
  const r = dp.regs[i];
  r.row.removeAttribute("data-flash");
  void r.row.getBoundingClientRect();          // restart the CSS animation
  r.row.setAttribute("data-flash", "");
  if (!delta) return;
  const tag = txt(r.row, 800, r.top - 8, (delta > 0 ? "+" : "−") + Math.abs(delta), "delta-tag",
                  { "text-anchor": "end" });
  setTimeout(() => tag.remove(), 900);
}

export function showOneChip(on) {
  dp.oneChip.setAttribute("visibility", on ? "visible" : "hidden");
}

export function showDiscarded(on) {
  dp.discard.setAttribute("visibility", on ? "visible" : "hidden");
  if (on) dp.wires.writeback.dataset.on = "muted";
  else delete dp.wires.writeback.dataset.on;
}

export function showHalted() {
  dp.svg.classList.add("halted");
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
  const final = r && k === N;
  const errStop = final && r.end.type === "ERRSTOP";
  const halted = final && r.end.type === "HALT" && N > 0;

  at.regs.forEach((v, i) => setRegister(i, v));
  setZF(at.zf);
  setGate("");
  dp.discard.setAttribute("visibility", "hidden");
  dp.oneChip.setAttribute("visibility", "hidden");
  for (const w of Object.values(dp.wires)) w.removeAttribute("data-on");
  for (const b of Object.values(dp.blocks)) b.removeAttribute("data-on");
  dp.regs.forEach((x) => x.row.removeAttribute("data-flash"));

  if (errStop) {
    const line = r.end.value;
    const code = errorOnLine(line) || (line === 0 ? 9 : 0);
    rollPC(line, "red");
    setNext("stopped here", "red");
    setImem(line, "red");
    setDecoder([["op", "?"], ["", ""], ["", ""]], { error: errorInfo(code).message });
    setAluSymbol("");
  } else if (k > 0) {
    const d = describeStep(k);
    rollPC(d.line);
    if (halted) setNext("halted", "green");
    else if (d.next) setNext(`next → ${String(d.next).padStart(2, "0")}`, d.taken ? "amber" : "");
    else setNext(r.end.type === "NOHLT" ? "past last line" : "", "");
    setImem(d.line);
    setDecoder(decodedFields(d.op, d.a, d.b));
    setAluSymbol(d.op);
  } else {
    rollPC(null);
    setNext(state.result ? "ready" : "", "");
    setImem(null);
    setDecoder([["op", ""], ["dst", ""], ["src", ""]]);
    setAluSymbol("");
  }
  dp.svg.classList.toggle("halted", halted);
  dp.stamp.setAttribute("visibility", halted ? "visible" : "hidden");
  renderFormatButtons();
}

function renderFormatButtons() {
  for (const [f, g] of Object.entries(dp.formatButtons)) g.dataset.active = String(state.regFormat === f);
}

// Header text above the SVG + the screen-reader summary of the current step.
export function renderDatapathText(s) {
  const k = s.cursor;
  const r = s.result;
  const cur = document.getElementById("currentInstr");
  const live = document.getElementById("dpLive");
  cur.dataset.tone = "";
  if (r && k === totalSteps() && r.end.type === "ERRSTOP") {
    const line = r.end.value;
    cur.textContent = `L${line} · ${lineText(line) || "error"}`;
    cur.dataset.tone = "red";
    live.textContent = `Stopped at line ${line}: ${errorInfo(errorOnLine(line) || 9).message}.`;
  } else if (k > 0) {
    const d = describeStep(k);
    cur.textContent = `L${d.line} · ${d.text}`;
    const changed = d.changed.map((i) => `${REG_NAMES[i]} is now ${d.after.regs[i]}`).join(", ");
    live.textContent = `Step ${k}, line ${d.line}, ${d.text}.` + (changed ? ` ${changed}.` : "") +
      (d.zfChanged ? ` ZF is now ${d.after.zf}.` : "");
  } else {
    cur.textContent = "";
    live.textContent = r ? "Ready. Step 0." : "";
  }
  document.getElementById("dpCaption").hidden = s.code.trim() !== "" || s.engine.state === "missing";
}
