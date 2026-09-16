# Iteration log

## 2026-09-16 — initial executable slice and local-first development

Started from empty mewhhaha/tt. Inspected Blot's syntax guide. Implemented a
self-contained C++20 lexer/parser, row-polymorphic shape checker, separate bounded
integer-refinement analysis, closure conversion, bytecode artifact path, and VM.
The choice of C++ makes execution possible with this environment's existing GCC
and Clang; Rust was unavailable. No language-design conclusion depends on C++.

Added positive/negative tests for polymorphism, row access, closure captures,
checked contracts, higher-order precondition erasure, branch facts, arithmetic
traps, malformed artifacts, concurrent output writes, resource limits, and generated
arithmetic/refinement cases. Added 191,757 kernel assertions over interval algebra,
row constraints, bytecode validation, runtime errors, and fuel exhaustion.

Performance experiment: avoid traversing monomorphic record schemes at every use
and project known fields directly rather than unifying another whole row. Current
wide-record work counters retain 32 type nodes and zero instantiation visits for
500/1,000/2,000 fields. Record raw observations, not an uncontrolled speedup claim.

User explicitly required local execution rather than CI. Added `dev.py doctor`,
`build`, `test`, `verify`, `bench`, and `sanitize`; CMake can also build only the
compiler without Python. The driver invokes no installer, network request, or CI
artifact downloader. Updated the hourly task to require real local execution.

Local verification exposed a false documentation assumption about scalar evidence
through an unannotated generic getter. Changed the example to an explicit checked
record/function contract, documented the limitation, and added all examples plus
the README program to the test suite. No checker rule was weakened to pass it.

Final commands and outcomes:

- `python3 dev.py verify --build-dir build-local --samples 11`: success; 57
  conformance tests, seven driver tests, kernel assertions, four example round-trips,
  and four benchmark workloads at three sizes. CTest 3/3.
- `python3 dev.py sanitize`: success; CTest 3/3, Clang ASan/UBSan/leak checking.
- `./build-local/tt-kernel`: 191757 kernel property checks passed.

A fresh GCC build exceeded one tool invocation's execution timeout, then completed
when resumed. That interruption is distinct from a test failure. A GCC vector-copy
warning remains to investigate. No CI workflow was needed or used.

Repository publication is incomplete: bootstrap commit
`81e757d3aa2740ba3e7e0bf274f4cc73462ae979` landed, but full source upload was blocked
by the repository tool while submitting bytecode source. The supplied local source
archive is the completed implementation. Do not report the compiler as present on
main until the actual branch contains and verifies it.

A documentation-only checkpoint was subsequently committed to main as
`22e0272779a22ee647c47f69aed855adfcc26648`, recording the real local results and
the blocked source publication. That commit does not contain the compiler.

## 2026-09-16 — source handoff re-verification

Re-read live `main` before publication. It was still the documentation-only
checkpoint `22e0272779a22ee647c47f69aed855adfcc26648`; the complete local workspace
from the initial implementation was still available. No concurrent branch change
needed merging.

Re-verified the unmodified compiler locally before attempting handoff:

- `python3 dev.py verify --build-dir build-auto --samples 7`: the first tool call
  reached its wall-clock limit while compiling `tt-bench`; resuming that target and
  rerunning the complete command succeeded. CTest was 3/3, all four source/artifact
  example round-trips passed, and benchmark work gates passed at 500/1,000/2,000.
- `python3 dev.py sanitize --build-dir build-auto-sanitize`: configuration and
  compiler/kernel builds succeeded, but that combined tool call reached its
  wall-clock limit when CTest began. Running the same sanitizer environment's CTest
  afterward completed successfully: 3/3 in 20.37 seconds with ASan, UBSan, and leak
  checking enabled.

The existing GCC `-Warray-bounds` warning in optimized standard-library vector-copy
code reproduced while building the kernel test; no sanitizer failure accompanied it.
This remains an open qualification item rather than being relabeled as harmless.

The handoff is intentionally one fast-forward tree/commit update based on the live
checkpoint, rather than per-file commits. This preserves the current branch and
avoids claiming a partially uploaded compiler.
