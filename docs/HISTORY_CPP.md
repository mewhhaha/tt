# Historical C++ checkpoint at 1df2108

The following is the original status at commit
`1df210834b35a6169b441743b6e0ed425616099a`. It is historical evidence,
not the active Node workflow or verification of the Node implementation.

# TT status — 2026-09-16

**Research prototype. Not production-ready.** This complete local source snapshot
builds and executes without CI, network access, downloaded artifacts, or language
dependencies after installing the documented C++/CMake/Python toolchain.

## Implemented and exercised locally

Blot-inspired `let`, `fn`, records, field access, application, semicolon blocks,
conditionals, arrays, and type aliases. Level-based let polymorphism and structural
row inference. Integer interval-set refinements, checked pre/postconditions,
contravariant higher-order contract checks, direct branch facts, lexical closures,
bytecode emission/validation/serialization, and a budgeted VM with checked arithmetic.
See `DESIGN.md` and `SYNTAX.md` for the exact fragment; the project name does not
imply an implemented arbitrary predicate logic or full Blot compatibility.

## Local evidence

`python3 dev.py verify --build-dir build-local --samples 11` completed successfully:
57 end-to-end conformance tests (with additional generated subcases), 191,757 kernel
property checks, seven local-driver tests, all four example source/artifact
round-trips, and benchmark work gates at sizes 500/1,000/2,000 with 11 samples each.
The implementation was compiled locally with GCC 14.2.0, CMake 3.31.6, and
Python 3.13.5 on Linux x86_64. The final CTest aggregate was 3/3 passing.

`python3 dev.py sanitize` also completed successfully with Clang 17.0.0, ASan,
UBSan, and leak checking: 3/3 CTest suites passed. No CI result was used as evidence
for either run. Raw performance data is in `benchmarks/initial.json`. A fresh automation-run
verification also completed locally from this source tree on 2026-09-16 using
`python3 dev.py verify --build-dir build-auto --samples 7`; the initial build step
exceeded the tool-call wall-clock limit while compiling `tt-bench`, then the resumed
build and complete verify passed. A fresh Clang 17 ASan/UBSan/leak-checking CTest
run in `build-auto-sanitize` was 3/3 passing. No CI result was used.

The clean local workflow found an example that incorrectly assumed an unannotated
generic getter preserved scalar bounds. The example now uses an explicit checked
contract; the README and all examples are executable regressions. Preserving these
bounds through generic abstractions remains planned work, not a hidden success.

GCC emits an array-bounds warning in optimized standard-library vector-copy code
in the property test. Sanitizers did not report an error in that test, but the
warning has not been independently reduced/classified; warning-free qualification
is not claimed. Mac/Windows-native portability is not qualified.

## Not implemented

Algebraic effects/handlers, first-class compile-time type values, general const
execution, static parameters, declaration tags, nominal evidence, variants,
recursion, modules, ownership, incremental compilation, and native/Wasm codegen.
Higher-order refinement abstraction is deliberately conservative. Runtime indexing
is checked but may trap. The bytecode validator is not a typing certificate or
an audited sandbox. All production gates remain open.

## Publication state

The documentation-only checkpoint `22e0272779a22ee647c47f69aed855adfcc26648`
was the last branch state before source handoff. This snapshot is the complete
compiler source intended for the atomic handoff commit based on that checkpoint.
Once this file is present together with `src/`, `tests/`, `examples/`, `dev.py`,
and `CMakeLists.txt` on `main`, cloning the repository is sufficient to build and
run the compiler locally; no conversation attachment is required.

## Next work

After the complete source handoff, add adversarial higher-order and row tests,
improve maintainability, and test
compact refinement relationships through generic functions without body rechecking.
Continue the ordered roadmap; effects/staging and the ECS vertical slice remain
required research milestones. Local execution is mandatory, CI only corroborative.
