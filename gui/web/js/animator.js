// animator.js - plays the TRANSITION from step k-1 to step k on the figure.
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
  const anim = { beats, ms, finalK, start: performance.now(), labels: new Map(), raf: 0 };
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
    if (t >= b.at + len + (b.hold || 0)) { b.done = true; endBeat(anim, b); }
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
  if (b.glow) dp.blocks[b.glow].dataset.on = "1";          // hatched
  if (b.pulse) dp.wires[b.pulse].dataset.on = "1";         // heavy ink
  if (b.pulse || b.x !== undefined) {
    const label = makeLabel(dp.pulseLayer, b.label);
    if (b.x !== undefined) placeLabel(label, b.x, b.y);
    anim.labels.set(b, label);
  }
}

function updateBeat(anim, b, f) {
  if (b.progress) b.progress(f);
  if (b.pulse) {
    const path = getDatapath().wires[b.pulse];
    const p = path.getPointAtLength(ease(f) * path.getTotalLength());
    placeLabel(anim.labels.get(b), p.x, p.y);
  }
}

function endBeat(anim, b) {
  const dp = getDatapath();
  if (b.glow) delete dp.blocks[b.glow].dataset.on;
  if (b.pulse) delete dp.wires[b.pulse].dataset.on;       // fades back to a thin rule (CSS, 300 ms)
  const label = anim.labels.get(b);
  if (label) label.remove();
  anim.labels.delete(b);
}

function cleanup(anim) {
  for (const b of anim.beats) if (b.started && !b.done) endBeat(anim, b);
  for (const label of anim.labels.values()) label.remove();
  anim.labels.clear();
  setPhase(null);
}

// ------------------------------------------------------------------ data labels
// Data travels as a small red rectangle with the real value written in it.
function makeLabel(layer, text) {
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", "data-label");
  const content = text === undefined || text === "" ? "" : String(text);
  const w = content ? content.length * 8 + 12 : 8;    // 13px Plex Mono is about 8px per char
  const h = content ? 20 : 8;
  const rect = document.createElementNS(SVG, "rect");
  rect.setAttribute("x", -w / 2);
  rect.setAttribute("y", -h / 2);
  rect.setAttribute("width", w);
  rect.setAttribute("height", h);
  g.append(rect);
  if (content) {
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("y", 4.5);
    t.textContent = content;
    g.append(t);
  }
  layer.append(g);
  return g;
}

function placeLabel(g, x, y) {
  if (g) g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
}

function ease(f) {                  // smooth start and stop
  return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
}
