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

## 2026-09-16 — Node.js compiler migration

Owner request: develop the compiler in Node and push it to main. Read the live
22e0272 documentation-only checkpoint and the complete prior source archive before
porting. Preserve the existing semantics and production gates, not the C++ build.

Implemented dependency-free JavaScript ES modules for lexer/parser, type arena and
row unification, separate refinement checking, closure conversion, TTBC v1
serialization/validation, VM, CLI, Node test runner and local benchmark/verify tools.
BigInt retains exact i64 arithmetic. UTF-8 decoding is strict; record/binding names
use Maps. No Node eval, code-generation-to-JavaScript, native addon, package download
or hosted compiler is used.

Local commands and observed results:

- `node src/cli.mjs run examples/{refinements,records,branch_proofs,higher_order}.tt`
  (individual calls): 42, the expected record array, [0,0,42], and 12.
- `python3 <archived>/tests/test_cli.py <node-launcher>`: 57/57 original tests passed
  in 32.390 seconds, including artifact and generated subcases. The launcher merely
  invokes the Node CLI. Neither Python nor the archived files is required by TT.
- `node --test tests/*.test.mjs`: 91/91 passed, including 191,757 kernel assertions.
- `node benchmarks/run.mjs --samples 11 --output benchmarks/node-initial.json`:
  all bounded-work gates passed at 500/1,000/2,000 items; raw measurements retained.

The migration preserves the conservative loss of scalar refinements across some
unannotated generic functions; it does not erase callable requirements to accept
more programs. Native sanitizers were not run on JavaScript and are not claimed.
Remaining work: sustained robustness testing, compact refinement transport,
variants/recursion, nominal evidence, effects/staging, and the systems-only ECS.
See STATUS.md and the production gates for the unimplemented scope.

- `npm run verify`: passed locally (91 tests, four examples, README, 11-sample
  benchmark gates and standalone execution). See evidence/local-verify.log.
- Repository publication: the normal GitHub create_tree request containing the
  JavaScript core and bytecode implementation was blocked with “we couldn't
  determine the safety status of the request”. No commit or ref update succeeded;
  no Node commit was pushed. Do not bypass upload controls or report this archive
  as a pushed commit. A source archive and ordinary git patch are supplied.

Concurrent handoff: a final branch read found that the scheduled C++ handoff landed
as `1df210834b35a6169b441743b6e0ed425616099a` while this migration was running.
That commit is not the Node port. The Node patch is now based on that commit's
exact versions of the modified paths, preserves the newly landed native sources,
benchmarks and iteration history, and selects Node as the active workflow.
The Node-only source archive does not require or include the reference C++ files.
Repository publication of the Node port is still blocked; no alternate write path
was used to bypass the safety-status error.

## 2026-09-16 — Wasm-only target, Node compiler retained

Owner correction: output must be WebAssembly only. Implemented a direct binary
Wasm emitter, uniform explicit closure ABI, in-module arithmetic/collection/text
helpers, a capped linear-memory allocator and fuel/call/value guards. There are no
imports or embedded TT interpreter. Node hosts compilation and Wasm loading only.
Removed active src/bytecode.mjs and src/vm.mjs; replaced saved TTBC commands with
.wasm and documented the intentionally provisional public ABI and trust boundary.

Local Node 22.16.0 verification: 100/100 tests; 191,751 structural/refinement kernel
assertions; 2,020 i64 differential cases; four example round-trips; README program;
standalone standard-engine execution. Full command `node scripts/verify.mjs` passed,
including compile work/size gates (500/1000/2000, 11 samples) and a separate Wasm
engine-stage map/fold measurement (1000 elements, 11 samples, 100 calls/sample).
See evidence/local-verify.log and the wasm-initial / wasm-runtime-initial JSON files.
Six obsolete VM kernel checks were replaced, not relabeled as Wasm tests.

One migration-test issue was found and repaired: the atomic-write test targeted a
directory without .wasm, so the new extension guard rejected it before the intended
rename failure. The directory fixture now uses .wasm and still checks preservation
and cleanup; the compiler was not weakened to satisfy the old test shape.

The preliminary full-size samples show emission is a material cost; no overall
speedup claim is made. Boxed runtime representation and all-helper inclusion are
explicit simple baselines, not optimized or production-ready choices.

Publication: GitHub tree staging accepted Wasm-only files, then blocked submission
of shared core/parser source with a safety-status error. No commit/ref update was
performed. Complete source and a base-checked migration patch are supplied to the
owner; no alternate transport was used to bypass repository write controls.


## 2026-09-16 — compositional generic refinement evidence

Hypothesis: useful duck-typed refinement precision can survive ordinary generic
helpers without rechecking their bodies or introducing a general theorem prover.
Implemented a bounded evidence-template layer in the separate refinement pass.
Unannotated parameters carry refinement-polymorphic wildcard evidence; templates
can reference parameters, structural projections, records/arrays and symbolic
applications. Calls substitute into those templates only. When higher-order
substitution reveals a concrete callback precondition on a still-symbolic argument,
the obligation is retained and strengthens the returned function domain rather
than being erased. Incomparable dependent requirements still fail closed.

Added regressions for scalar identity, duck-typed field projection, record
packaging/unpacking, higher-order apply/compose, valid and invalid positive-only
callbacks, attempted broadening to `Int -> Int`, and a 200-wrapper work bound.
Added `refinement_relations` to the scaling benchmark and a dedicated
`refinement_substitutions` metric. General symbolic arithmetic such as publishing
an affine `x + 1` relation remains intentionally unsupported.

## 2026-09-16 — demand-driven Wasm runtime linking

Hypothesis: the direct Wasm backend can reduce fixed artifact overhead without
changing source checking or runtime semantics by making helper reachability explicit.
Previously every module declared every arithmetic, collection, text and currying
helper plus static closures for all six natives, even when the source never referred
to them.

Implemented a finite helper dependency graph in `wasm-runtime.mjs`. The emitter scans
already-bound AST nodes for source operations and referenced builtin binder identities,
seeds required exported runtime services, closes the helper graph transitively, and
predeclares/emits only that set. Native closures are now materialized only when their
binder occurs in the checked program. Curried native entries depend explicitly on the
next closure target (`map1 -> map2`, `fold1 -> fold2 -> fold3`, etc.), so returning a
native remains valid even when there is no immediate source `Call`. This is linker
work only: it neither rechecks bodies nor changes the type/refinement judgments.

Local Node 22.16.0 / Linux verification in this iteration:

- Pre-change `npm test`: 101/101 passed.
- Pre-change `npm run bench -- --sizes 500,1000,2000 --samples 11` passed. The
  compact committed `benchmarks/helper-linking-1000.json` retains all eleven raw
  n=1,000 samples and matched work/artifact metrics; the full raw run stayed local.
- Focused demanded-helper regression covers tiny programs, arithmetic, every native
  family and a returned-but-not-called `map` closure.
- Post-change `npm test`: 102/102 passed, including the unchanged 191,751 kernel
  assertions and all generated/adversarial Wasm cases.
- `npm run verify`: passed all tests, four examples, README execution, standalone
  artifact execution, compile work gates and runtime engine-stage checks.
- Post-change `npm run bench -- --sizes 500,1000,2000 --samples 11`: passed. The
  same `benchmarks/helper-linking-1000.json` records all eleven raw n=1,000 samples
  and focused before/after data; the full raw run stayed local.
- `npm run bench:runtime`: passed checksum 500500 at 1,000 items, 11 samples and
  100 calls/sample; evidence is `benchmarks/helper-linking-runtime.json`.

Deterministic size/work result: `return 1` changes from 41 functions / 2,275 bytes /
184 static bytes to 7 functions / 573 bytes / 88 static bytes. At n=1,000 the normal
scaling workloads remove 26-29 Wasm functions and 1,296-1,457 bytes. The wrapper
workload still has one generated source function per wrapper; helper linking does not
pretend to solve that separate source-code growth. Compiler timing medians moved both
up and down across the samples, so no latency speedup is claimed. Runtime measurements
are warm-process V8 observations and likewise are not used as a speedup claim.

Remaining backend work includes static constant liveness, compact/unboxed layouts,
allocator/ABI auditing, source-mapped traps, ownership/GC and a broader engine matrix.
