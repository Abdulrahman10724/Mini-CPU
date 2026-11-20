; =====================================================================
; Mini CPU Simulator - COAL Lab Project (BDS-3A, Group 07)
;
; CPU.exe reads program.txt, checks every line for errors, runs the
; program on four virtual registers (AX, BX, CX, DX) with a program
; counter and a Zero Flag, and writes result.txt (format: CONTRACT.md).
;
; Phase 2: constants, full data section, reading program.txt and
;          splitting it into uppercase lines (with DEBUG output).
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
instDst      BYTE  MAX_LINES DUP(0)        ; destination register index 0..3
instSrcType  BYTE  MAX_LINES DUP(0)        ; 0=none, 1=register, 2=number
instSrc      SDWORD MAX_LINES DUP(0)       ; register index, number, or jump target line
lineErr      BYTE  MAX_LINES+2 DUP(0)      ; error code per line, 0 = OK
                                           ; (index 50 = line 51, used for error 7)

; ---------------------------------------------------------------------
; Name tables (Phase 3)
; ---------------------------------------------------------------------
; Each opcode name sits in a fixed 4-byte slot (padded with 0),
; so slot index + 1 = opcode number (MOV = 1 ... HLT = 10).
opNames      BYTE "MOV",0, "ADD",0, "SUB",0, "CMP",0, "INC",0
             BYTE "DEC",0, "JMP",0, "JZ",0,0, "JNZ",0, "HLT",0
; Each register name sits in a fixed 3-byte slot: slot index = register index.
regNames     BYTE "AX",0, "BX",0, "CX",0, "DX",0

; ---------------------------------------------------------------------
; Virtual CPU state (Phase 4) - plain memory, NOT the real CPU registers
; ---------------------------------------------------------------------
regs         SDWORD 4 DUP(0)               ; virtual AX, BX, CX, DX
zeroFlag     DWORD 0                       ; virtual ZF (0 or 1)
pc           DWORD 1                       ; virtual program counter = current line number (1-based)
stepCount    DWORD 0                       ; instructions executed so far

; ---------------------------------------------------------------------
; Output (Phase 5)
; ---------------------------------------------------------------------
outBuf       BYTE OUT_SIZE DUP(0)          ; the whole result.txt is built here
outPos       DWORD 0                       ; next free position in outBuf
numBuf       BYTE 16 DUP(0)                ; work buffer for IntToStr

; ---------------------------------------------------------------------
; Debug strings
; ---------------------------------------------------------------------
dbgMissing   BYTE "FILE MISSING",0
dbgBytes     BYTE "BYTES: ",0
dbgLines     BYTE "LINES: ",0
dbgTooMany   BYTE "TOO MANY LINES",0
dbgOpen      BYTE ": [",0                  ; printed between line number and line text
dbgClose     BYTE "]",0                    ; printed after the line text

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
    je   SkipSplit                 ; no -> nothing to split
    call SplitLines                ; yes -> cut fileBuf into lines
SkipSplit:

    call DebugPrintLines           ; show what we read (only if DEBUG = 1)

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

END main
