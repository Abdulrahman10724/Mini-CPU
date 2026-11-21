# Flags: ZF, SF and CF (viva notes)

A flag is a 1-bit note the CPU writes after an arithmetic instruction, so a later jump can
ask "what happened?". Our Mini-CPU has three, with the same rules as a real x86 CPU.

| Flag | Name | It is 1 when… | Jumps |
|---|---|---|---|
| ZF | Zero Flag | the result was 0 (or CMP found the values equal) | JZ, JNZ |
| SF | Sign Flag | the result is negative: bit 31 of the result is 1 | JS, JNS |
| CF | Carry Flag | the UNSIGNED result did not fit: a carry (ADD) or a borrow (SUB, CMP) | JC, JNC |

All three start at 0. ZF works exactly as before.

## 1. Who sets which flag

| Instruction | ZF | SF | CF |
|---|---|---|---|
| MOV | unchanged | unchanged | unchanged |
| ADD dst, src | result = 0 | bit 31 of result | carry out of bit 31 |
| SUB dst, src | result = 0 | bit 31 of result | borrow: unsigned dst < unsigned src |
| CMP dst, src | dst = src | like SUB | like SUB (registers unchanged) |
| INC / DEC | result = 0 | bit 31 of result | **unchanged** |
| jumps / HLT | unchanged | unchanged | unchanged |

## 2. SF (sign) vs CF (unsigned): the same 32 bits, two ways to read them

A register holds 32 bits. Read as a **signed** number, `FFFFFFFFh` is -1. Read as an
**unsigned** number, it is 4 294 967 295. The CPU does not know which one you mean, so it
writes one flag for each reading:

- **SF** answers the *signed* question: "is the result negative?" It is just bit 31.
- **CF** answers the *unsigned* question: "did the result go past 4 294 967 295 (carry), or
  below 0 (borrow)?"

Examples (tests 38, 39 and 40):

| Program | Result | Why |
|---|---|---|
| `MOV AX, 0` / `SUB AX, 1` | AX = -1, SF = 1, CF = 1 | -1 is negative (SF). Unsigned 0 - 1 goes below 0: a borrow (CF). |
| `MOV AX, -1` / `ADD AX, 1` | AX = 0, ZF = 1, SF = 0, CF = 1 | Unsigned `FFFFFFFFh + 1 = 1 0000 0000h`: the 33rd bit is the carry; the 32 bits left are 0 (ZF). |
| `MOV AX, 5` / `CMP AX, 9` | SF = 1, CF = 1 | 5 - 9 = -4 is negative (SF), and 5 < 9 unsigned (borrow, CF). |
| `MOV AX, -1` / `CMP AX, 1` | SF = 1, CF = 0 | -1 - 1 = -2 is negative, but unsigned `FFFFFFFFh` is NOT below 1: no borrow. |
| `MOV DX, 2147483647` / `ADD DX, 1` | DX = -2147483648, SF = 1, CF = 0 | Bit 31 became 1 (SF), but `7FFFFFFFh + 1 = 80000000h` still fits in 32 bits (no carry). |

So `JC` after `CMP a, b` means "a < b as unsigned numbers", and `JS` means "a - b came out
negative".

## 3. Why INC and DEC keep CF

This is how real x86 works, and Intel did it on purpose: `INC` and `DEC` are used as **loop
counters**. A program can add big numbers with ADD (which sets CF) and count with INC/DEC in
the same loop, without the counter destroying the carry. Test 39 shows it:

```
MOV AX, 0
SUB AX, 1      ; AX = -1, CF = 1 (borrow)
INC AX         ; AX = 0, ZF = 1, SF = 0 ... and CF stays 1
```

## 4. How CPU.asm gets SF and CF

- **CF** comes from the **real** CPU. Our `ADD`/`SUB`/`CMP` use the real x86 `add`/`sub`
  instruction on 32-bit values, and the real CPU already computes exactly the carry or
  borrow we need. Right after it, `call StoreCarry` copies the real Carry flag into the
  memory variable `carryFlag`:

  ```
  add  regs[esi*4], eax   ; the real ADD sets the real Carry flag
  call StoreCarry         ; copy it FIRST
  ```

  It must be first: `SetZeroFlag` uses `cmp`, which would overwrite the real flags. `call`,
  `ret` and `mov` do not change the flags, so inside `StoreCarry` a `jnc` still sees the
  carry of the `add`.

- **SF** is computed from the result: `test eax, 80000000h` looks only at bit 31.
  `SetSignFlag` stores 1 if it is set, else 0.

- `INC`/`DEC` call `SetZeroFlag` and `SetSignFlag`, but never `StoreCarry`.

Like ZF, `signFlag` and `carryFlag` are plain memory variables (`DWORD`, 0 or 1), not the
real CPU flags; they are reset to 0 in `ExecuteProgram`.

## 5. In result.txt and the GUI

Each STEP line ends with the three flags: `STEP <n> <line> <AX> <BX> <CX> <DX> <ZF> <SF> <CF>`
(CONTRACT.md appendix B). The GUI only displays them:
- Fig. 1, U4 FLAGS: three printed circles, ZF SF CF (hollow = 0, solid ink = 1);
- Fig. 2: SF and CF square waves under ZF;
- the log's Δ column: flag changes such as `SF↑ CF↑` (↑ became 1, ↓ became 0);
- the Analysis page: SF and CF columns in Table 2 and their transitions in Table 1.
