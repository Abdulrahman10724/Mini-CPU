// timeline.js - bottom bar: transport buttons, slider 0..N with tick marks, "Step k / N".
// Tick marks are built once per result: amber = a jump that was taken,
// green dot = ZF changed, diamond = where the program ended.

import { describeStep, totalSteps } from "./state.js";

const $ = (id) => document.getElementById(id);
let builtFor = null;

export function initTimeline(hooks) {
  $("tlSlider").addEventListener("input", (e) => hooks.onSeek(Number(e.target.value)));
  $("firstBtn").addEventListener("click", hooks.onFirst);
  $("prevBtn").addEventListener("click", hooks.onPrev);
  $("playBtn").addEventListener("click", hooks.onTogglePlay);
  $("nextBtn").addEventListener("click", hooks.onNext);
  $("lastBtn").addEventListener("click", hooks.onLast);
}

export function renderTimeline(s) {
  const N = totalSteps();
  if (s.result !== builtFor) buildTicks(s, N);

  const slider = $("tlSlider");
  slider.max = String(N);
  slider.value = String(s.cursor);
  slider.disabled = !s.result || N === 0;
  slider.style.setProperty("--fill", N ? `${(s.cursor / N) * 100}%` : "0%");
  slider.setAttribute("aria-valuetext", `Step ${s.cursor} of ${N}`);
  $("tlPos").textContent = `Step ${s.cursor} / ${N}`;

  const hasSteps = Boolean(s.result) && N > 0;
  $("firstBtn").disabled = !hasSteps || s.cursor === 0;
  $("prevBtn").disabled = !hasSteps || s.cursor === 0;
  $("nextBtn").disabled = Boolean(s.result) && s.cursor >= N && s.code === s.resultCode;
  $("lastBtn").disabled = !hasSteps || s.cursor === N;
  $("playBtn").disabled = !hasSteps;

  const play = $("playBtn");
  play.querySelector("use").setAttribute("href", s.playing ? "#i-pause" : "#i-play");
  play.setAttribute("aria-label", s.playing ? "Pause" : "Play");
}

function buildTicks(s, N) {
  builtFor = s.result;
  const ticks = $("tlTicks");
  const badge = $("tlEnd");
  ticks.innerHTML = "";
  if (!s.result) { badge.hidden = true; return; }

  const at = (k) => `${N ? (k / N) * 100 : 0}%`;
  let html = "";
  for (let k = 1; k <= N; k++) {
    const d = describeStep(k);
    html += `<span class="tick${d.taken ? " jump" : ""}" style="left:${at(k)}"></span>`;
    if (d.zfChanged) html += `<span class="tick-zf" style="left:${at(k)}"></span>`;
  }
  const end = s.result.end.type;
  html += `<span class="tick-end end-${end}" style="left:${at(N)}"></span>`;
  ticks.innerHTML = html;

  badge.hidden = false;
  badge.className = `end-badge end-${end}`;
  badge.textContent = end;
}
