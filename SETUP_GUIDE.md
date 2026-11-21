# Mini-CPU Simulator: Setup Guide

## 1. Requirements
- Windows 10/11
- Visual Studio 2019/2022 with MASM + **Irvine32** already set up (as in COAL lab).
  If Irvine32 isn't installed yet, install it first.
- Python **3.10 – 3.12**
- Git

## 2. Clone
```bat
git clone https://github.com/Abdulrahman10724/mini-cpu.git
cd mini-cpu
```

## 3. Build the CPU engine
1. Open your Irvine32 project in Visual Studio and add `asm\CPU.asm` to it
   (in place of the old `.asm` file).
2. Select **Debug** + **x86**, then **Build → Build Solution**.
3. Copy the built `.exe` to `asm\CPU.exe` in the repo, so the tests and GUI find it
   automatically:
   ```bat
   copy "C:\path\to\Debug\Project.exe" asm\CPU.exe
   ```
> After every `git pull` that changes `CPU.asm`: rebuild and copy again.

## 4. Install Python package
```bat
python -m pip install pywebview
```
If it times out:
```bat
python -m pip install --upgrade pip setuptools wheel --timeout 120 --retries 10
python -m pip install proxy_tools --no-build-isolation --timeout 120 --retries 10
python -m pip install pywebview --timeout 120 --retries 10
```

## 5. Run the tests
```bat
python tests\run_tests.py
```
All tests should print `PASS`.
(Exe somewhere else? Add `--exe "C:\path\to\Project.exe"`.)

## 6. Run the app
```bat
python gui\app.py
```
(Exe somewhere else? Add `--exe "C:\path\to\Project.exe"`.)

## Commands at a glance
| Task | Command |
|---|---|
| Install dependency | `python -m pip install pywebview` |
| Run engine tests | `python tests\run_tests.py` |
| Run GUI tests | `python gui\tests\test_result_parser.py` and `python gui\tests\test_analysis_stats.py` |
| Start the app | `python gui\app.py` |
| Start with a specific exe | `python gui\app.py --exe "C:\path\to\Project.exe"` |
| Start with dev tools (debugging) | `python gui\app.py --debug` |
| GUI without Windows/MASM (dev only) | `python gui\app.py --mock` |

## Common problems
| Problem | Fix |
|---|---|
| `python` not recognised | Reinstall Python with "Add to PATH", or use `py` instead of `python` |
| pywebview / pythonnet install error | Use Python 3.12 |
| App window is blank | Install Microsoft Edge WebView2 Runtime |
| "Engine not found" | Copy the exe to `asm\CPU.exe`, or use `--exe` |
| Tests fail after `git pull` | Rebuild `CPU.asm` and copy the exe again |