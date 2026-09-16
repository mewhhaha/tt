#!/usr/bin/env python3
"""Offline local build, test, and benchmark entry point (Python 3.9+).

No package installation, CI artifact downloads, containers, or credentials.
All paths are anchored at this file, so it can be invoked from any directory.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    print("+ " + shlex.join(command), flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def require(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(
            f"Required local tool {name!r} was not found. Install the toolchain "
            "described in docs/LOCAL_DEVELOPMENT.md; no CI fallback is used."
        )
    return path


def compiler_for(args: argparse.Namespace) -> str:
    selected = args.compiler or os.environ.get("CXX")
    if selected:
        return require(selected)
    if args.command == "sanitize" and shutil.which("clang++"):
        return require("clang++")
    return require("c++")


def doctor(args: argparse.Namespace) -> str:
    if os.name != "posix":
        raise RuntimeError("This prototype needs a POSIX host; use Linux, macOS, or WSL.")
    compiler = compiler_for(args)
    for path in [require("cmake"), require("ctest"), compiler]:
        result = subprocess.run(
            [path, "--version"], check=True, text=True, capture_output=True
        )
        print(result.stdout.splitlines()[0])
    print(f"Python {sys.version.split()[0]} ({sys.executable})")
    print("Local prerequisites found. CMake checks language/toolchain compatibility.")
    return compiler


def build(args: argparse.Namespace) -> Path:
    compiler = doctor(args)
    sanitize = args.command == "sanitize"
    directory = args.build_dir or Path("build-sanitize" if sanitize else "build")
    directory = (ROOT / directory).resolve()
    run([
        require("cmake"), "-S", str(ROOT), "-B", str(directory),
        "-DCMAKE_BUILD_TYPE=" + ("Debug" if sanitize else "Release"),
        "-DCMAKE_CXX_COMPILER=" + compiler,
        "-DBUILD_TESTING=ON", "-DTT_BUILD_BENCHMARKS=ON",
        "-DTT_SANITIZE=" + ("ON" if sanitize else "OFF"),
        "-DPython3_EXECUTABLE=" + sys.executable,
    ])
    targets = ["tt", "tt-kernel"] if sanitize else ["tt", "tt-kernel", "tt-bench"]
    run([require("cmake"), "--build", str(directory), "--parallel", str(args.jobs),
         "--target", *targets])
    return directory


def tests(directory: Path, *, sanitize: bool = False) -> None:
    env = os.environ.copy()
    if sanitize:
        env["ASAN_OPTIONS"] = "detect_leaks=1:halt_on_error=1"
        env["UBSAN_OPTIONS"] = "halt_on_error=1:print_stacktrace=1"
    run([require("ctest"), "--test-dir", str(directory), "--output-on-failure"], env=env)


def roundtrips(directory: Path) -> None:
    binary = directory / "tt"
    with tempfile.TemporaryDirectory(prefix="tt-local-") as temporary:
        for source in sorted((ROOT / "examples").glob("*.tt")):
            artifact = Path(temporary) / (source.stem + ".ttbc")
            checked = subprocess.run([str(binary), "check", str(source)],
                                     check=True, capture_output=True, text=True)
            direct = subprocess.run([str(binary), "run", str(source)],
                                    check=True, capture_output=True, text=True)
            run([str(binary), "build", str(source), "-o", str(artifact)])
            restored = subprocess.run([str(binary), "exec", str(artifact)],
                                      check=True, capture_output=True, text=True)
            if direct.stdout != restored.stdout:
                raise RuntimeError(f"Source/artifact output mismatch for {source.name}")
            print(f"{source.name}: {checked.stdout.strip()} => {direct.stdout.strip()}")


def benchmarks(directory: Path, args: argparse.Namespace) -> None:
    output = args.output or directory / "benchmark-local.json"
    output = (ROOT / output).resolve()
    run([sys.executable, str(ROOT / "benchmarks/run.py"), "--binary",
         str(directory / "tt-bench"), "--output", str(output),
         "--samples", str(args.samples), "--sizes", *map(str, args.sizes)])
    print(f"Benchmark evidence: {output}")


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["doctor", "build", "test", "verify", "sanitize", "bench"])
    parser.add_argument("--compiler", help="Local compiler executable (default: CXX or c++; sanitize prefers clang++)")
    parser.add_argument("--build-dir", type=Path, help="Build directory, relative to repository root or absolute")
    parser.add_argument("--jobs", type=int, default=min(2, os.cpu_count() or 1))
    parser.add_argument("--samples", type=int, default=11)
    parser.add_argument("--sizes", type=int, nargs="+", default=[500, 1000, 2000])
    parser.add_argument("--output", type=Path, help="Benchmark JSON path")
    result = parser.parse_args(argv)
    if result.jobs < 1 or result.samples < 3 or any(n < 1 or n > 10000 for n in result.sizes):
        parser.error("jobs must be positive, samples >= 3, and sizes between 1 and 10000")
    return result


def main(argv: list[str] | None = None) -> int:
    args = arguments(argv)
    try:
        if args.command == "doctor":
            doctor(args)
            return 0
        directory = build(args)
        if args.command in ["test", "verify", "sanitize"]:
            tests(directory, sanitize=args.command == "sanitize")
        if args.command == "verify":
            roundtrips(directory)
        if args.command in ["verify", "bench"]:
            benchmarks(directory, args)
        print("Local " + args.command + " completed successfully.")
        return 0
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Local development failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
