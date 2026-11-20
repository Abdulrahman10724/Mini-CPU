# Phase 2 checklist — DebugPrintLines output

How to check:
1. Build `asm/CPU.asm` in Visual Studio (DEBUG = 1).
2. Copy `tests/<name>.txt` to `program.txt` in the folder CPU.exe runs from
   (when you press Ctrl+F5 in Visual Studio this is usually the project folder,
   the one with the .vcxproj file). For test 17, delete program.txt instead.
3. Run it and compare the console output with the block below. It must match exactly,
   including spaces inside the `[ ]`.

Note: BYTES assumes the test files are byte-exact as in the repo. `.gitattributes` stops Git
from changing LF to CRLF. If you copied the files some other way and BYTES is different but
everything else matches, that is fine.

Note on 18: line 1 keeps 54 spaces after `MOV AX, 7`, so it is exactly 63 characters long.
Line 2 keeps 55 of the 92 nines. Line 3 must still be `HLT`. That shows the rest of each
long line was skipped correctly.

### 01_arith_basic
```
BYTES: 46
LINES: 5
1: [MOV AX, 10]
2: [MOV BX, 5]
3: [ADD AX, BX]
4: [SUB AX, 2]
5: [HLT]
```

### 06_jmp_empty_lines
```
BYTES: 58
LINES: 8
1: [MOV AX, 1]
2: [JMP 4]
3: [MOV AX, 99]
4: []
5: [MOV BX, 2]
6: [JMP 8]
7: [MOV CX, 3]
8: [HLT]
```

### 08_lowercase_spaces_crlf
```
BYTES: 73
LINES: 6
1: [MOV AX, 5]
2: [   MOV   BX ,3   ]
3: [ADD AX,BX]
4: [SUB   AX ,, 1]
5: [INC CX]
6: [  HLT  ]
```

### 13_error_7_too_many_lines
```
BYTES: 362
LINES: 50
TOO MANY LINES
1: [INC AX]
2: [INC AX]
3: [INC AX]
4: [INC AX]
5: [INC AX]
6: [INC AX]
7: [INC AX]
8: [INC AX]
9: [INC AX]
10: [INC AX]
11: [INC AX]
12: [INC AX]
13: [INC AX]
14: [INC AX]
15: [INC AX]
16: [INC AX]
17: [INC AX]
18: [INC AX]
19: [INC AX]
20: [INC AX]
21: [INC AX]
22: [INC AX]
23: [INC AX]
24: [INC AX]
25: [INC AX]
26: [INC AX]
27: [INC AX]
28: [INC AX]
29: [INC AX]
30: [INC AX]
31: [INC AX]
32: [INC AX]
33: [INC AX]
34: [INC AX]
35: [INC AX]
36: [INC AX]
37: [INC AX]
38: [INC AX]
39: [INC AX]
40: [INC AX]
41: [INC AX]
42: [INC AX]
43: [INC AX]
44: [INC AX]
45: [INC AX]
46: [INC AX]
47: [INC AX]
48: [INC AX]
49: [INC AX]
50: [INC AX]
```

### 14_empty_file
```
BYTES: 0
LINES: 0
```

### 17_error_9_no_file
```
FILE MISSING
```

### 18_long_line
```
BYTES: 206
LINES: 3
1: [MOV AX, 7                                                      ]
2: [MOV BX, 9999999999999999999999999999999999999999999999999999999]
3: [HLT]
```

