// highlight.js - ONE transient "linked highlight", kept apart from the main state so
// hovering never re-renders the page or re-runs CPU.exe.
//
//   null
//   { kind: "reg",  value: "AX" }   hovering a register anywhere
//   { kind: "line", value: 3 }      hovering an editor line
//   { kind: "step", value: 6 }      hovering a waveform column or a log row
//
// Every part that can show a link subscribes with onHighlight(fn).

let current = null;
const listeners = [];

export function getHighlight() {
  return current;
}

export function setHighlight(h) {
  const same = (a, b) => (a === null && b === null) ||
    (a !== null && b !== null && a.kind === b.kind && a.value === b.value);
  if (same(h, current)) return;
  current = h;
  for (const fn of listeners) fn(current);
}

export function onHighlight(fn) {
  listeners.push(fn);
}
