// choreography.js - WHAT lights up, and WHEN, while one step is animated.
//
// It returns a list of "beats". Each beat has a start time `at` and a length `len`,
// both as fractions of the step (0 = start, 1 = end):
//   { at, len, pulse: "wireId", colour, label }   a dot travels along a wire
//   { at, len, glow:  "blockId", colour }          a block outline lights up
//   { at, len, progress: (f) => ... }              called every frame, f = 0..1
//   { at, run: () => ... }                          called once at time `at`
//
// The step's DATA (values, ZF, where it jumped) comes from describeStep(), i.e. from
// result.txt. This file only decides how to SHOW it. Phases: FETCH 0-25 %,
// DECODE 25-45 %, EXECUTE 45-100 %.

import { REG_NAMES } from "./state.js";
import * as dp from "./datapath.js";

const ALU_OPS = ["MOV", "ADD", "SUB", "CMP", "INC", "DEC"];

export function choreograph(d) {
  const beats = [];
  const reg = (name) => REG_NAMES.indexOf(name);
  const dst = reg(d.a);
  const srcIsReg = reg(d.b) >= 0;
  const fields = dp.decodedFields(d.op, d.a, d.b);
  const typedLength = fields.reduce((n, [, v]) => n + v.length, 0);

  // ---------------------------------------------------------------- FETCH
  beats.push({ at: 0, run: () => { dp.setPhase("fetch"); dp.rollPC(d.line, "amber"); dp.setNext("", ""); } });
  beats.push({ at: 0, len: 0.25, glow: "pc", colour: "amber" });
  beats.push({ at: 0.05, len: 0.17, pulse: "pc_imem", colour: "cyan", label: `L${d.line}` });
  beats.push({ at: 0.2, run: () => dp.setImem(d.line) });
  beats.push({ at: 0.2, len: 0.25, glow: "imem", colour: "cyan" });

  // ---------------------------------------------------------------- DECODE
  beats.push({ at: 0.25, run: () => { dp.setPhase("decode"); dp.rollPC(d.line); dp.setAluSymbol(""); } });
  beats.push({ at: 0.25, len: 0.12, pulse: "imem_dec", colour: "cyan" });
  beats.push({ at: 0.33, len: 0.67, glow: "decoder", colour: "cyan" });
  beats.push({ at: 0.33, len: 0.1,
    progress: (f) => dp.setDecoder(fields, { chars: Math.ceil(f * typedLength) }) });   // "types in"
  if (ALU_OPS.includes(d.op)) {
    beats.push({ at: 0.38, len: 0.07, pulse: "dec_reg", colour: "purple" });
  }

  // ---------------------------------------------------------------- EXECUTE
  beats.push({ at: 0.45, run: () => dp.setPhase("execute") });

  if (ALU_OPS.includes(d.op)) {
    const before = d.before.regs;
    const result = dst >= 0 ? d.after.regs[dst] : 0;

    // operands into the ALU
    if (d.op !== "MOV") {
      beats.push({ at: 0.45, len: 0.17, pulse: "reg_a", colour: "purple", label: `${before[dst]}` });
    }
    if (d.op === "INC" || d.op === "DEC") {
      beats.push({ at: 0.45, len: 0.5, progress: (f) => dp.showOneChip(f < 1) });
    } else if (srcIsReg) {
      beats.push({ at: 0.45, len: 0.17, pulse: "reg_b", colour: "purple", label: `${before[reg(d.b)]}` });
    } else {
      beats.push({ at: 0.45, len: 0.17, pulse: "imm_b", colour: "cyan", label: d.b });
    }

    // the ALU works
    beats.push({ at: 0.6, len: 0.14, glow: "alu", colour: "orange" });
    beats.push({ at: 0.6, run: () => dp.setAluSymbol(d.op, true) });

    // result: written back (not for CMP) and/or into the flags
    if (d.op === "CMP") {
      beats.push({ at: 0.7, len: 0.3, progress: (f) => dp.showDiscarded(f < 1) });
    } else {
      beats.push({ at: 0.7, len: 0.18, pulse: "writeback", colour: "orange", label: `${result}` });
      beats.push({ at: 0.88, run: () => {
        for (const i of d.changed) {
          dp.setRegister(i, d.after.regs[i]);
          dp.flashRegister(i, d.after.regs[i] - before[i]);
        }
      } });
    }
    if (d.op !== "MOV") {
      beats.push({ at: 0.7, len: 0.15, pulse: "alu_flags", colour: "green", label: `ZF ${d.after.zf}` });
      beats.push({ at: 0.85, run: () => dp.setZF(d.after.zf) });
      beats.push({ at: 0.85, len: 0.15, glow: "flags", colour: "green" });
    }
  } else if (d.op === "JMP") {
    beats.push({ at: 0.45, len: 0.35, pulse: "jump", colour: "amber", label: `L${d.target}` });
    beats.push({ at: 0.55, len: 0.3, progress: (f) => dp.setGate(f < 1 ? "pass" : "") });
    beats.push({ at: 0.8, len: 0.2, glow: "pc", colour: "amber" });
    beats.push({ at: 0.8, run: () => dp.setNext(`next → ${pad(d.next)}`, "amber") });
  } else if (d.op === "JZ" || d.op === "JNZ") {
    beats.push({ at: 0.45, len: 0.15, pulse: "cond", colour: "amber", label: `ZF ${d.after.zf}` });
    if (d.taken) {
      beats.push({ at: 0.6, len: 0.3, progress: (f) => dp.setGate(f < 1 ? "pass" : "") });
      beats.push({ at: 0.6, len: 0.25, pulse: "jump", colour: "amber", label: `L${d.target}` });
      beats.push({ at: 0.85, len: 0.15, glow: "pc", colour: "amber" });
      beats.push({ at: 0.85, run: () => dp.setNext(`next → ${pad(d.next)}`, "amber") });
    } else {
      beats.push({ at: 0.6, len: 0.4, progress: (f) => dp.setGate(f < 1 ? "blocked" : "") });
      beats.push({ at: 0.75, run: () => dp.setNext(d.next ? `next → ${pad(d.next)}` : "", "") });
    }
  } else if (d.op === "HLT") {
    beats.push({ at: 0.5, run: () => dp.showHalted() });
  }
  return beats;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
