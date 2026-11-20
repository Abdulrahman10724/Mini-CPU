// animator.js - plays the TRANSITION from step k-1 to step k on the datapath.
//
// 1. show the CPU state before the step (showState(k - 1))
// 2. run the beats from choreography.js frame by frame (requestAnimationFrame)
// 3. show the exact state after the step (showState(final))
// Because step 3 always draws the real state, skipping or cancelling an animation
// can never leave the screen wrong.

import { describeStep } from "./state.js";
import { choreograph } from "./choreography.js";
import { getDatapath, showState, setPhase } from "./datapath.js";

const SVG = "http://www.w3.org/2000/svg";
const COLOURS = { cyan: "var(--cyan)", amber: "var(--amber)", green: "var(--green)",
  orange: "var(--orange)", purple: "var(--purple)" };
const TAIL = 3;                      // fading copies behind each pulse

export const STEP_MS = { "0.25": 4800, "0.5": 2400, "1": 1200, "2": 600 };

let current = null;                  // the animation now running, or null

export function isAnimating() {
  return current !== null;
}

// Animate step k over `ms` milliseconds; afterwards show the state of step `finalK`.
// Resolves true when finished, false when cancelled.
export function playStep(k, ms, finalK = k) {
  cancelAnimation();
  const beats = choreograph(describeStep(k));
  showState(k - 1);
  const anim = { beats, ms, finalK, start: performance.now(), pulses: new Map(), raf: 0 };
  current = anim;
  return new Promise((resolve) => {
    anim.resolve = resolve;
    anim.raf = requestAnimationFrame((now) => frame(anim, now));
  });
}

export function cancelAnimation() {
  if (!current) return;
  const anim = current;
  cancelAnimationFrame(anim.raf);
  cleanup(anim);
  current = null;
  anim.resolve(false);
}

function frame(anim, now) {
  const t = Math.min(1, (now - anim.start) / anim.ms);
  for (const b of anim.beats) {
    const len = b.len || 0;
    if (t < b.at || b.done) continue;
    if (!b.started) { b.started = true; startBeat(anim, b); }
    const f = len > 0 ? Math.min(1, (t - b.at) / len) : 1;
    updateBeat(anim, b, f);
    if (f >= 1) { b.done = true; endBeat(anim, b); }
  }
  if (t >= 1) {
    cleanup(anim);
    current = null;
    showState(anim.finalK);
    anim.resolve(true);
    return;
  }
  anim.raf = requestAnimationFrame((n) => frame(anim, n));
}

// ------------------------------------------------------------------ beats
function startBeat(anim, b) {
  const dp = getDatapath();
  if (b.run) b.run();
  if (b.glow) dp.blocks[b.glow].dataset.on = b.colour;
  if (b.pulse) {
    dp.wires[b.pulse].dataset.on = b.colour;
    anim.pulses.set(b, makePulse(dp.pulseLayer, b.colour, b.label));
  }
}

function updateBeat(anim, b, f) {
  if (b.progress) b.progress(f);
  if (b.pulse) movePulse(anim.pulses.get(b), getDatapath().wires[b.pulse], ease(f));
}

function endBeat(anim, b) {
  const dp = getDatapath();
  if (b.glow) delete dp.blocks[b.glow].dataset.on;
  if (b.pulse) {
    delete dp.wires[b.pulse].dataset.on;          // the wire fades back to grey (CSS, 400 ms)
    const p = anim.pulses.get(b);
    if (p) p.group.remove();
    anim.pulses.delete(b);
  }
}

function cleanup(anim) {
  for (const b of anim.beats) if (b.started && !b.done) endBeat(anim, b);
  for (const p of anim.pulses.values()) p.group.remove();
  anim.pulses.clear();
  setPhase(null);
}

// ------------------------------------------------------------------ pulses
// A pulse = a 6 px dot with 3 fading copies behind it, and an optional value label.
function makePulse(layer, colour, label) {
  const group = document.createElementNS(SVG, "g");
  group.setAttribute("class", "pulse");
  const fill = COLOURS[colour] || COLOURS.cyan;
  const dots = [];
  for (let i = TAIL; i >= 0; i--) {
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("r", i === 0 ? 6 : 6 - i * 1.2);
    c.style.fill = fill;
    c.style.opacity = i === 0 ? 1 : 0.5 - i * 0.12;
    if (i === 0) c.style.filter = `drop-shadow(0 0 6px ${fill})`;
    group.append(c);
    dots[i] = c;
  }
  let text = null;
  if (label !== undefined && label !== "") {
    text = document.createElementNS(SVG, "text");
    text.setAttribute("class", "pulse-label");
    text.setAttribute("text-anchor", "middle");
    text.style.fill = fill;
    text.textContent = label;
    group.append(text);
  }
  layer.append(group);
  return { group, dots, text };
}

function movePulse(p, path, f) {
  if (!p) return;
  const total = path.getTotalLength();
  p.dots.forEach((dot, i) => {
    const pt = path.getPointAtLength(Math.max(0, f - i * 0.035) * total);
    dot.setAttribute("cx", pt.x);
    dot.setAttribute("cy", pt.y);
  });
  if (p.text) {
    const pt = path.getPointAtLength(f * total);
    p.text.setAttribute("x", pt.x);
    p.text.setAttribute("y", pt.y - 12);
  }
}

function ease(f) {                  // smooth start and stop
  return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
}
