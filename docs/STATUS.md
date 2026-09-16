# TT checkpoint — 2026-09-16

**The complete compiler has been implemented and verified locally, but its source
has NOT been committed to main.** This branch is a documentation checkpoint only.
Repository-tool uploads of the bytecode source were blocked with a safety-status
error. Do not claim that cloning this branch produces the compiler yet. A complete
source archive and verification evidence are supplied in the owner's conversation.

The local prototype contains a C++20 lexer/parser, row-polymorphic structural
inference, bounded integer interval refinements, checked higher-order contracts,
closures, arrays, bytecode emission/validation, and a budgeted VM. It is a research
prototype, not production-ready; effects, staging, variants, recursion, nominal
evidence, ownership, modules, incremental compilation, and native/Wasm codegen
remain open milestones.

## Local verification, not CI

The owner explicitly requires the compiler to build and run locally. The complete
snapshot has a dependency-free CMake build and a Python development driver:

    python3 dev.py doctor
    python3 dev.py verify
    python3 dev.py sanitize

These commands need a local GCC/Clang C++20 compiler, CMake, a build tool, and
Python 3.9+. They do not download CI artifacts, call a hosted compiler, or install
packages. CI is optional corroboration, never the sole execution path.

The local Linux x86_64 snapshot passed:

- 57 end-to-end conformance tests, including generated subcases and all examples;
- 191,757 kernel property checks and seven local-workflow tests;
- source-to-bytecode round-trips for all four examples;
- four benchmark workloads at 500/1,000/2,000 items, 11 raw samples per workload;
- a separate Clang 17 ASan/UBSan/leak-checking run, CTest 3/3 passing.

Release verification used GCC 14.2.0, CMake 3.31.6, and Python 3.13.5. No CI
result was substituted for local execution. A GCC optimized vector-copy warning
remains unclassified despite passing sanitizer checks. Generic scalar refinement
transport is conservative; the corrected example uses an explicit checked contract.

## Next iteration

First inspect this branch and establish an approved complete source handoff. Do
not work around upload safety controls, overwrite concurrent changes, or silently
restart a different compiler while claiming continuity. If the previous complete
local workspace is available, use its source/tests/docs and verify locally. If it
is unavailable, report that the source handoff is blocked. Do not invent results.

Once source publication is complete, continue the source snapshot's ordered roadmap
and production-readiness gates. Hourly development is scheduled, but successful
execution depends on local tools and repository access; a schedule is not proof
of progress or a production-readiness guarantee.
