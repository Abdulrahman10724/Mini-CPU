// chip.js - Fig. 0 on the cover: the MINI-CPU drawn as a 40-pin DIP package.
//
// - plotter intro: outline, then pins, then labels are drawn in (once per app start)
// - idle demo:     replays the REAL trace of demo 03 (run once by CPU.exe through the
//                  bridge); on each step the pins of that instruction are inked in
// - hover a pin:   it is drawn heavy and a paper slip explains it
// - click the body: "zoom into the die" and open §2 Workbench
// The pin names are a teaching picture of our datapath, not a real electrical chip.

import { REG_NAMES } from "./state.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

// Package geometry (viewBox 0 0 560 640)
const BODY = { x: 180, y: 30, w: 200, h: 560 };
const PITCH = 26;
const FIRST = BODY.y + (BODY.h - 19 * PITCH) / 2;        // y of pin 1 / pin 40

// Left side: pins 1..20 from the top. Right side: pins 40..21 from the top.
const LEFT = ["VCC", "CLK", "RST", "AX0", "AX1", "AX2", "AX3", "BX0", "BX1", "CX0",
  "CX1", "DX0", "DX1", "IMM0", "IMM1", "IMM2", "IMM3", "RSEL0", "RSEL1", "WB"];
const RIGHT = ["PC0", "PC1", "PC2", "PC3", "PC4", "PC5", "ZF", "HLT", "JMP", "ALU0",
  "ALU1", "ALU2", "OP0", "OP1", "OP2", "OP3", "FET", "DEC", "EXE", "GND"];

// What each pin means in our CPU (shown in the hover slip)
function pinInfo(name) {
  const reg = name.match(/^(AX|BX|CX|DX)(\d)$/);
  if (reg) return `${name} — ${reg[1]} bus, line ${reg[2]}. Active when ${reg[1]} is read or written.`;
  const bit = name.match(/^(PC|IMM|OP|ALU|RSEL)(\d)$/);
  if (bit) {
    const what = {
      PC: "Program counter: the line number being executed, in binary",
      IMM: "Immediate bus: a number written in the instruction (MOV AX, 5)",
      OP: "Opcode from the decoder (MOV = 1 … HLT = 10), in binary",
      ALU: "ALU operation select (pass, add, subtract, compare)",
      RSEL: "Register select from the decoder (AX = 0 … DX = 3)",
    }[bit[1]];
    return `${name} — ${what}, bit ${bit[2]}.`;
  }
  return {
    VCC: "VCC — Power supply. Always on.",
    GND: "GND — Ground.",
    CLK: "CLK — Clock. One pulse for every executed step.",
    RST: "RST — Reset. The CPU starts at line 1 with every register 0.",
    WB: "WB — Write-back. The ALU result is stored into a register.",
    ZF: "ZF — Zero Flag. 1 when the last ADD/SUB/INC/DEC/CMP result was zero.",
    HLT: "HLT — Halt. Active when the HLT instruction runs.",
    JMP: "JMP — Jump taken. The next line comes from the jump target.",
    FET: "FET — Fetch phase: the instruction is read from memory.",
    DEC: "DEC — Decode phase: the instruction is split into its fields.",
    EXE: "EXE — Execute phase: the ALU works and results are stored.",
  }[name] || name;
}

const OPS = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC", "JMP", "JZ", "JNZ", "HLT"];

let svg = null;
let hooks = null;
const pins = new Map();             // name -> { g, leg }
let introDone = false;
let demo = null;                    // { steps, lines, end } of demo 03
let demoTimer = null;
let demoK = 0;
let visible = false;                // the cover is on screen

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

// ------------------------------------------------------------------ drawing
export function initChip(chipHooks) {
  hooks = chipHooks;
  svg = $("chip");
  const { x, y, w, h } = BODY;
  const cx = x + w / 2;

  // the package outline with the notch at the top (one path, so the plotter can draw it)
  const body = el("g", { class: "chip-body", tabindex: "0", role: "button",
    "aria-label": "Open the workbench (zoom into the die)" }, svg);
  el("path", { class: "chip-outline plot", pathLength: "1",
    d: `M ${x} ${y} H ${cx - 16} A 16 16 0 0 0 ${cx + 16} ${y} H ${x + w} V ${y + h} H ${x} Z` }, body);
  el("circle", { class: "chip-dot plot-late", cx: x + 18, cy: y + 18, r: 4 }, body);
  const mark = el("g", { class: "chip-mark plot-label" }, body);
  [["MCPU-01", 24, 600, -12], ["x86 MASM", 15, 500, 16], ["BDS-3A-07  2646", 12, 400, 40]].forEach(([t, size, weight, dy]) => {
    const tx = el("text", { x: cx, y: y + h / 2 + dy, "text-anchor": "middle",
      style: `font-size:${size}px;font-weight:${weight}` }, mark);
    tx.textContent = t;
  });

  // 40 pins: a short leg outside the body, the number outside, the name inside
  const drawPin = (name, number, side, i) => {
    const py = FIRST + i * PITCH;
    const g = el("g", { class: "pin", "data-pin": name }, svg);
    const legX = side === "L" ? x - 26 : x + w;
    const leg = el("rect", { class: "pin-leg plot", pathLength: "1", x: legX, y: py - 5, width: 26, height: 10 }, g);
    leg.style.animationDelay = `${0.55 + i * 0.02}s`;
    const num = el("text", { class: "pin-num plot-label", x: side === "L" ? x - 32 : x + w + 32, y: py + 4,
      "text-anchor": side === "L" ? "end" : "start" }, g);
    num.textContent = number;
    const label = el("text", { class: "pin-name plot-label", x: side === "L" ? x + 10 : x + w - 10, y: py + 4,
      "text-anchor": side === "L" ? "start" : "end" }, g);
    label.textContent = name;
    el("rect", { class: "pin-hit", x: side === "L" ? x - 60 : x + w - 60, y: py - PITCH / 2, width: 120, height: PITCH }, g);
    g.addEventListener("mouseenter", (e) => showPin(name, g, e));
    g.addEventListener("mouseleave", () => hidePin(g));
    pins.set(name, { g, leg });
  };
  LEFT.forEach((name, i) => drawPin(name, i + 1, "L", i));
  RIGHT.forEach((name, i) => drawPin(name, 40 - i, "R", i));

  body.addEventListener("click", zoomIntoDie);
  body.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); zoomIntoDie(); } });
  svg.addEventListener("click", skipIntro);
}

// ------------------------------------------------------------------ plotter intro (once)
export function chipShown() {
  visible = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!introDone && !reduced) {
    introDone = true;
    svg.classList.add("plotting");                 // CSS draws outline -> pins -> labels
    setTimeout(() => { svg.classList.remove("plotting"); startDemo(); }, 1500);
  } else {
    introDone = true;
    startDemo();
  }
}

function skipIntro() {
  if (svg.classList.contains("plotting")) svg.classList.remove("plotting");
}

export function chipHidden() {
  visible = false;
  clearTimeout(demoTimer);
  demoTimer = null;
}

// ------------------------------------------------------------------ idle demo
// demo = { steps, code, end } from the bridge (CPU.exe ran demo 03 once)
export function setDemoTrace(trace) {
  demo = trace ? { steps: trace.result.steps, lines: trace.code.split("\n"), end: trace.result.end } : null;
  if (visible && introDone && !svg.classList.contains("plotting") && !demoTimer) startDemo();
}

function startDemo() {
  clearTimeout(demoTimer);
  if (!demo || demo.steps.length === 0) { $("chipReadout").textContent = ""; return; }
  demoK = 0;
  tick();
}

function tick() {
  demoK += 1;
  if (demoK > demo.steps.length) {                 // pause, then start again
    clearPins();
    $("chipReadout").textContent = `${demo.end.type} ${demo.end.value}`;
    demoK = 0;
    demoTimer = setTimeout(tick, 1800);
    return;
  }
  lightStep(demoK);
  demoTimer = setTimeout(tick, 600);
}

function clearPins() {
  for (const { g } of pins.values()) g.classList.remove("lit", "clk");
}

function light(names) {
  for (const n of names) { const p = pins.get(n); if (p) p.g.classList.add("lit"); }
}

const bits = (value, prefix, count) =>
  Array.from({ length: count }, (_, i) => ((value >> i) & 1 ? `${prefix}${i}` : null)).filter(Boolean);

const REG_PINS = { AX: ["AX0", "AX1", "AX2", "AX3"], BX: ["BX0", "BX1"], CX: ["CX0", "CX1"], DX: ["DX0", "DX1"] };

// Ink in the pins used by step k of the recorded trace (display only).
function lightStep(k) {
  clearPins();
  const st = demo.steps[k - 1];
  const text = (demo.lines[st.line - 1] || "").trim();
  const [op = "", a = "", b = ""] = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
  const opNo = OPS.indexOf(op) + 1;
  const next = k < demo.steps.length ? demo.steps[k].line : null;
  const taken = ["JMP", "JZ", "JNZ"].includes(op) && next === parseInt(a, 10);

  light(["VCC"]);
  pins.get("CLK").g.classList.add("clk");          // the only red: a tick on CLK every step
  light(bits(st.line, "PC", 6));
  light(bits(opNo, "OP", 4));
  if (REG_PINS[a]) light(REG_PINS[a]);
  if (REG_PINS[b]) light(REG_PINS[b]);
  if (REG_NAMES.includes(a)) light(bits(REG_NAMES.indexOf(a), "RSEL", 2));
  if (/^-?\d+$/.test(b)) light(bits(Math.abs(parseInt(b, 10)), "IMM", 4));
  if (opNo >= 1 && opNo <= 6) light(bits(opNo, "ALU", 3));
  if (["MOV", "ADD", "SUB", "INC", "DEC"].includes(op)) light(["WB"]);
  if (st.zf === 1) light(["ZF"]);
  if (taken) light(["JMP"]);
  if (op === "HLT") light(["HLT"]);
  // the three phases, one after the other inside the step
  light(["FET"]);
  setTimeout(() => { pins.get("FET").g.classList.remove("lit"); light(["DEC"]); }, 200);
  setTimeout(() => { pins.get("DEC").g.classList.remove("lit"); light(["EXE"]); }, 400);

  const regs = { AX: st.ax, BX: st.bx, CX: st.cx, DX: st.dx };
  const shown = REG_NAMES.includes(a) && !["CMP"].includes(op) ? ` · ${a}=${regs[a]}` : op === "CMP" ? ` · ZF=${st.zf}` : "";
  $("chipReadout").textContent = `t=${k} · L${st.line} ${text.replace(/,\s*/g, ",")}${shown}`;
}

// ------------------------------------------------------------------ hover a pin
function showPin(name, g, e) {
  g.classList.add("hover");
  hooks.onPinHover(pinInfo(name), e.target.closest(".pin").getBoundingClientRect());
}

function hidePin(g) {
  g.classList.remove("hover");
  hooks.onPinHover(null);
}

// ------------------------------------------------------------------ zoom into the die
function zoomIntoDie() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { hooks.onEnterDie(); return; }
  svg.classList.add("zooming");                    // CSS: scale up and dissolve (400 ms)
  setTimeout(() => {
    hooks.onEnterDie();
    svg.classList.remove("zooming");
  }, 380);
}
