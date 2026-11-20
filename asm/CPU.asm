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

; Name table sizes (Phase 3)
NUM_OPCODES = 10      ; entries in opNames
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
; Number of operands each opcode needs, index = opcode - 1
;                  MOV ADD SUB CMP INC DEC JMP JZ JNZ HLT
opOperandCount BYTE 2,  2,  2,  2,  1,  1,  1,  1, 1,  0

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
dbgParsed    BYTE "PARSED:",0
dbgColon     BYTE ": ",0
dbgEmpty     BYTE "EMPTY",0
dbgErr       BYTE "ERR=",0
dbgOp        BYTE "OP=",0
dbgDst       BYTE " DST=",0
dbgSrcType   BYTE " SRCTYPE=",0
dbgSrc       BYTE " SRC=",0

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
    call ParseAllLines             ; check every line, fill instruction arrays
SkipParse:

    call DebugPrintLines           ; show what we read (only if DEBUG = 1)
    call DebugPrintParsed          ; show what the parser found (only if DEBUG = 1)

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

; =====================================================================
; PHASE 3 - PARSER
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
; Returns:  EAX = opcode number 1..10, or 0 if the word is not an opcode
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
; Purpose:  Check the operand of JMP/JZ/JNZ: a number from 1 to lineCount.
; Receives: ESI = address of the operand word, lineCount
; Returns:  Carry = 0: EAX = target line number
;           Carry = 1: EAX = error code (5 not a number, 6 out of range)
; Changes:  nothing else
; ---------------------------------------------------------------------
ParseJumpTarget PROC
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
;           operand 1 (8/2, or 5/6 for jumps) -> operand 2 (5/2) -> extra (4).
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
    mov  lineErr[ebx], 0

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
    cmp  ecx, OP_JMP               ; JMP, JZ, JNZ (7..9) take a line number
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

JumpOperand:                       ; ---- 3. operand 1 of a jump: target line ----
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

END main
