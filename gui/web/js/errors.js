// errors.js - the ONE place where error codes get their words.
// CPU.exe only writes the number (CONTRACT.md); the GUI turns it into a message.

export const ERRORS = {
  1: { message: "Unknown instruction", hint: "Use MOV, ADD, SUB, CMP, INC, DEC, JMP, JZ, JNZ or HLT" },
  2: { message: "Invalid register", hint: "Registers are AX, BX, CX and DX" },
  3: { message: "Missing operand", hint: "This instruction needs more operands" },
  4: { message: "Extra operand", hint: "This instruction has too many operands" },
  5: { message: "Invalid number", hint: "Use whole numbers like 5 or -3" },
  6: { message: "Jump target out of range", hint: "Jump to a line number that exists in your program" },
  7: { message: "Too many lines", hint: "The program can have at most 50 lines" },
  8: { message: "First operand must be a register", hint: "Write the register first, e.g. MOV AX, 5" },
  9: { message: "program.txt not found", hint: "Engine could not read the program file" },
};

export function errorInfo(code) {
  return ERRORS[code] || { message: `Error ${code}`, hint: "" };
}
