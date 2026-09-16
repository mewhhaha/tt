# Local development: no CI dependency

The compiler is built, executed, tested, and benchmarked on the developer's own
machine. GitHub is a source/history host, not an execution prerequisite. After
obtaining the source and installing a toolchain, no network, credentials, CI
artifact, container, package manager, or hosted compiler is required.

The current implementation is dependency-free C++20. It was executed on Linux
x86_64 using GCC 14.2.0 and Clang 17.0.0. Its source requires a POSIX host and the
GCC/Clang `__int128` extension. macOS is not yet qualified; Windows should use a
Linux environment such as WSL, not a claimed native Windows port.

## Prerequisites

Install a GCC or Clang C++20 compiler, CMake 3.20+, a Make/Ninja build tool, and
Python 3.9+. These are local development tools, not language dependencies. The
driver reports missing tools and exits nonzero; it does not fetch replacements.
`CXX` or `--compiler` must name a compiler executable, not a shell command with flags.

```sh
python3 dev.py doctor
python3 dev.py verify
```

`verify` configures a Release build, builds the compiler/test/benchmark binaries,
runs the complete CTest suite, checks and runs every example both from source and
from a saved bytecode artifact, and runs benchmark work-regression gates. It stops
on the first failing command. JSON measurements go to `build/benchmark-local.json`.
The driver can be invoked from any working directory; relative build/output paths
are anchored at the repository root.

```sh
python3 dev.py verify --build-dir build-clean --compiler clang++ --jobs 2
python3 dev.py test
python3 dev.py bench --sizes 500 1000 2000 --samples 11
python3 dev.py sanitize
```

`sanitize` uses a separate Debug build with ASan and UBSan (Clang preferred).
It executes the same conformance and kernel tests locally. It does not measure
sanitized code as the Release performance baseline. Do not hide sanitizer failures
by automatically retrying without instrumentation.

## Run the compiler

```sh
./build/tt check examples/refinements.tt --metrics
./build/tt run examples/records.tt
./build/tt build examples/records.tt -o /tmp/records.ttbc
./build/tt exec /tmp/records.ttbc
```

`check` parses, infers structure, and verifies refinements without bytecode emission.
`run` performs those checks, compiles, and executes locally. `build` emits a TTBC
artifact without executing the program; `exec` validates and executes that artifact.
This initial backend is bytecode, not native code or Wasm. The VM is not yet an
audited hostile-input sandbox.

## Direct commands and minimal installation

The driver is optional; it is only a wrapper around the normal build tools:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
ctest --test-dir build --output-on-failure
python3 benchmarks/run.py --binary build/tt-bench --output build/benchmark-local.json
cmake --install build --prefix "$HOME/.local"
```

Building just the compiler needs no Python:

```sh
cmake -S . -B build-minimal -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TESTING=OFF -DTT_BUILD_BENCHMARKS=OFF
cmake --build build-minimal --parallel 2
./build-minimal/tt run examples/records.tt
```

## Iteration policy

Each hourly iteration must use the available local execution environment to run
its changes. Record commands, toolchain, actual results, and limits. A future CI
workflow may repeat these commands; it is never the only way to run the compiler
and is not a substitute for a reported local test. If a scheduled environment lacks
a local toolchain, report that limitation instead of claiming execution occurred.

Compiler construction time (building the C++ project) and TT source compilation
time (running `tt check`/`tt build`) are separate measurements. The prototype's
header-heavy C++ organization can make rebuilding the compiler itself relatively
expensive; the benchmark measures the latter boundary and does not conceal this
as a faster C++ build.
