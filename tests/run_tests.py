"""
Test runner for the Mini CPU Simulator.

For every tests/<name>.expected.txt:
  1. copy tests/<name>.txt to program.txt in a scratch folder
     (if <name>.txt does not exist, program.txt is deleted -> tests error 9)
  2. run CPU.exe in that folder
  3. compare the produced result.txt with <name>.expected.txt

Usage (from the project folder, on Windows):
  python tests/run_tests.py                      # look for CPU.exe automatically
  python tests/run_tests.py --exe path/to/CPU.exe
  python tests/run_tests.py 05_jnz_loop_sum      # run only tests whose name contains this
"""

import argparse
import difflib
import os
import shutil
import subprocess
import sys

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(TESTS_DIR)
WORK_DIR = os.path.join(TESTS_DIR, "_work")   # scratch folder, safe to delete

# Places where Visual Studio usually puts the built exe.
EXE_CANDIDATES = [
    "CPU.exe",
    os.path.join("asm", "CPU.exe"),
    os.path.join("asm", "Debug", "CPU.exe"),
    os.path.join("asm", "Release", "CPU.exe"),
    os.path.join("Debug", "CPU.exe"),
    os.path.join("Release", "CPU.exe"),
]


def find_exe(user_path):
    """Return the CPU.exe path to use, or None if not found."""
    if user_path:
        return os.path.abspath(user_path) if os.path.isfile(user_path) else None
    for rel in EXE_CANDIDATES:
        path = os.path.join(ROOT_DIR, rel)
        if os.path.isfile(path):
            return path
    return None


def read_lines(path):
    """Read a text file as a list of lines, ignoring CRLF/LF and trailing blank lines."""
    with open(path, "r", newline="") as f:
        lines = f.read().replace("\r\n", "\n").split("\n")
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def run_one(exe, name):
    """Run a single test. Returns (passed, message)."""
    program_src = os.path.join(TESTS_DIR, name + ".txt")
    expected_path = os.path.join(TESTS_DIR, name + ".expected.txt")
    program_dst = os.path.join(WORK_DIR, "program.txt")
    result_path = os.path.join(WORK_DIR, "result.txt")

    # Remove old files so a stale result.txt can never make a test pass.
    for path in (program_dst, result_path):
        if os.path.exists(path):
            os.remove(path)
    if os.path.exists(program_src):
        shutil.copyfile(program_src, program_dst)   # byte-exact copy (keeps CRLF)

    try:
        subprocess.run([exe], cwd=WORK_DIR, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=10)
    except subprocess.TimeoutExpired:
        return False, "CPU.exe did not finish within 10 seconds (waiting for a key press?)"

    if not os.path.exists(result_path):
        return False, "CPU.exe did not create result.txt"

    expected = read_lines(expected_path)
    actual = read_lines(result_path)
    if expected == actual:
        return True, ""
    diff = difflib.unified_diff(expected, actual, "expected", "actual", lineterm="", n=2)
    return False, "\n".join(diff)


def main():
    parser = argparse.ArgumentParser(description="Run Mini CPU tests")
    parser.add_argument("--exe", help="path to CPU.exe")
    parser.add_argument("filter", nargs="?", default="", help="only run tests containing this text")
    args = parser.parse_args()

    exe = find_exe(args.exe)
    if exe is None:
        print("CPU.exe not found. Build it first, or pass --exe path\\to\\CPU.exe")
        return 2

    names = sorted(f[:-len(".expected.txt")] for f in os.listdir(TESTS_DIR)
                   if f.endswith(".expected.txt"))
    names = [n for n in names if args.filter in n]

    os.makedirs(WORK_DIR, exist_ok=True)
    print("Using", exe)
    passed = 0
    for name in names:
        ok, msg = run_one(exe, name)
        print(("PASS  " if ok else "FAIL  ") + name)
        if ok:
            passed += 1
        else:
            print("      " + msg.replace("\n", "\n      "))
    print(f"\n{passed}/{len(names)} passed")
    return 0 if passed == len(names) else 1


if __name__ == "__main__":
    sys.exit(main())
