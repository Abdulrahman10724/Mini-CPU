// timeline.js - transport buttons + "STEP k / N" (temporary; replaced by waveform.js).

import { totalSteps } from "./state.js";

const $ = (id) => document.getElementById(id);

export function initTimeline(hooks) {
  $("firstBtn").addEventListener("click", hooks.onFirst);
  $("prevBtn").addEventListener("click", hooks.onPrev);
  $("playBtn").addEventListener("click", hooks.onTogglePlay);
  $("nextBtn").addEventListener("click", hooks.onNext);
  $("lastBtn").addEventListener("click", hooks.onLast);
}

export function renderTimeline(s) {
  const N = totalSteps();
  $("tlPos").textContent = `STEP ${s.cursor} / ${N}`;
  const hasSteps = Boolean(s.result) && N > 0;
  $("firstBtn").disabled = !hasSteps || s.cursor === 0;
  $("prevBtn").disabled = !hasSteps || s.cursor === 0;
  $("lastBtn").disabled = !hasSteps || s.cursor === N;
  $("playBtn").disabled = !hasSteps;
  $("playBtn").querySelector("use").setAttribute("href", s.playing ? "#i-pause" : "#i-play");
}
