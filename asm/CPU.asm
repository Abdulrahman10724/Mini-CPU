; =====================================================================
; Mini CPU Simulator - COAL Lab Project (BDS-3A, Group 07)
;
; CPU.exe reads program.txt, checks every line for errors, runs the
; program on four virtual registers (AX, BX, CX, DX) with a program
; counter and a Zero Flag, and writes result.txt (format: CONTRACT.md).
;
; It works like a small TWO-PASS ASSEMBLER:
;   PASS 1 (CollectLabels): find every label "NAME:" and remember its line
;          number in a symbol table, so a jump may use a label that is
;          defined further down (a forward reference).
;   PASS 2 (ParseAllLines): check every instruction; a jump to a label
;          gets the line number from the symbol table (LookupLabel).
; Then the program is executed and result.txt is written.
; Flags: ZF (zero), SF (sign) and CF (carry), with the real x86 rules
; (CONTRACT.md appendix B). SF/CF are copied from the REAL CPU flags.
; =====================================================================

; Irvine32.inc already sets up the 32-bit flat memory model for us:
; it contains the .386 / .model flat, stdcall / .stack directives,
; so we do not repeat them here (repeating .model can cause an error).
INCLUDE Irvine32.inc

; ---------------------------------------------------------------------
; Constants
; ---------------------------------------------------------------------
DEBUG      = 1        ; 1 = print debug info to console, 0 = silent (final version uses 0)
MAX_LINES  = 50       ; max program lines (CONTRACT error 7)
MAX_STEPS  = 500      ; infinite loop guard (END LOOP)
LINE_LEN   = 64       ; bytes per stored line: 63 chars + 0 terminator
MAX_TOKENS = 4        ; opcode + up to 3 operands (a 3rd operand means error 4)
TOKEN_LEN  = 16       ; bytes per token: 15 chars + 0 terminator
BUF_SIZE   = 4096     ; max bytes read from program.txt
OUT_SIZE   = 40000    ; result.txt output buffer
                      ; Size check: the longest STEP line is
                      ; "STEP 500 50 -2147483648 -2147483648 -2147483648 -2147483648 1 1 1" + LF
                      ; = 66 bytes, x 500 steps = 33000 bytes. Plus STATUS (11), up to 51 ERR
                      ; lines (max 9 bytes each = 459) and END (max 15) -> about 33.5 KB < 40000.

; Name table sizes (Phase 3)
NUM_OPCODES = 14      ; entries in opNames
OP_SLOT     = 4       ; bytes per opNames slot
NUM_REGS    = 4       ; entries in regNames
REG_SLOT    = 3       ; bytes per regNames slot

; Opcode numbers (same order as opNames)
OP_MOV = 1
OP_ADD = 2
OP_SUB = 3
OP_CMP = 4
OP_INC = 5
OP_DEC = 6
OP_JMP = 7
OP_JZ  = 8
OP_JNZ = 9
OP_HLT = 10
OP_JS  = 11           ; jump if SF = 1 (result was negative)
OP_JNS = 12           ; jump if SF = 0
OP_JC  = 13           ; jump if CF = 1 (carry / borrow)
OP_JNC = 14           ; jump if CF = 0

; instSrcType values
SRC_NONE     = 0      ; no source operand (INC, DEC, HLT)
SRC_REGISTER = 1      ; instSrc holds a register index
SRC_NUMBER   = 2      ; instSrc holds a number (or a jump target line)

; Error codes (CONTRACT.md)
ERR_UNKNOWN_OP    = 1 ; Unknown instruction
ERR_BAD_REGISTER  = 2 ; Invalid register
ERR_MISSING_OP    = 3 ; Missing operand
ERR_EXTRA_OP      = 4 ; Extra operand
ERR_BAD_NUMBER    = 5 ; Invalid number
ERR_JUMP_RANGE    = 6 ; Jump target out of range
ERR_TOO_MANY      = 7 ; Too many lines (max 50)
ERR_FIRST_NOT_REG = 8 ; First operand must be a register
ERR_NO_FILE       = 9 ; program.txt not found
ERR_UNDEF_LABEL   = 10 ; Undefined label        (CONTRACT.md appendix A)
ERR_DUP_LABEL     = 11 ; Duplicate label
ERR_BAD_LABEL     = 12 ; Invalid label name

; Labels (symbol table)
MAX_LABELS   = 50     ; at most one label per line, so 50 is always enough
LABEL_SLOT   = 16     ; bytes per name in labelNames (fixed slots, padded with 0)
LABEL_MAXLEN = 12     ; longest allowed label name

; How execution ended (endType values, Phase 4)
END_HALT    = 1       ; HLT executed               -> END HALT <steps>
END_NOHLT   = 2       ; ran past the last line     -> END NOHLT <steps>
END_ERRSTOP = 3       ; reached a line with error  -> END ERRSTOP <line>
END_LOOP    = 4       ; 500-step guard reached     -> END LOOP <steps>

.data

; ---------------------------------------------------------------------
; File input
; ---------------------------------------------------------------------
programFile  BYTE "program.txt",0          ; input file name (in the working directory)
resultFile   BYTE "result.txt",0           ; output file name (used in Phase 5)
fileHandle   DWORD ?                       ; handle returned by OpenInputFile
fileBuf      BYTE BUF_SIZE+1 DUP(0)        ; raw bytes of program.txt (+1 for the final 0)
bytesRead    DWORD 0                       ; how many bytes were actually read
fileMissing  BYTE 0                        ; 1 if program.txt could not be opened/read (error 9)

; ---------------------------------------------------------------------
; Lines
; ---------------------------------------------------------------------
lineText     BYTE MAX_LINES*LINE_LEN DUP(0) ; line i is at offset (i-1)*LINE_LEN, 0-terminated, uppercase
lineCount    DWORD 0                       ; number of lines stored (0..50)
tooManyLines BYTE 0                        ; 1 if the file had more than 50 lines

; ---------------------------------------------------------------------
; Tokens (used in Phase 3)
; ---------------------------------------------------------------------
tokens       BYTE MAX_TOKENS*TOKEN_LEN DUP(0) ; current line split into words, 16 bytes each
tokCount     DWORD 0                       ; total words found on the line (can be > MAX_TOKENS)

; ---------------------------------------------------------------------
; Parsed instructions (Phase 3) - one entry per line, index = line number - 1
; ---------------------------------------------------------------------
instOp       BYTE  MAX_LINES DUP(0)        ; 0=empty 1=MOV 2=ADD 3=SUB 4=CMP 5=INC
                                           ; 6=DEC 7=JMP 8=JZ 9=JNZ 10=HLT
                                           ; 11=JS 12=JNS 13=JC 14=JNC
instDst      BYTE  MAX_LINES DUP(0)        ; destination register index 0..3
instSrcType  BYTE  MAX_LINES DUP(0)        ; 0=none, 1=register, 2=number
instSrc      SDWORD MAX_LINES DUP(0)       ; register index, number, or jump target line
lineErr      BYTE  MAX_LINES+2 DUP(0)      ; error code per line, 0 = OK
                                           ; (index 50 = line 51, used for error 7)

; ---------------------------------------------------------------------
; Symbol table (PASS 1) - label names and the line each one is on
; ---------------------------------------------------------------------
labelNames   BYTE  MAX_LABELS*LABEL_SLOT DUP(0) ; label i is at offset i*LABEL_SLOT, 0-terminated
labelLines   DWORD MAX_LABELS DUP(0)       ; line number of label i (parallel array)
labelCount   DWORD 0                       ; labels stored so far
labelWord    BYTE  LABEL_SLOT DUP(0)       ; work buffer: the label name found on the current line
labelLen     DWORD 0                       ; its real length (only 15 chars fit in labelWord)

; ---------------------------------------------------------------------
; Name tables (Phase 3)
; ---------------------------------------------------------------------
; Each opcode name sits in a fixed 4-byte slot (padded with 0),
; so slot index + 1 = opcode number (MOV = 1 ... HLT = 10 ... JNC = 14).
opNames      BYTE "MOV",0, "ADD",0, "SUB",0, "CMP",0, "INC",0
             BYTE "DEC",0, "JMP",0, "JZ",0,0, "JNZ",0, "HLT",0
             BYTE "JS",0,0, "JNS",0, "JC",0,0, "JNC",0
; Each register name sits in a fixed 3-byte slot: slot index = register index.
regNames     BYTE "AX",0, "BX",0, "CX",0, "DX",0
; Number of operands each opcode needs, index = opcode - 1
;                  MOV ADD SUB CMP INC DEC JMP JZ JNZ HLT JS JNS JC JNC
opOperandCount BYTE 2,  2,  2,  2,  1,  1,  1,  1, 1,  0,  1, 1,  1, 1

; ---------------------------------------------------------------------
; Virtual CPU state (Phase 4) - plain memory, NOT the real CPU registers
; ---------------------------------------------------------------------
regs         SDWORD 4 DUP(0)               ; virtual AX, BX, CX, DX
zeroFlag     DWORD 0                       ; virtual ZF (0 or 1): result was 0
signFlag     DWORD 0                       ; virtual SF (0 or 1): bit 31 of the result (negative)
carryFlag    DWORD 0                       ; virtual CF (0 or 1): unsigned carry / borrow
pc           DWORD 1                       ; virtual program counter = current line number (1-based)
stepCount    DWORD 0                       ; instructions executed so far
endType      BYTE 0                        ; how execution ended: END_HALT/NOHLT/ERRSTOP/LOOP
endValue     DWORD 0                       ; number after END: steps, or the line for ERRSTOP

; Words used in the END line, one string per endType
endHalt      BYTE "HALT",0
endNoHlt     BYTE "NOHLT",0
endErrStop   BYTE "ERRSTOP",0
endLoop      BYTE "LOOP",0

; ---------------------------------------------------------------------
; Output (Phase 5)
; ---------------------------------------------------------------------
outBuf       BYTE OUT_SIZE DUP(0)          ; the whole result.txt is built here
outPos       DWORD 0                       ; next free position in outBuf
numBuf       BYTE 16 DUP(0)                ; work buffer for IntToStr
                                           ; (longest number "-2147483648" = 11 chars + 0)

; Fixed words written into result.txt
txtStatusOk  BYTE "STATUS OK",0
txtStatusErr BYTE "STATUS ERR",0
txtErr       BYTE "ERR",0
txtStep      BYTE "STEP",0
txtEnd       BYTE "END",0

; ---------------------------------------------------------------------
; Debug strings
; ---------------------------------------------------------------------
dbgMissing   BYTE "FILE MISSING",0
dbgBytes     BYTE "BYTES: ",0
dbgLines     BYTE "LINES: ",0
dbgTooMany   BYTE "TOO MANY LINES",0
dbgOpen      BYTE ": [",0                  ; printed between line number and line text
dbgClose     BYTE "]",0                    ; printed after the line text
dbgParsed    BYTE "PARSED:",0
dbgColon     BYTE ": ",0
dbgEmpty     BYTE "EMPTY",0
dbgErr       BYTE "ERR=",0
dbgOp        BYTE "OP=",0
dbgDst       BYTE " DST=",0
dbgSrcType   BYTE " SRCTYPE=",0
dbgSrc       BYTE " SRC=",0
dbgStep      BYTE "STEP ",0
dbgLine      BYTE " LINE ",0
dbgAX        BYTE ": AX=",0
dbgBX        BYTE " BX=",0
dbgCX        BYTE " CX=",0
dbgDX        BYTE " DX=",0
dbgZF        BYTE " ZF=",0
dbgSF        BYTE " SF=",0
dbgCF        BYTE " CF=",0
dbgNoWrite   BYTE "ERROR: cannot create result.txt",0
dbgLabels    BYTE "LABELS:",0
dbgAtLine    BYTE " = LINE ",0

.code

; ---------------------------------------------------------------------
; main
; Purpose:  Program entry point. Runs each stage of the simulator in order.
; Receives: nothing
; Returns:  nothing (exits to the operating system)
; Changes:  everything, through the procedures it calls
; ---------------------------------------------------------------------
main PROC
    call ReadProgramFile           ; load program.txt into fileBuf

    cmp  fileMissing, 1            ; could the file be read?
    je   SkipParse                 ; no -> nothing to split or parse
    call SplitLines                ; yes -> cut fileBuf into lines
    call CollectLabels             ; PASS 1: labels -> symbol table, "NAME:" removed from lines
    call ParseAllLines             ; PASS 2: check every line, fill instruction arrays
SkipParse:

    call AppendStatusAndErrors     ; STATUS line + ERR lines (or the error-9 block)

    cmp  fileMissing, 1            ; no program -> nothing to run
    je   SkipExecute
    call ExecuteProgram            ; run it, adding one STEP line per instruction
SkipExecute:

    call AppendEndLine             ; END line
    call WriteResultFile           ; write outBuf to result.txt in one go

    call DebugPrintLines           ; show what we read (only if DEBUG = 1)
    call DebugPrintParsed          ; show what the parser found (only if DEBUG = 1)
    call DebugPrintLabels          ; show the symbol table (only if DEBUG = 1)

    exit                           ; Irvine32 macro for INVOKE ExitProcess, 0
main ENDP

; ---------------------------------------------------------------------
; ReadProgramFile
; Purpose:  Open program.txt and read up to BUF_SIZE bytes into fileBuf.
; Receives: programFile (file name)
; Returns:  bytesRead = number of bytes read,
;           fileMissing = 1 if the file could not be opened or read
; Changes:  fileHandle, fileBuf (a 0 is placed after the last byte read)
; ---------------------------------------------------------------------
ReadProgramFile PROC USES eax ecx edx
    mov  edx, OFFSET programFile   ; EDX = address of the file name
    call OpenInputFile             ; EAX = file handle
    cmp  eax, INVALID_HANDLE_VALUE ; did the open fail?
    je   OpenFailed
    mov  fileHandle, eax           ; save the handle

    mov  eax, fileHandle           ; EAX = handle
    mov  edx, OFFSET fileBuf       ; EDX = where to put the bytes
    mov  ecx, BUF_SIZE             ; ECX = maximum number of bytes to read
    call ReadFromFile              ; EAX = bytes read, Carry flag = 1 on error
    jc   ReadFailed

    mov  bytesRead, eax            ; remember how many bytes we got
    mov  fileBuf[eax], 0           ; 0 after the last byte (EAX <= BUF_SIZE, buffer is BUF_SIZE+1)

    mov  eax, fileHandle
    call CloseFile                 ; file is no longer needed
    jmp  Done

ReadFailed:
    mov  eax, fileHandle
    call CloseFile                 ; close the file even though the read failed
OpenFailed:
    mov  fileMissing, 1            ; treat as "program.txt not found" (error 9)
    mov  bytesRead, 0
Done:
    ret
ReadProgramFile ENDP

; ---------------------------------------------------------------------
; SplitLines
; Purpose:  Walk through fileBuf and copy each line into its own
;           LINE_LEN-byte slot in lineText, then make it uppercase.
;           - LF (10) ends a line; CR (13) is ignored (CRLF and LF both work)
;           - TAB (9) is stored as a space
;           - empty lines are stored and counted (line numbers stay correct)
;           - a newline at the very end of the file does not add a line
;           - only the first 63 characters of a long line are kept
;           - more than MAX_LINES lines sets tooManyLines = 1
;           - a UTF-8 BOM (EF BB BF) at the start of the file is skipped
; Receives: fileBuf, bytesRead
; Returns:  lineCount, tooManyLines
; Changes:  lineText
; Register use inside: EBX = read index into fileBuf,
;                      EDI = write address inside the current slot,
;                      EDX = characters stored in the current line
; ---------------------------------------------------------------------
SplitLines PROC USES eax ebx edx esi edi
    mov  lineCount, 0
    mov  ebx, 0                    ; start reading at byte 0

    ; Notepad can save "UTF-8 with BOM": the file then starts with the 3 bytes
    ; EF BB BF, which are not part of the program. Skip them, otherwise line 1
    ; would start with 3 strange characters and give error 1.
    cmp  bytesRead, 3              ; fewer than 3 bytes -> no BOM possible
    jb   NewLine
    cmp  fileBuf[0], 0EFh
    jne  NewLine
    cmp  fileBuf[1], 0BBh
    jne  NewLine
    cmp  fileBuf[2], 0BFh
    jne  NewLine
    mov  ebx, 3                    ; BOM found: start reading at byte 3

NewLine:
    cmp  ebx, bytesRead            ; any bytes left?
    jae  Done                      ; no -> finished (a final newline adds no line)

    cmp  lineCount, MAX_LINES      ; are all 50 slots already used?
    jb   StartLine
    mov  tooManyLines, 1           ; yes, and there is still content -> error 7 later
    jmp  Done

StartLine:
    inc  lineCount                 ; this is a new line
    mov  eax, lineCount
    call GetLineAddress            ; ESI = address of this line's slot
    mov  edi, esi                  ; EDI = where the next character goes
    mov  edx, 0                    ; no characters stored yet

CharLoop:
    cmp  ebx, bytesRead            ; end of file in the middle of a line?
    jae  LastLine
    mov  al, fileBuf[ebx]          ; AL = next byte from the file
    inc  ebx

    cmp  al, 10                    ; LF -> this line is finished
    je   EndOfLine
    cmp  al, 13                    ; CR -> ignore it
    je   CharLoop
    cmp  al, 9                     ; TAB -> store as a space
    jne  CheckRoom
    mov  al, ' '

CheckRoom:
    cmp  edx, LINE_LEN-1           ; slot full? (63 chars, last byte is for the 0)
    jae  CharLoop                  ; yes -> skip this char, keep reading to the LF
    mov  [edi], al                 ; store the character
    inc  edi
    inc  edx
    jmp  CharLoop

EndOfLine:
    mov  BYTE PTR [edi], 0         ; terminate the line
    call ToUpperLine               ; ESI still points to the start of this slot
    jmp  NewLine

LastLine:                          ; file ended without a newline after this line
    mov  BYTE PTR [edi], 0
    call ToUpperLine

Done:
    ret
SplitLines ENDP

; ---------------------------------------------------------------------
; ToUpperLine
; Purpose:  Convert one 0-terminated line to uppercase, in place.
;           Only 'a'..'z' change; spaces, commas, digits stay as they are.
; Receives: ESI = address of the line
; Returns:  nothing
; Changes:  the bytes of that line
; ---------------------------------------------------------------------
ToUpperLine PROC USES eax esi
NextChar:
    mov  al, [esi]                 ; AL = current character
    cmp  al, 0                     ; end of the line?
    je   Done
    cmp  al, 'a'                   ; below 'a'? not a lowercase letter
    jb   Skip
    cmp  al, 'z'                   ; above 'z'? not a lowercase letter
    ja   Skip
    sub  al, 32                    ; 'a'(97) - 32 = 'A'(65)
    mov  [esi], al                 ; write the uppercase letter back
Skip:
    inc  esi                       ; move to the next character
    jmp  NextChar
Done:
    ret
ToUpperLine ENDP

; ---------------------------------------------------------------------
; GetLineAddress
; Purpose:  Return the address of the slot that stores line N.
; Receives: EAX = line number N (1-based)
; Returns:  ESI = OFFSET lineText + (N - 1) * LINE_LEN
; Changes:  nothing else
; ---------------------------------------------------------------------
GetLineAddress PROC USES eax edx
    dec  eax                       ; EAX = N - 1 (slots start at 0)
    mov  edx, LINE_LEN
    mul  edx                       ; EAX = (N - 1) * LINE_LEN (MUL also changes EDX)
    mov  esi, OFFSET lineText
    add  esi, eax                  ; ESI = start of the slot
    ret
GetLineAddress ENDP

; ---------------------------------------------------------------------
; DebugPrintLines
; Purpose:  When DEBUG = 1, print what was read from program.txt:
;           byte count, line count, and every line inside [ ].
;           When DEBUG = 0 it prints nothing.
; Receives: fileMissing, bytesRead, lineCount, tooManyLines, lineText
; Returns:  nothing
; Changes:  nothing (console output only)
; ---------------------------------------------------------------------
DebugPrintLines PROC USES eax ebx edx esi
    mov  eax, DEBUG
    cmp  eax, 0                    ; debug output switched off?
    je   Done

    cmp  fileMissing, 1            ; no file -> print only FILE MISSING
    jne  PrintCounts
    mov  edx, OFFSET dbgMissing
    call WriteString
    call Crlf
    jmp  Done

PrintCounts:
    mov  edx, OFFSET dbgBytes      ; "BYTES: <bytesRead>"
    call WriteString
    mov  eax, bytesRead
    call WriteDec
    call Crlf

    mov  edx, OFFSET dbgLines      ; "LINES: <lineCount>"
    call WriteString
    mov  eax, lineCount
    call WriteDec
    call Crlf

    cmp  tooManyLines, 1           ; "TOO MANY LINES" only if the flag is set
    jne  PrintAllLines
    mov  edx, OFFSET dbgTooMany
    call WriteString
    call Crlf

PrintAllLines:
    mov  ebx, 1                    ; EBX = line number, starts at 1
LineLoop:
    cmp  ebx, lineCount            ; printed all lines?
    ja   Done

    mov  eax, ebx                  ; "<n>"
    call WriteDec
    mov  edx, OFFSET dbgOpen       ; ": ["
    call WriteString
    mov  eax, ebx
    call GetLineAddress            ; ESI = address of line n
    mov  edx, esi                  ; the line text
    call WriteString
    mov  edx, OFFSET dbgClose      ; "]"
    call WriteString
    call Crlf

    inc  ebx                       ; next line
    jmp  LineLoop

Done:
    ret
DebugPrintLines ENDP

; =====================================================================
; PASS 1 - LABELS (the symbol table)
; Before any instruction is checked, we read every line once and look
; only at its FIRST word. If that word ends with ':' it is a label:
;   - the name and its line number go into the symbol table
;     (labelNames / labelLines, max 50 entries, 16-byte name slots)
;   - "NAME:" is overwritten with spaces, so PASS 2 sees only the
;     instruction ("L1: ADD AX, CX" -> "    ADD AX, CX"; "LOOP:" -> empty)
; Because the whole table is ready before PASS 2 starts, a jump may use
; a label defined further down (forward reference: JMP SKIP ... SKIP:).
; Label errors go into lineErr: 11 duplicate, 12 invalid name.
; =====================================================================

; ---------------------------------------------------------------------
; CollectLabels
; Purpose:  PASS 1. Empty the symbol table, then collect the label of
;           every line 1..lineCount.
; Receives: lineCount, lineText
; Returns:  nothing
; Changes:  labelNames, labelLines, labelCount, lineText, lineErr
; ---------------------------------------------------------------------
CollectLabels PROC USES eax
    mov  labelCount, 0             ; empty symbol table
    mov  eax, 1                    ; EAX = line number
LineLoop:
    cmp  eax, lineCount            ; done all lines?
    ja   Done
    call CollectLineLabel          ; (keeps EAX unchanged)
    inc  eax
    jmp  LineLoop
Done:
    ret
CollectLabels ENDP

; ---------------------------------------------------------------------
; CollectLineLabel
; Purpose:  Look for a label at the start of one line. If its first word
;           ends with ':', copy the name to labelWord, erase "NAME:" from
;           the line, check the name and add it to the symbol table.
;           Checks, left to right (first error wins):
;             invalid name -> 12, already defined -> 11 (the FIRST
;             definition stays valid), a second label on the line -> 12.
; Receives: EAX = line number (1-based)
; Returns:  nothing
; Changes:  the line in lineText, lineErr for this line, symbol table
; Register use inside: EBX = line number, EDX = start of the first word,
;                      EDI = scan pointer (then: address of the ':'),
;                      ECX = rest of the line after the ':'
; ---------------------------------------------------------------------
CollectLineLabel PROC USES eax ebx ecx edx esi edi
    mov  ebx, eax                  ; EBX = line number (kept for the whole PROC)
    mov  lineErr[ebx-1], 0         ; no error on this line yet
    call GetLineAddress            ; ESI = start of the line
    mov  edi, esi                  ; EDI = scan pointer

SkipSpaces:                        ; a label may have spaces in front of it
    cmp  BYTE PTR [edi], ' '
    jne  FirstWord
    inc  edi
    jmp  SkipSpaces

FirstWord:
    mov  edx, edi                  ; EDX = start of the first word
WordLoop:                          ; walk to the end of the first word
    mov  al, [edi]
    cmp  al, ':'                   ; ':' -> the first word is a label
    je   FoundLabel
    cmp  al, 0                     ; end of line, space or comma before any ':'
    je   Done                      ;   -> no label on this line
    cmp  al, ' '
    je   Done
    cmp  al, ','
    je   Done
    inc  edi
    jmp  WordLoop

FoundLabel:                        ; EDX = start of the name, EDI = address of ':'
    ; ---- 1. copy the name into labelWord (at most 15 chars fit) ----
    mov  ecx, edi
    sub  ecx, edx                  ; ECX = length of the name
    mov  labelLen, ecx             ; (the real length, used by IsValidLabelName)
    mov  esi, edx                  ; ESI = read pointer in the name
    mov  ecx, 0                    ; ECX = chars copied
CopyLoop:
    cmp  esi, edi                  ; reached the ':'?
    jae  CopyDone
    cmp  ecx, LABEL_SLOT-1         ; labelWord full? (a name that long is invalid anyway)
    jae  CopyDone
    mov  al, [esi]
    mov  labelWord[ecx], al
    inc  esi
    inc  ecx
    jmp  CopyLoop
CopyDone:
    mov  labelWord[ecx], 0         ; terminate the name

    ; ---- 2. erase "NAME:" from the line (spaces), so PASS 2 skips it ----
    mov  esi, edx
EraseLoop:
    cmp  esi, edi                  ; erased the ':' too?
    ja   EraseDone
    mov  BYTE PTR [esi], ' '
    inc  esi
    jmp  EraseLoop
EraseDone:
    mov  ecx, esi                  ; ECX = rest of the line (after the ':')

    ; ---- 3. check the name and store it ----
    mov  esi, OFFSET labelWord
    call IsValidLabelName          ; EAX = 1 if the name is allowed
    cmp  eax, 1
    jne  BadLabel
    call LookupLabel               ; Carry = 0 -> this name is already in the table
    jnc  Duplicate
    call AddLabel                  ; new name -> symbol table (ESI = name, EBX = line)

    ; ---- 4. only one label per line: any other ':' -> error 12 ----
    mov  esi, ecx
SecondLoop:
    mov  al, [esi]
    cmp  al, 0                     ; end of line -> fine
    je   Done
    cmp  al, ':'                   ; "X: Y: MOV BX, 2"
    je   BadLabel
    inc  esi
    jmp  SecondLoop

BadLabel:
    mov  lineErr[ebx-1], ERR_BAD_LABEL
    jmp  Done
Duplicate:
    mov  lineErr[ebx-1], ERR_DUP_LABEL
Done:
    ret
CollectLineLabel ENDP

; ---------------------------------------------------------------------
; IsValidLabelName
; Purpose:  Check a label name: 1..12 chars, only letters, digits and
;           '_', starts with a letter, and not an opcode or register
;           name (so "MOV:" and "CX:" are invalid). The line is already
;           uppercase, so names are case-insensitive.
; Receives: ESI = address of the name (labelWord), labelLen = its length
; Returns:  EAX = 1 if valid, 0 if not
; Changes:  nothing else
; Register use inside: EDX = pointer to the current char
; ---------------------------------------------------------------------
IsValidLabelName PROC USES edx
    cmp  labelLen, 0               ; ":" with no name
    je   Invalid
    cmp  labelLen, LABEL_MAXLEN    ; longer than 12 chars
    ja   Invalid

    mov  al, [esi]                 ; first char must be a letter A..Z
    cmp  al, 'A'
    jb   Invalid
    cmp  al, 'Z'
    ja   Invalid

    mov  edx, esi                  ; check every char
CharLoop:
    mov  al, [edx]
    cmp  al, 0                     ; end of the name -> all chars OK
    je   CharsOK
    cmp  al, 'A'                   ; letter?
    jb   NotLetter
    cmp  al, 'Z'
    jbe  NextChar
NotLetter:
    cmp  al, '0'                   ; digit?
    jb   Invalid
    cmp  al, '9'
    jbe  NextChar
    cmp  al, '_'                   ; underscore?
    je   NextChar
    jmp  Invalid                   ; anything else ('-', '.', ...)
NextChar:
    inc  edx
    jmp  CharLoop

CharsOK:
    call LookupOpcode              ; EAX = opcode number, 0 if not an opcode
    cmp  eax, 0
    jne  Invalid
    call LookupRegister            ; EAX = register index, -1 if not a register
    cmp  eax, -1
    jne  Invalid
    mov  eax, 1                    ; valid
    jmp  Done
Invalid:
    mov  eax, 0
Done:
    ret
IsValidLabelName ENDP

; ---------------------------------------------------------------------
; LookupLabel
; Purpose:  Find a name in the symbol table (16-byte slots).
;           Used in PASS 1 (duplicate check) and PASS 2 (jump targets).
; Receives: ESI = address of the name
; Returns:  Carry = 0: EAX = line number of that label
;           Carry = 1: EAX = 0, the label is not defined
; Changes:  nothing else
; ---------------------------------------------------------------------
LookupLabel PROC USES ecx edi
    mov  ecx, 0                    ; ECX = entry index
    mov  edi, OFFSET labelNames    ; EDI = address of entry ECX
SearchLoop:
    cmp  ecx, labelCount           ; checked all entries?
    jae  NotFound
    call StrEquals                 ; EAX = 1 if the names are equal
    cmp  eax, 1
    je   Found
    add  edi, LABEL_SLOT           ; next name is 16 bytes further
    inc  ecx
    jmp  SearchLoop
Found:
    mov  eax, labelLines[ecx*4]    ; its line number
    clc
    jmp  Done
NotFound:
    mov  eax, 0
    stc
Done:
    ret                            ; (the POPs from USES do not change the Carry flag)
LookupLabel ENDP

; ---------------------------------------------------------------------
; AddLabel
; Purpose:  Append one name + line number to the symbol table.
; Receives: ESI = address of the name (max 12 chars), EBX = line number
; Returns:  nothing
; Changes:  labelNames, labelLines, labelCount
; ---------------------------------------------------------------------
AddLabel PROC USES eax edx esi edi
    mov  eax, labelCount
    cmp  eax, MAX_LABELS           ; table full? (cannot happen: one label per line)
    jae  Done
    mov  edx, LABEL_SLOT
    mul  edx                       ; EAX = labelCount * 16 (MUL also changes EDX)
    mov  edi, OFFSET labelNames
    add  edi, eax                  ; EDI = the free slot
CopyLoop:                          ; copy the name, including its 0
    mov  al, [esi]
    mov  [edi], al
    cmp  al, 0
    je   Copied
    inc  esi
    inc  edi
    jmp  CopyLoop
Copied:
    mov  eax, labelCount
    mov  labelLines[eax*4], ebx    ; the line this label is on
    inc  labelCount
Done:
    ret
AddLabel ENDP

; ---------------------------------------------------------------------
; DebugPrintLabels
; Purpose:  When DEBUG = 1, print the symbol table: "NAME = LINE n".
; Receives: labelNames, labelLines, labelCount
; Returns:  nothing
; Changes:  nothing (console output only)
; ---------------------------------------------------------------------
DebugPrintLabels PROC USES eax ecx edx esi
    mov  eax, DEBUG
    cmp  eax, 0                    ; debug output switched off?
    je   Done
    mov  edx, OFFSET dbgLabels     ; "LABELS:"
    call WriteString
    call Crlf
    mov  ecx, 0                    ; ECX = entry index
    mov  esi, OFFSET labelNames    ; ESI = address of entry ECX
PrintLoop:
    cmp  ecx, labelCount
    jae  Done
    mov  edx, esi                  ; the name
    call WriteString
    mov  edx, OFFSET dbgAtLine     ; " = LINE "
    call WriteString
    mov  eax, labelLines[ecx*4]
    call WriteDec
    call Crlf
    add  esi, LABEL_SLOT
    inc  ecx
    jmp  PrintLoop
Done:
    ret
DebugPrintLabels ENDP

; =====================================================================
; PHASE 3 - PARSER (PASS 2 of the assembler)
; Convention used by the Parse... helpers:
;   Carry flag = 0 -> success, result in EAX
;   Carry flag = 1 -> failure, EAX = error code (CONTRACT.md)
; =====================================================================

; ---------------------------------------------------------------------
; GetTokenAddress
; Purpose:  Return the address of token K inside the tokens array.
; Receives: EAX = token index K (0-based)
; Returns:  ESI = OFFSET tokens + K * TOKEN_LEN
; Changes:  nothing else
; ---------------------------------------------------------------------
GetTokenAddress PROC USES eax edx
    mov  edx, TOKEN_LEN
    mul  edx                       ; EAX = K * TOKEN_LEN (MUL also changes EDX)
    mov  esi, OFFSET tokens
    add  esi, eax                  ; ESI = start of token K
    ret
GetTokenAddress ENDP

; ---------------------------------------------------------------------
; Tokenize
; Purpose:  Split one line into words. Spaces and commas are separators;
;           a run of separators counts as one. Only the first MAX_TOKENS
;           words are stored (max 15 chars each), but ALL words are
;           counted, so "too many operands" can still be detected.
; Receives: ESI = address of the line (uppercase, 0-terminated)
; Returns:  tokCount = total number of words on the line
; Changes:  tokens (cleared to 0 first, then filled)
; Register use inside: EBX = read pointer in the line,
;                      EDI = write pointer in the current token,
;                      ECX = chars stored in the current token,
;                      EDX = 1 if this word is stored, 0 if only counted
; ---------------------------------------------------------------------
Tokenize PROC USES eax ebx ecx edx esi edi
    mov  ebx, esi                  ; EBX = read pointer (ESI is needed for GetTokenAddress)

    ; --- clear the whole tokens array, so every token ends with a 0 ---
    mov  ecx, 0
ClearLoop:
    cmp  ecx, MAX_TOKENS*TOKEN_LEN
    jae  ClearDone
    mov  tokens[ecx], 0
    inc  ecx
    jmp  ClearLoop
ClearDone:
    mov  tokCount, 0

SkipSeparators:                    ; skip spaces/commas before the next word
    mov  al, [ebx]
    cmp  al, 0                     ; end of line -> finished
    je   Done
    cmp  al, ' '
    je   IsSeparator
    cmp  al, ','
    je   IsSeparator
    jmp  StartWord                 ; any other char starts a word
IsSeparator:
    inc  ebx
    jmp  SkipSeparators

StartWord:
    mov  eax, tokCount             ; EAX = index of this new word
    inc  tokCount                  ; count every word, stored or not
    mov  edx, 0                    ; assume "count only"
    cmp  eax, MAX_TOKENS           ; is there still a free token slot?
    jae  WordChars                 ; no -> count it but do not store it
    mov  edx, 1                    ; yes -> store this word
    call GetTokenAddress           ; ESI = address of token slot EAX
    mov  edi, esi                  ; EDI = where the next char goes
    mov  ecx, 0                    ; no chars stored yet

WordChars:                         ; copy chars until a separator or end of line
    mov  al, [ebx]
    cmp  al, 0                     ; end of line -> finished
    je   Done
    cmp  al, ' '                   ; separator -> word finished
    je   SkipSeparators
    cmp  al, ','
    je   SkipSeparators

    cmp  edx, 0                    ; count-only word? do not store
    je   NextWordChar
    cmp  ecx, TOKEN_LEN-1          ; token full (15 chars)? skip the rest
    jae  NextWordChar
    mov  [edi], al                 ; store the char
    inc  edi
    inc  ecx                       ; (the 0 after it is already there from ClearLoop)
NextWordChar:
    inc  ebx
    jmp  WordChars

Done:
    ret
Tokenize ENDP

; ---------------------------------------------------------------------
; StrEquals
; Purpose:  Compare two 0-terminated strings, character by character.
;           (Own simple loop instead of Irvine's Str_compare, so we only
;           need one return value in EAX instead of reading CPU flags.)
; Receives: ESI = address of string 1, EDI = address of string 2
; Returns:  EAX = 1 if the strings are equal, 0 if not
; Changes:  nothing else
; ---------------------------------------------------------------------
StrEquals PROC USES ebx esi edi
CompareLoop:
    mov  al, [esi]                 ; AL = char from string 1
    mov  bl, [edi]                 ; BL = char from string 2
    cmp  al, bl
    jne  NotEqual                  ; different char -> not equal
    cmp  al, 0                     ; both ended at the same time -> equal
    je   Equal
    inc  esi
    inc  edi
    jmp  CompareLoop
Equal:
    mov  eax, 1
    jmp  Done
NotEqual:
    mov  eax, 0
Done:
    ret
StrEquals ENDP

; ---------------------------------------------------------------------
; LookupOpcode
; Purpose:  Find a word in the opNames table (4-byte slots).
; Receives: ESI = address of the word
; Returns:  EAX = opcode number 1..14, or 0 if the word is not an opcode
; Changes:  nothing else
; ---------------------------------------------------------------------
LookupOpcode PROC USES ecx edi
    mov  ecx, 0                    ; ECX = slot index (0 = MOV)
    mov  edi, OFFSET opNames       ; EDI = address of the current name
SearchLoop:
    cmp  ecx, NUM_OPCODES          ; checked all names?
    jae  NotFound
    call StrEquals                 ; compare word (ESI) with name (EDI)
    cmp  eax, 1
    je   Found
    add  edi, OP_SLOT              ; next name is 4 bytes further
    inc  ecx
    jmp  SearchLoop
Found:
    mov  eax, ecx
    inc  eax                       ; opcode number = slot index + 1
    jmp  Done
NotFound:
    mov  eax, 0
Done:
    ret
LookupOpcode ENDP

; ---------------------------------------------------------------------
; LookupRegister
; Purpose:  Find a word in the regNames table (3-byte slots).
; Receives: ESI = address of the word
; Returns:  EAX = register index 0..3 (AX..DX), or -1 if not a register
; Changes:  nothing else
; ---------------------------------------------------------------------
LookupRegister PROC USES ecx edi
    mov  ecx, 0                    ; ECX = slot index (0 = AX)
    mov  edi, OFFSET regNames
SearchLoop:
    cmp  ecx, NUM_REGS             ; checked all names?
    jae  NotFound
    call StrEquals
    cmp  eax, 1
    je   Found
    add  edi, REG_SLOT             ; next name is 3 bytes further
    inc  ecx
    jmp  SearchLoop
Found:
    mov  eax, ecx                  ; register index = slot index
    jmp  Done
NotFound:
    mov  eax, -1
Done:
    ret
LookupRegister ENDP

; ---------------------------------------------------------------------
; IsNumberStart
; Purpose:  Decide if a word "looks like a number": its first char is
;           '0'..'9', '-' or '+'. Used to choose error 8 vs 2 and 5 vs 2.
;           ("+5" looks like a number, but StrToInt rejects it -> error 5 / 8.)
; Receives: ESI = address of the word
; Returns:  EAX = 1 if it looks like a number, 0 if not
; Changes:  nothing else
; ---------------------------------------------------------------------
IsNumberStart PROC
    mov  al, [esi]                 ; AL = first char of the word
    cmp  al, '-'
    je   Yes
    cmp  al, '+'                   ; "+5" looks like a number (but is not valid)
    je   Yes
    cmp  al, '0'
    jb   No
    cmp  al, '9'
    ja   No
Yes:
    mov  eax, 1
    ret
No:
    mov  eax, 0
    ret
IsNumberStart ENDP

; ---------------------------------------------------------------------
; StrToInt
; Purpose:  Convert a word to a signed 32-bit number.
;           Valid: optional single '-', then one or more digits, nothing else.
;           The value must be in -2147483648 .. 2147483647.
; Receives: ESI = address of the word
; Returns:  EAX = the value, Carry flag = 0 if valid
;           EAX = 0,         Carry flag = 1 if invalid
; Changes:  nothing else
; Register use inside: EAX = value so far (always positive),
;                      EBX = 1 if negative, ECX = largest allowed value,
;                      EDI = current digit
; ---------------------------------------------------------------------
StrToInt PROC USES ebx ecx edx edi esi
    mov  eax, 0                    ; value = 0
    mov  ebx, 0                    ; assume positive
    mov  ecx, 2147483647           ; largest positive value
    cmp  BYTE PTR [esi], '-'       ; leading minus sign?
    jne  CheckFirst
    mov  ebx, 1                    ; negative
    mov  ecx, 80000000h            ; = 2147483648: a negative number may go one further (-2147483648)
    inc  esi                       ; skip the '-'
CheckFirst:
    cmp  BYTE PTR [esi], 0         ; nothing (left) after the sign? ("" or "-")
    je   Invalid

DigitLoop:
    movzx edi, BYTE PTR [esi]      ; EDI = next char
    cmp  edi, 0                    ; end of word -> all digits read
    je   AllDigits
    cmp  edi, '0'                  ; not a digit -> invalid ("5A", "--3")
    jb   Invalid
    cmp  edi, '9'
    ja   Invalid
    sub  edi, '0'                  ; char '7' -> number 7

    mov  edx, 10
    mul  edx                       ; EDX:EAX = value * 10
    cmp  edx, 0                    ; result did not fit in 32 bits -> too big
    jne  Invalid
    add  eax, edi                  ; value = value * 10 + digit
    jc   Invalid                   ; carry -> did not fit in 32 bits -> too big
    cmp  eax, ecx                  ; bigger than allowed? (unsigned compare)
    ja   Invalid

    inc  esi                       ; next char
    jmp  DigitLoop

AllDigits:
    cmp  ebx, 1                    ; was there a minus sign?
    jne  Valid
    neg  eax                       ; make the value negative
Valid:
    clc                            ; Carry = 0 -> valid
    jmp  Done
Invalid:
    mov  eax, 0
    stc                            ; Carry = 1 -> invalid
Done:
    ret                            ; (the POPs from USES do not change the Carry flag)
StrToInt ENDP

; ---------------------------------------------------------------------
; ParseRegOperand
; Purpose:  Check an operand that must be a register (operand 1 of
;           MOV/ADD/SUB/CMP/INC/DEC).
; Receives: ESI = address of the operand word
; Returns:  Carry = 0: EAX = register index 0..3
;           Carry = 1: EAX = error code (8 if it looks like a number, else 2)
; Changes:  nothing else
; ---------------------------------------------------------------------
ParseRegOperand PROC
    call LookupRegister            ; EAX = 0..3 or -1
    cmp  eax, -1
    je   NotRegister
    clc                            ; valid register
    ret
NotRegister:
    call IsNumberStart             ; "5" or "-2" -> error 8, "EX" -> error 2
    cmp  eax, 1
    je   LooksLikeNumber
    mov  eax, ERR_BAD_REGISTER
    stc
    ret
LooksLikeNumber:
    mov  eax, ERR_FIRST_NOT_REG
    stc
    ret
ParseRegOperand ENDP

; ---------------------------------------------------------------------
; ParseSrcOperand
; Purpose:  Check operand 2 of MOV/ADD/SUB/CMP: a register or a number.
; Receives: ESI = address of the operand word
; Returns:  Carry = 0: EDX = SRC_REGISTER, EAX = register index, or
;                      EDX = SRC_NUMBER,   EAX = the number
;           Carry = 1: EAX = error code (5 if it looks like a number, else 2)
; Changes:  nothing else
; ---------------------------------------------------------------------
ParseSrcOperand PROC
    call LookupRegister            ; is it AX/BX/CX/DX?
    cmp  eax, -1
    je   NotRegister
    mov  edx, SRC_REGISTER         ; EAX already holds the register index
    clc
    ret
NotRegister:
    call IsNumberStart             ; starts with digit, '-' or '+'?
    cmp  eax, 1
    jne  BadRegister               ; no -> it is a bad register name
    call StrToInt                  ; EAX = value, Carry = 1 if invalid
    jc   BadNumber
    mov  edx, SRC_NUMBER
    clc
    ret
BadNumber:
    mov  eax, ERR_BAD_NUMBER
    stc
    ret
BadRegister:
    mov  eax, ERR_BAD_REGISTER
    stc
    ret
ParseSrcOperand ENDP

; ---------------------------------------------------------------------
; ParseJumpTarget
; Purpose:  Check the operand of a jump (JMP JZ JNZ JS JNS JC JNC). It is either
;           - a line number (starts with a digit, '-' or '+'): must be a
;             valid number from 1 to lineCount, or
;           - a label name: looked up in the symbol table from PASS 1.
; Receives: ESI = address of the operand word, lineCount, symbol table
; Returns:  Carry = 0: EAX = target line number
;           Carry = 1: EAX = error code (5 bad number, 6 out of range,
;                      10 undefined label)
; Changes:  nothing else
; ---------------------------------------------------------------------
ParseJumpTarget PROC
    call IsNumberStart             ; "7", "-1", "+5" -> treat it as a line number
    cmp  eax, 1
    je   LineNumber
    call LookupLabel               ; anything else is a label: EAX = its line
    jc   Undefined                 ; not in the symbol table
    clc                            ; (a label's line is always in range)
    ret
Undefined:
    mov  eax, ERR_UNDEF_LABEL
    stc
    ret
LineNumber:
    call StrToInt                  ; EAX = value, Carry = 1 if not a number
    jc   BadNumber
    cmp  eax, 1                    ; below line 1? (signed compare, value may be negative)
    jl   OutOfRange
    cmp  eax, lineCount            ; after the last line?
    jg   OutOfRange
    clc                            ; valid target
    ret
BadNumber:
    mov  eax, ERR_BAD_NUMBER
    stc
    ret
OutOfRange:
    mov  eax, ERR_JUMP_RANGE
    stc
    ret
ParseJumpTarget ENDP

; ---------------------------------------------------------------------
; ParseLine
; Purpose:  Parse one line. On success fill instOp/instDst/instSrcType/
;           instSrc for that line; on failure store the FIRST error found
;           in lineErr. Check order: opcode (1) -> missing operand (3) ->
;           operand 1 (8/2, or 5/6/10 for jumps) -> operand 2 (5/2) -> extra (4).
;           PASS 1 already removed any label from the line. If PASS 1 found
;           a label error on this line (11/12), the line is not parsed.
; Receives: EAX = line number (1-based), lineText
; Returns:  nothing
; Changes:  instOp, instDst, instSrcType, instSrc, lineErr (for this line),
;           tokens, tokCount
; Register use inside: EBX = array index (line - 1), ECX = opcode,
;                      EDI = number of operands this opcode needs
; ---------------------------------------------------------------------
ParseLine PROC USES eax ebx ecx edx esi edi
    mov  ebx, eax
    dec  ebx                       ; EBX = index into the per-line arrays

    ; start with a clean entry for this line
    mov  instOp[ebx], 0
    mov  instDst[ebx], 0
    mov  instSrcType[ebx], SRC_NONE
    mov  instSrc[ebx*4], 0         ; instSrc is SDWORD, so index * 4
    cmp  lineErr[ebx], 0           ; label error from PASS 1? keep it, one error per line
    jne  Done

    call GetLineAddress            ; ESI = address of this line (EAX = line number)
    call Tokenize                  ; split it into words
    cmp  tokCount, 0               ; no words -> empty line, not an error
    je   Done

    ; ---- 1. opcode ----
    mov  eax, 0
    call GetTokenAddress           ; ESI = word 0
    call LookupOpcode              ; EAX = opcode 1..10 or 0
    cmp  eax, 0
    jne  OpcodeOK
    mov  eax, ERR_UNKNOWN_OP
    jmp  SetError
OpcodeOK:
    mov  ecx, eax                  ; ECX = opcode (kept for the whole PROC)
    movzx edi, opOperandCount[ecx-1] ; EDI = operands needed (table index = opcode - 1)

    ; ---- 2. missing operand ----
    mov  eax, tokCount
    dec  eax                       ; EAX = operands given (words minus the opcode)
    cmp  eax, edi
    jae  CountOK
    mov  eax, ERR_MISSING_OP
    jmp  SetError
CountOK:

    cmp  ecx, OP_HLT               ; HLT has no operands to check
    je   CheckExtra
    cmp  ecx, OP_JMP               ; all jumps (7..9 and 11..14; HLT = 10 was handled
                                   ; just above) take a line number or a label
    jae  JumpOperand

    ; ---- 3. operand 1 must be a register (MOV ADD SUB CMP INC DEC) ----
    mov  eax, 1
    call GetTokenAddress           ; ESI = word 1
    call ParseRegOperand           ; EAX = register index or error code
    jc   SetError
    mov  instDst[ebx], al          ; store destination register
    cmp  ecx, OP_INC               ; INC/DEC have only one operand
    jae  CheckExtra

    ; ---- 4. operand 2: register or number (MOV ADD SUB CMP) ----
    mov  eax, 2
    call GetTokenAddress           ; ESI = word 2
    call ParseSrcOperand           ; EAX = value/register, EDX = source type
    jc   SetError
    mov  instSrcType[ebx], dl
    mov  instSrc[ebx*4], eax
    jmp  CheckExtra

JumpOperand:                       ; ---- 3. operand 1 of a jump: line number or label ----
    mov  eax, 1
    call GetTokenAddress           ; ESI = word 1
    call ParseJumpTarget           ; EAX = target line or error code
    jc   SetError
    mov  instSrcType[ebx], SRC_NUMBER
    mov  instSrc[ebx*4], eax

CheckExtra:                        ; ---- 5. extra operand ----
    mov  eax, tokCount
    dec  eax                       ; EAX = operands given
    cmp  eax, edi                  ; more than needed?
    jbe  StoreOpcode
    mov  eax, ERR_EXTRA_OP
    jmp  SetError

StoreOpcode:                       ; everything is valid
    mov  instOp[ebx], cl
    jmp  Done

SetError:                          ; EAX = error code
    mov  lineErr[ebx], al
    mov  instDst[ebx], 0           ; remove any fields stored before the error
    mov  instSrcType[ebx], SRC_NONE
    mov  instSrc[ebx*4], 0
Done:
    ret
ParseLine ENDP

; ---------------------------------------------------------------------
; ParseAllLines
; Purpose:  Parse lines 1..lineCount. If the file had more than 50 lines,
;           mark line 51 with error 7.
; Receives: lineCount, tooManyLines
; Returns:  nothing
; Changes:  instruction arrays and lineErr (through ParseLine)
; ---------------------------------------------------------------------
ParseAllLines PROC USES eax
    mov  eax, 1                    ; EAX = line number
LineLoop:
    cmp  eax, lineCount
    ja   LinesDone
    call ParseLine                 ; (ParseLine keeps EAX unchanged)
    inc  eax
    jmp  LineLoop
LinesDone:
    cmp  tooManyLines, 1
    jne  Done
    mov  lineErr[MAX_LINES], ERR_TOO_MANY ; index 50 = line 51
Done:
    ret
ParseAllLines ENDP

; ---------------------------------------------------------------------
; DebugPrintParsed
; Purpose:  When DEBUG = 1, print the parser result for every line:
;           "n: EMPTY", "n: ERR=e" or "n: OP=o DST=d SRCTYPE=t SRC=s",
;           plus "51: ERR=7" if there were too many lines.
; Receives: lineCount, tooManyLines, fileMissing, instruction arrays, lineErr
; Returns:  nothing
; Changes:  nothing (console output only)
; ---------------------------------------------------------------------
DebugPrintParsed PROC USES eax ebx edx
    mov  eax, DEBUG
    cmp  eax, 0                    ; debug output switched off?
    je   Done
    cmp  fileMissing, 1            ; nothing was parsed
    je   Done

    mov  edx, OFFSET dbgParsed     ; "PARSED:"
    call WriteString
    call Crlf

    mov  ebx, 0                    ; EBX = array index (line number - 1)
LineLoop:
    cmp  ebx, lineCount
    jae  PrintLine51

    mov  eax, ebx
    inc  eax                       ; line number = index + 1
    call WriteDec
    mov  edx, OFFSET dbgColon      ; ": "
    call WriteString

    cmp  lineErr[ebx], 0           ; error on this line?
    je   NoError
    mov  edx, OFFSET dbgErr        ; "ERR=<code>"
    call WriteString
    movzx eax, lineErr[ebx]
    call WriteDec
    jmp  EndOfLine

NoError:
    cmp  instOp[ebx], 0            ; no opcode and no error -> empty line
    jne  PrintFields
    mov  edx, OFFSET dbgEmpty
    call WriteString
    jmp  EndOfLine

PrintFields:
    mov  edx, OFFSET dbgOp         ; "OP=<opcode>"
    call WriteString
    movzx eax, instOp[ebx]
    call WriteDec
    mov  edx, OFFSET dbgDst        ; " DST=<register>"
    call WriteString
    movzx eax, instDst[ebx]
    call WriteDec
    mov  edx, OFFSET dbgSrcType    ; " SRCTYPE=<type>"
    call WriteString
    movzx eax, instSrcType[ebx]
    call WriteDec
    mov  edx, OFFSET dbgSrc        ; " SRC=<value>"
    call WriteString
    mov  eax, instSrc[ebx*4]
    cmp  eax, 0                    ; WriteInt prints "+5" for positive numbers,
    jl   PrintNegative             ; so use WriteDec for 0 and positive values
    call WriteDec
    jmp  EndOfLine
PrintNegative:
    call WriteInt                  ; prints "-5"

EndOfLine:
    call Crlf
    inc  ebx
    jmp  LineLoop

PrintLine51:
    cmp  tooManyLines, 1           ; "51: ERR=7" only if there were too many lines
    jne  Done
    mov  eax, MAX_LINES+1
    call WriteDec
    mov  edx, OFFSET dbgColon
    call WriteString
    mov  edx, OFFSET dbgErr
    call WriteString
    movzx eax, lineErr[MAX_LINES]
    call WriteDec
    call Crlf
Done:
    ret
DebugPrintParsed ENDP

; =====================================================================
; PHASE 4 - EXECUTION ENGINE
; The virtual CPU lives in memory: regs (AX..DX), zeroFlag, pc, stepCount.
; Real CPU registers are only used as temporary helpers.
; =====================================================================

; ---------------------------------------------------------------------
; GetSourceValue
; Purpose:  Get the value of the source operand of one instruction:
;           the value inside a virtual register, or the number itself.
; Receives: EBX = instruction index (line - 1), instSrcType, instSrc, regs
; Returns:  EAX = source value
; Changes:  nothing else
; ---------------------------------------------------------------------
GetSourceValue PROC USES ecx
    mov  eax, instSrc[ebx*4]       ; EAX = stored number, or register index
    cmp  instSrcType[ebx], SRC_REGISTER
    jne  Done                      ; a number -> EAX already holds the value
    mov  ecx, eax                  ; ECX = register index 0..3
    mov  eax, regs[ecx*4]          ; EAX = value inside that virtual register
Done:
    ret
GetSourceValue ENDP

; ---------------------------------------------------------------------
; SetZeroFlag
; Purpose:  Set the virtual Zero Flag from a result: 1 if it is 0, else 0.
; Receives: EAX = result
; Returns:  nothing
; Changes:  zeroFlag
; ---------------------------------------------------------------------
SetZeroFlag PROC
    cmp  eax, 0
    je   IsZero
    mov  zeroFlag, 0
    ret
IsZero:
    mov  zeroFlag, 1
    ret
SetZeroFlag ENDP

; ---------------------------------------------------------------------
; SetSignFlag
; Purpose:  Set the virtual Sign Flag from a result: bit 31 of a signed
;           32-bit number is 1 exactly when the number is negative.
; Receives: EAX = result
; Returns:  nothing
; Changes:  signFlag
; ---------------------------------------------------------------------
SetSignFlag PROC
    test eax, 80000000h            ; look only at bit 31 (the sign bit)
    jz   Positive
    mov  signFlag, 1               ; bit 31 = 1 -> negative
    ret
Positive:
    mov  signFlag, 0               ; bit 31 = 0 -> zero or positive
    ret
SetSignFlag ENDP

; ---------------------------------------------------------------------
; StoreCarry
; Purpose:  Copy the REAL CPU's Carry flag into the virtual carryFlag.
;           Call it IMMEDIATELY after the real ADD/SUB: the next CMP or
;           TEST would overwrite the real flags. CALL, RET and MOV do not
;           change the flags, so the carry of the ADD/SUB is still there.
;           The real CPU already computes exactly the CF we want:
;           ADD -> carry out of bit 31, SUB -> borrow (unsigned dst < src).
; Receives: the real Carry flag (from the instruction just before the CALL)
; Returns:  nothing
; Changes:  carryFlag
; ---------------------------------------------------------------------
StoreCarry PROC
    mov  carryFlag, 0              ; MOV does not touch the real flags
    jnc  Done                      ; real CF = 0 -> keep 0
    mov  carryFlag, 1              ; real CF = 1
Done:
    ret
StoreCarry ENDP

; ---------------------------------------------------------------------
; ExecuteInstruction
; Purpose:  Execute ONE parsed instruction (decode + execute) and work
;           out which line runs next.
;           Arithmetic wraps around like a real CPU (2147483647 + 1 =
;           -2147483648), because we use the real ADD/SUB/INC/DEC on
;           32-bit values.
; Receives: EBX = instruction index (line - 1), pc, instruction arrays
; Returns:  EAX = next pc, ECX = 1 if HLT was executed, else 0
; Changes:  regs, zeroFlag, signFlag, carryFlag
;           Flags: ADD/SUB/CMP set ZF, SF and CF; INC/DEC set ZF and SF
;           but keep CF (like real x86); MOV, jumps and HLT change none.
; Register use inside: ESI = destination register index, EDX = opcode
; ---------------------------------------------------------------------
ExecuteInstruction PROC USES edx esi
    movzx esi, instDst[ebx]        ; ESI = destination register index 0..3
    movzx edx, instOp[ebx]         ; EDX = opcode
    mov  ecx, 0                    ; assume "not HLT"

    ; ---- decode: jump to the block for this opcode ----
    cmp  edx, OP_MOV
    je   DoMov
    cmp  edx, OP_ADD
    je   DoAdd
    cmp  edx, OP_SUB
    je   DoSub
    cmp  edx, OP_CMP
    je   DoCmp
    cmp  edx, OP_INC
    je   DoInc
    cmp  edx, OP_DEC
    je   DoDec
    cmp  edx, OP_JMP
    je   DoJmp
    cmp  edx, OP_JZ
    je   DoJz
    cmp  edx, OP_JNZ
    je   DoJnz
    cmp  edx, OP_HLT
    je   DoHlt
    cmp  edx, OP_JS
    je   DoJs
    cmp  edx, OP_JNS
    je   DoJns
    cmp  edx, OP_JC
    je   DoJc
    cmp  edx, OP_JNC
    je   DoJnc
    jmp  NextLine                  ; (never happens: only valid opcodes get here)

DoMov:                             ; MOV dst, src : dst = src, no flag changes
    call GetSourceValue            ; EAX = src
    mov  regs[esi*4], eax
    jmp  NextLine

DoAdd:                             ; ADD dst, src : dst = dst + src, set ZF SF CF
    call GetSourceValue
    add  regs[esi*4], eax          ; the real ADD sets the real Carry flag
    call StoreCarry                ; copy it FIRST (SetZeroFlag's CMP would destroy it)
    mov  eax, regs[esi*4]          ; EAX = result
    call SetZeroFlag
    call SetSignFlag
    jmp  NextLine

DoSub:                             ; SUB dst, src : dst = dst - src, set ZF SF CF
    call GetSourceValue
    sub  regs[esi*4], eax          ; the real SUB sets Carry = borrow
    call StoreCarry                ; copy it FIRST
    mov  eax, regs[esi*4]
    call SetZeroFlag
    call SetSignFlag
    jmp  NextLine

DoCmp:                             ; CMP dst, src : flags like SUB, no register changes
    call GetSourceValue            ; EAX = src
    mov  edx, regs[esi*4]          ; EDX = a COPY of dst
    sub  edx, eax                  ; dst - src is 0 exactly when dst == src
    call StoreCarry                ; borrow of the subtraction -> CF
    mov  eax, edx                  ; (the virtual register itself is not changed)
    call SetZeroFlag
    call SetSignFlag
    jmp  NextLine

DoInc:                             ; INC dst : dst = dst + 1, set ZF SF
    inc  regs[esi*4]               ; (no StoreCarry: real INC never changes CF,
    mov  eax, regs[esi*4]          ;  so a loop counter does not destroy a carry)
    call SetZeroFlag
    call SetSignFlag
    jmp  NextLine

DoDec:                             ; DEC dst : dst = dst - 1, set ZF SF (CF kept)
    dec  regs[esi*4]
    mov  eax, regs[esi*4]
    call SetZeroFlag
    call SetSignFlag
    jmp  NextLine

DoJmp:                             ; JMP n : always go to line n
    mov  eax, instSrc[ebx*4]       ; EAX = target line
    jmp  Done

DoJz:                              ; JZ n : go to line n only if ZF = 1
    cmp  zeroFlag, 1
    jne  NextLine                  ; ZF = 0 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoJnz:                             ; JNZ n : go to line n only if ZF = 0
    cmp  zeroFlag, 0
    jne  NextLine                  ; ZF = 1 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoJs:                              ; JS n : go to line n only if SF = 1
    cmp  signFlag, 1
    jne  NextLine                  ; SF = 0 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoJns:                             ; JNS n : go to line n only if SF = 0
    cmp  signFlag, 0
    jne  NextLine                  ; SF = 1 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoJc:                              ; JC n : go to line n only if CF = 1
    cmp  carryFlag, 1
    jne  NextLine                  ; CF = 0 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoJnc:                             ; JNC n : go to line n only if CF = 0
    cmp  carryFlag, 0
    jne  NextLine                  ; CF = 1 -> not taken
    mov  eax, instSrc[ebx*4]
    jmp  Done

DoHlt:                             ; HLT : stop the program
    mov  ecx, 1                    ; tell ExecuteProgram to stop
    mov  eax, pc                   ; (next pc is not used after HLT)
    jmp  Done

NextLine:                          ; normal case: next pc = pc + 1
    mov  eax, pc
    inc  eax
Done:
    ret
ExecuteInstruction ENDP

; ---------------------------------------------------------------------
; ExecuteProgram
; Purpose:  The fetch-decode-execute loop. Starts at line 1 and runs
;           until HLT, an error line, the end of the program, or the
;           500-step guard. Empty lines are skipped (no step).
; Receives: lineCount, tooManyLines, lineErr, instruction arrays
; Returns:  endType, endValue
; Changes:  regs, zeroFlag, pc, stepCount, outBuf, outPos
; Register use inside: EBX = index of the current line (pc - 1),
;                      EAX = next pc, ECX = 1 after HLT
; ---------------------------------------------------------------------
ExecuteProgram PROC USES eax ebx ecx edx
    ; ---- reset the virtual CPU ----
    ; (in MASM, regs[n] means "n BYTES after regs"; each register is 4 bytes)
    mov  regs[0], 0                ; AX
    mov  regs[4], 0                ; BX
    mov  regs[8], 0                ; CX
    mov  regs[12], 0               ; DX
    mov  zeroFlag, 0               ; all three flags start at 0
    mov  signFlag, 0
    mov  carryFlag, 0
    mov  pc, 1                     ; execution always starts at line 1
    mov  stepCount, 0

FetchLoop:
    ; ---- ran past the last stored line? ----
    mov  eax, pc
    cmp  eax, lineCount
    jbe  CheckError
    cmp  tooManyLines, 1           ; the "next line" is line 51, which has error 7
    jne  RanPastEnd
    mov  endType, END_ERRSTOP
    mov  endValue, MAX_LINES+1     ; END ERRSTOP 51
    jmp  Done
RanPastEnd:
    mov  endType, END_NOHLT        ; END NOHLT <steps>
    mov  edx, stepCount
    mov  endValue, edx
    jmp  Done

CheckError:
    ; ---- fetch: is the line at pc an error line? ----
    mov  ebx, pc
    dec  ebx                       ; EBX = index of this line
    cmp  lineErr[ebx], 0
    je   CheckEmpty
    mov  endType, END_ERRSTOP      ; END ERRSTOP <line>
    mov  edx, pc
    mov  endValue, edx
    jmp  Done

CheckEmpty:
    cmp  instOp[ebx], 0            ; empty line -> skip it, no step
    jne  RunInstruction
    inc  pc
    jmp  FetchLoop

RunInstruction:
    ; ---- decode + execute ----
    call ExecuteInstruction        ; EAX = next pc, ECX = 1 if HLT
    inc  stepCount
    call AppendStepLine            ; STEP line into outBuf (pc = line just executed)
    call DebugPrintStep            ; same step on the console (only if DEBUG = 1)

    cmp  ecx, 1                    ; was it HLT?
    jne  CheckGuard
    mov  endType, END_HALT         ; END HALT <steps>
    mov  edx, stepCount
    mov  endValue, edx
    jmp  Done

CheckGuard:
    cmp  stepCount, MAX_STEPS      ; infinite loop guard
    jb   NextInstruction
    mov  endType, END_LOOP         ; END LOOP 500
    mov  edx, stepCount
    mov  endValue, edx
    jmp  Done

NextInstruction:
    mov  pc, eax                   ; move to the next instruction
    jmp  FetchLoop

Done:
    ret
ExecuteProgram ENDP

; ---------------------------------------------------------------------
; DebugWriteSigned
; Purpose:  Print a signed number on the console without a '+' sign
;           (Irvine's WriteInt prints "+5", so use WriteDec for >= 0).
; Receives: EAX = value
; Returns:  nothing
; Changes:  nothing (console output only)
; ---------------------------------------------------------------------
DebugWriteSigned PROC
    cmp  eax, 0
    jl   Negative
    call WriteDec                  ; 0 and positive numbers: "5"
    ret
Negative:
    call WriteInt                  ; negative numbers: "-5"
    ret
DebugWriteSigned ENDP

; ---------------------------------------------------------------------
; DebugPrintStep
; Purpose:  When DEBUG = 1, print one executed step:
;           STEP <n> LINE <l>: AX=<v> BX=<v> CX=<v> DX=<v> ZF=<z> SF=<s> CF=<c>
; Receives: stepCount, pc (the line just executed), regs, zeroFlag
; Returns:  nothing
; Changes:  nothing (console output only)
; ---------------------------------------------------------------------
DebugPrintStep PROC USES eax edx
    mov  eax, DEBUG
    cmp  eax, 0                    ; debug output switched off?
    je   Done

    mov  edx, OFFSET dbgStep       ; "STEP <n>"
    call WriteString
    mov  eax, stepCount
    call WriteDec
    mov  edx, OFFSET dbgLine       ; " LINE <l>"
    call WriteString
    mov  eax, pc
    call WriteDec
    mov  edx, OFFSET dbgAX         ; ": AX=<v>"
    call WriteString
    mov  eax, regs[0]              ; regs[0]=AX, [4]=BX, [8]=CX, [12]=DX (byte offsets)
    call DebugWriteSigned
    mov  edx, OFFSET dbgBX         ; " BX=<v>"
    call WriteString
    mov  eax, regs[4]
    call DebugWriteSigned
    mov  edx, OFFSET dbgCX         ; " CX=<v>"
    call WriteString
    mov  eax, regs[8]
    call DebugWriteSigned
    mov  edx, OFFSET dbgDX         ; " DX=<v>"
    call WriteString
    mov  eax, regs[12]
    call DebugWriteSigned
    mov  edx, OFFSET dbgZF         ; " ZF=<z>"
    call WriteString
    mov  eax, zeroFlag
    call WriteDec
    mov  edx, OFFSET dbgSF         ; " SF=<s>"
    call WriteString
    mov  eax, signFlag
    call WriteDec
    mov  edx, OFFSET dbgCF         ; " CF=<c>"
    call WriteString
    mov  eax, carryFlag
    call WriteDec
    call Crlf
Done:
    ret
DebugPrintStep ENDP

; =====================================================================
; PHASE 5 - BUILDING AND WRITING result.txt
; Everything is first appended to outBuf (in memory). WriteResultFile
; then writes the whole buffer to result.txt with ONE WriteToFile call.
; Every line ends with LF (10) only.
; =====================================================================

; ---------------------------------------------------------------------
; IntToStr
; Purpose:  Convert a signed 32-bit number to text, e.g. -15 -> "-15".
;           (WriteDec/WriteInt can only print to the console, so we need
;           our own conversion to put numbers into result.txt.)
; Receives: EAX = signed value
; Returns:  numBuf = the number as a 0-terminated string
; Changes:  nothing else
; Register use inside: EDI = write pointer in numBuf, ECX = digit count
; ---------------------------------------------------------------------
IntToStr PROC USES eax ebx ecx edx edi
    mov  edi, OFFSET numBuf
    cmp  eax, 0                    ; negative?
    jge  NotNegative
    mov  BYTE PTR [edi], '-'       ; write the minus sign first
    inc  edi
    neg  eax                       ; make it positive, e.g. -15 -> 15.
    ; Special case: NEG of -2147483648 (80000000h) is 80000000h again, but
    ; read as an UNSIGNED number that is exactly 2147483648, which is the
    ; correct size. Because we use unsigned DIV below, the digits come out
    ; right: "-2147483648".
NotNegative:

    ; ---- get the digits: they come out last digit first ----
    mov  ecx, 0                    ; no digits yet
    mov  ebx, 10
DigitLoop:
    mov  edx, 0                    ; DIV divides EDX:EAX, so clear EDX first
    div  ebx                       ; EAX = EAX / 10, EDX = remainder (last digit)
    push edx                       ; save the digit on the stack
    inc  ecx
    cmp  eax, 0                    ; more digits left? (0 still gives one digit "0")
    jne  DigitLoop

    ; ---- the stack gives the digits back in the right order ----
WriteLoop:
    pop  edx                       ; last pushed = first digit
    add  dl, '0'                   ; number 7 -> char '7'
    mov  [edi], dl
    inc  edi
    dec  ecx
    jnz  WriteLoop

    mov  BYTE PTR [edi], 0         ; terminate the string (max 11 chars + 0 fits in 16)
    ret
IntToStr ENDP

; ---------------------------------------------------------------------
; AppendChar
; Purpose:  Add one character to the end of outBuf. If the buffer is
;           full, the character is dropped (never write past outBuf).
; Receives: AL = character, outPos
; Returns:  nothing
; Changes:  outBuf, outPos
; ---------------------------------------------------------------------
AppendChar PROC USES ebx
    mov  ebx, outPos
    cmp  ebx, OUT_SIZE             ; buffer full?
    jae  Done
    mov  outBuf[ebx], al           ; store the character
    inc  outPos
Done:
    ret
AppendChar ENDP

; ---------------------------------------------------------------------
; AppendString
; Purpose:  Add a 0-terminated string to outBuf (without the 0).
; Receives: ESI = address of the string
; Returns:  nothing
; Changes:  outBuf, outPos
; ---------------------------------------------------------------------
AppendString PROC USES eax esi
NextChar:
    mov  al, [esi]
    cmp  al, 0                     ; end of the string?
    je   Done
    call AppendChar
    inc  esi
    jmp  NextChar
Done:
    ret
AppendString ENDP

; ---------------------------------------------------------------------
; AppendNumber
; Purpose:  Add a signed number as text to outBuf ("5", "-5", "0").
; Receives: EAX = signed value
; Returns:  nothing
; Changes:  numBuf, outBuf, outPos
; ---------------------------------------------------------------------
AppendNumber PROC USES esi
    call IntToStr                  ; numBuf = text of EAX
    mov  esi, OFFSET numBuf
    call AppendString
    ret
AppendNumber ENDP

; ---------------------------------------------------------------------
; AppendSpace
; Purpose:  Add one space (the field separator) to outBuf.
; Receives: nothing
; Returns:  nothing
; Changes:  outBuf, outPos
; ---------------------------------------------------------------------
AppendSpace PROC USES eax
    mov  al, ' '
    call AppendChar
    ret
AppendSpace ENDP

; ---------------------------------------------------------------------
; AppendNewline
; Purpose:  End the current line in outBuf with LF (10) only, no CR.
; Receives: nothing
; Returns:  nothing
; Changes:  outBuf, outPos
; ---------------------------------------------------------------------
AppendNewline PROC USES eax
    mov  al, 10
    call AppendChar
    ret
AppendNewline ENDP

; ---------------------------------------------------------------------
; AppendStatusAndErrors
; Purpose:  Write the STATUS line and all ERR lines (ascending line
;           number, line 51 included for error 7). If program.txt was
;           missing, write "STATUS ERR" / "ERR 0 9" and set the end
;           to ERRSTOP 0.
; Receives: fileMissing, lineErr
; Returns:  nothing
; Changes:  outBuf, outPos (and endType, endValue if the file is missing)
; Register use inside: EBX = lineErr index (0 .. MAX_LINES = line 1 .. 51)
; ---------------------------------------------------------------------
AppendStatusAndErrors PROC USES eax ebx esi
    cmp  fileMissing, 1
    jne  CheckForErrors

    ; ---- program.txt missing: error 9 on line 0 ----
    mov  esi, OFFSET txtStatusErr  ; "STATUS ERR"
    call AppendString
    call AppendNewline
    mov  esi, OFFSET txtErr        ; "ERR 0 9"
    call AppendString
    call AppendSpace
    mov  eax, 0
    call AppendNumber
    call AppendSpace
    mov  eax, ERR_NO_FILE
    call AppendNumber
    call AppendNewline
    mov  endType, END_ERRSTOP      ; the END line will be "END ERRSTOP 0"
    mov  endValue, 0
    jmp  Done

CheckForErrors:
    ; ---- is there any error at all? (indexes 0..50 = lines 1..51) ----
    mov  ebx, 0
ScanLoop:
    cmp  ebx, MAX_LINES
    ja   NoErrors                  ; checked all -> no errors
    cmp  lineErr[ebx], 0
    jne  HasErrors
    inc  ebx
    jmp  ScanLoop

NoErrors:
    mov  esi, OFFSET txtStatusOk   ; "STATUS OK"
    call AppendString
    call AppendNewline
    jmp  Done

HasErrors:
    mov  esi, OFFSET txtStatusErr  ; "STATUS ERR"
    call AppendString
    call AppendNewline

    ; ---- one "ERR <line> <code>" per error, in line order ----
    mov  ebx, 0
ErrLoop:
    cmp  ebx, MAX_LINES
    ja   Done
    cmp  lineErr[ebx], 0           ; no error on this line -> skip
    je   NextIndex
    mov  esi, OFFSET txtErr        ; "ERR"
    call AppendString
    call AppendSpace
    mov  eax, ebx
    inc  eax                       ; line number = index + 1
    call AppendNumber
    call AppendSpace
    movzx eax, lineErr[ebx]        ; error code
    call AppendNumber
    call AppendNewline
NextIndex:
    inc  ebx
    jmp  ErrLoop

Done:
    ret
AppendStatusAndErrors ENDP

; ---------------------------------------------------------------------
; AppendStepLine
; Purpose:  Write one "STEP <n> <line> <AX> <BX> <CX> <DX> <ZF> <SF> <CF>" line,
;           with the register values AFTER the instruction ran.
; Receives: stepCount, pc (the line just executed), regs, zeroFlag
; Returns:  nothing
; Changes:  outBuf, outPos
; Register use inside: EBX = register index 0..3
; ---------------------------------------------------------------------
AppendStepLine PROC USES eax ebx esi
    mov  esi, OFFSET txtStep       ; "STEP"
    call AppendString
    call AppendSpace
    mov  eax, stepCount            ; step number
    call AppendNumber
    call AppendSpace
    mov  eax, pc                   ; line number
    call AppendNumber

    mov  ebx, 0                    ; AX, BX, CX, DX
RegLoop:
    call AppendSpace
    mov  eax, regs[ebx*4]          ; value of virtual register EBX
    call AppendNumber
    inc  ebx
    cmp  ebx, 4
    jb   RegLoop

    call AppendSpace
    mov  eax, zeroFlag             ; ZF
    call AppendNumber
    call AppendSpace
    mov  eax, signFlag             ; SF
    call AppendNumber
    call AppendSpace
    mov  eax, carryFlag            ; CF
    call AppendNumber
    call AppendNewline
    ret
AppendStepLine ENDP

; ---------------------------------------------------------------------
; AppendEndLine
; Purpose:  Write the final "END <TYPE> <value>" line.
; Receives: endType, endValue
; Returns:  nothing
; Changes:  outBuf, outPos
; ---------------------------------------------------------------------
AppendEndLine PROC USES eax esi
    mov  esi, OFFSET txtEnd        ; "END"
    call AppendString
    call AppendSpace

    mov  esi, OFFSET endHalt       ; choose the word for this endType
    cmp  endType, END_HALT
    je   WriteType
    mov  esi, OFFSET endNoHlt
    cmp  endType, END_NOHLT
    je   WriteType
    mov  esi, OFFSET endErrStop
    cmp  endType, END_ERRSTOP
    je   WriteType
    mov  esi, OFFSET endLoop       ; the only one left: END_LOOP
WriteType:
    call AppendString              ; "HALT" / "NOHLT" / "ERRSTOP" / "LOOP"
    call AppendSpace
    mov  eax, endValue
    call AppendNumber
    call AppendNewline
    ret
AppendEndLine ENDP

; ---------------------------------------------------------------------
; WriteResultFile
; Purpose:  Create result.txt and write the whole outBuf into it with a
;           single WriteToFile call.
; Receives: resultFile, outBuf, outPos (= number of bytes to write)
; Returns:  nothing
; Changes:  fileHandle; prints an error message (DEBUG only) on failure
; ---------------------------------------------------------------------
WriteResultFile PROC USES eax ecx edx
    mov  edx, OFFSET resultFile    ; EDX = file name
    call CreateOutputFile          ; EAX = handle (an old result.txt is replaced)
    cmp  eax, INVALID_HANDLE_VALUE
    jne  FileOpened

    mov  eax, DEBUG                ; could not create the file
    cmp  eax, 0
    je   Done
    mov  edx, OFFSET dbgNoWrite
    call WriteString
    call Crlf
    jmp  Done

FileOpened:
    mov  fileHandle, eax
    mov  edx, OFFSET outBuf        ; EDX = what to write
    mov  ecx, outPos               ; ECX = how many bytes
    call WriteToFile               ; (EAX = handle)
    mov  eax, fileHandle
    call CloseFile
Done:
    ret
WriteResultFile ENDP

END main
