# Phase 4 + 5 — How to test

## 1. Build
Build `asm/CPU.asm` in Visual Studio as usual (Debug, x86 / Win32).

## 2. Where is the exe?
With Irvine's Visual Studio template, the exe goes in the **Debug** folder next to your
`.sln` file. It is named after the **project**, not the .asm file:

    <your solution folder>\Debug\<ProjectName>.exe      e.g. C:\Irvine\Project32_VS2022\Debug\Project.exe

To find it: in Visual Studio, look at the Output window after the build. The last line
shows the full path ("Project.vcxproj -> C:\...\Debug\Project.exe"). The exe name doesn't
matter to the test runner.

## 3. Run all tests
Open a terminal (cmd or PowerShell) in the project folder (the one containing `tests\`), then:

    python tests\run_tests.py --exe "C:\full\path\to\Debug\Project.exe"

Run one test (or all tests whose name contains some text):

    python tests\run_tests.py --exe "C:\full\path\to\Debug\Project.exe" 05

The runner copies each test into `tests\_work\program.txt`, runs the exe there, and compares
`tests\_work\result.txt` with the expected file. It also fails if result.txt contains any CR
byte (lines must end with LF only). Expected result: **25/25 passed**.

## 4. If a test fails, paste back to me:
1. The full runner output for the failing test(s). The diff shows `-` for expected
   lines and `+` for what CPU.exe wrote.
2. For one failing test, the console output of CPU.exe (DEBUG = 1). Copy
   `tests\<name>.txt` to `program.txt` next to where you run the exe, run it, and copy the
   console text (`STEP n LINE l: ...`, then the lines and PARSED blocks).
3. If it fails with "did not create result.txt" or a timeout, say so. That means the exe
   crashed or is waiting for input.
4. Any assembler or linker errors, with their line numbers.

Note: with DEBUG = 1 the exe prints the STEP lines first (ExecuteProgram prints them while
running), then the BYTES/LINES and PARSED blocks. This order is intentional, see `main`.
Console output never affects result.txt.
