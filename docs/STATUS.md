# TT status — Node compiler, WebAssembly-only output — 2026-09-17

**Research prototype, not production-ready.** The compiler and all supported tools
are dependency-free JavaScript ES modules running locally under Node 22+. The sole
executable target is standard Core WebAssembly. There is no supported C++/Python
implementation, TT bytecode VM, JavaScript executable output, native target, hosted
checker, or required CI artifact.

## Implemented and preserved

The structural/refinement frontend provides let polymorphism, open record
requirements, closures and higher-order functions, arrays/map/fold, strict
records/conditionals, UTF-8 Text, full signed-i64 arithmetic, interval-set contracts,
checked callable pre/postconditions, contravariant input requirements and scoped
branch facts. Compact symbolic evidence transports direct parameter, projection,
record and higher-order application relationships without call-site body rechecking.

The backend lowers checked syntax directly to Wasm functions, structured branches,
an indirect-call table and explicit closure environments. Runtime helpers for checked
arithmetic, arrays, field access, text and currying are emitted in Wasm and linked
from an explicit dependency graph. Artifacts have zero host imports. The JavaScript
loader validates/instantiates modules and decodes results but does not evaluate TT.

`check` runs the frontend only. `compile(source).wasm` and CLI `build` emit `.wasm`;
`run` compiles then executes Wasm. `exec` accepts the versioned TT Wasm ABI and
refuses legacy TTBC. See `docs/WASM.md`.

## Verification evidence

The most recent exact compiler/backend verification before the repository-policy
cleanup ran on Node 22.16.0, V8 12.4.254.21-node.26, Linux x86_64. It passed 102
Node tests, including all 75 captured source fixtures, 191,751 structural/refinement
kernel assertions, 2,020 boundary/generated i64 arithmetic cases, generated malformed
source/artifact cases, all examples/README execution, standalone saved-Wasm execution,
compile work gates at 500/1,000/2,000 items, and a separate 1,000-element Wasm
map/fold engine-stage benchmark. No CI artifact, native compiler, Python, or package
installation was used.

Demand-driven runtime linking reduced a literal-only artifact from 41 Wasm functions /
2,275 bytes to 7 functions / 573 bytes, and removed 26-29 runtime functions plus
1,296-1,457 bytes across the matched 1,000-item compiler workloads. Timing samples
moved in both directions; no compile-speed claim is made.

This repository-cleanup iteration changed no compiler, checker, Wasm emitter, runtime
helper, ABI, or benchmark implementation. It removed the 13 legacy C++/Python/CMake
implementation files and added a Node-only repository-policy guard. The policy change
was exercised locally against the recovered Node/Wasm source handoff on Node 22.16.0:

- `npm test`: 103/103 passed after adding three repository-policy tests; the recovered
  handoff has two fewer demanded-runtime-linking tests than current main, so this
  count is not presented as an exact post-commit main aggregate.
- `npm run verify`: passed the same 103 tests, four example source/Wasm round-trips,
  README execution, standalone execution, 500/1,000/2,000 compile work gates, and
  the 1,000-element map/fold engine-stage check.
- The policy tests accept a Node/Wasm tree, reject nested `.cpp`/`.hpp`/`.py` and
  `CMakeLists.txt` implementation files, and ignore generated `node_modules` content.

The active verification script now runs that repository policy before syntax checks,
tests, examples, benchmarks or standalone execution. Future reintroduction of the
removed implementation families therefore fails the supported local verification
path immediately.

### ABI integrity hardening

The provisional artifact ABI is version 2. The prior format hashed the Wasm core but
left host-visible metadata (including record-label strings and the static heap boundary)
outside that digest. Structurally valid custom-section corruption could therefore
change decoded metadata without triggering the core hash. ABI 2 retains the core
digest and adds a deterministic SHA-256 over the canonical metadata fields; the
loader also requires the exact field set, unique labels and an 8-byte-aligned heap
boundary. ABI 1 artifacts fail explicitly instead of being silently reinterpreted.
The digest remains an integrity check, not authentication.

Fresh local Node 22.16.0 / Linux evidence used the recovered Wasm handoff, whose
`wasm-host.mjs` blob is byte-identical to current main; the current demanded-linking
`wasm.mjs` baseline was separately reconstructed byte-for-byte from main before the
same ABI-only patch was applied. On the executable handoff:

- `npm test`: 103/103 passed, including three new ABI-corruption/compatibility tests.
- `npm run verify`: passed those 103 tests, four examples, README execution,
  standalone saved-Wasm execution, 500/1,000/2,000 compile work gates and the
  1,000-element map/fold engine-stage check.
- Explicit `npm run bench -- --sizes 500,1000,2000 --samples 11` and
  `npm run bench:runtime` passed. Four representative artifacts each grew by 85
  bytes from the additional metadata digest field; no compile/runtime speed claim is
  made from shared-host timing samples.

This is not an exact post-commit aggregate for every current-main test because the
recovered handoff predates the demanded-runtime-linking and repository-policy tests.
The two production files changed there were verified against their exact current-main
blob baselines before publication; the ABI tests exercise the changed behavior.

### Source-positioned Wasm runtime traps

Wasm runtime failures now preserve the source operation responsible for the trap.
The emitter writes the current source offset before fuel checks and before operations
that can enter runtime helpers. The Wasm trap helper snapshots that offset into the
already-reserved low-memory diagnostic area before trapping; the Node loader reads it
only after a `WebAssembly.RuntimeError` and constructs the ordinary `TTError` with
that position. Higher-order `map`/`fold` loops explicitly restore their caller site
after invoking a source closure so loop fuel/allocation failures are not mislabeled
as the callback's last expression. No JavaScript TT evaluation or host import was
introduced.

Local Node 22.16.0 / Linux verification used source files reconstructed byte-for-byte
from the live `20a7a6d` production blobs, plus current regression additions and three
new source-location tests:

- `npm test`: 111/111 passed. New cases cover arithmetic and bounds traps, a nested
  callback trap, higher-order fuel-site restoration, and CLI line/column rendering
  with non-ASCII source preceding the failure.
- `npm run verify`: passed the 111 tests, all four source/Wasm examples, README,
  standalone saved-Wasm execution, compile work gates, and the separate 1,000-element
  map/fold engine-stage check.
- `npm run bench -- --sizes 500,1000,2000 --samples 11` and `npm run bench:runtime`
  passed. A matched five-program artifact comparison against the exact pre-change
  production sources kept function counts unchanged and added 31 bytes (literal),
  47 (arithmetic), 79 (closure), 107 (map), and 60 (record). Warm in-process compile
  medians moved both directions, so no latency claim is made.
- A saved pre-change ABI-2 module still executes under the new host. A pre-change
  module that traps reports source offset 0, as expected because old artifacts did
  not record trap locations. ABI version, metadata fields, and public exports did
  not change.

The local workspace was reconstructed because direct `git clone` from the execution
sandbox has no public DNS. Production source baselines were exact GitHub blobs; this
is not presented as a fresh network clone qualification.

## Repository state

Current main contains only the Node/Wasm implementation. The removed legacy files
were `CMakeLists.txt`, `dev.py`, `benchmarks/bench.cpp`, `benchmarks/run.py`,
`src/bytecode.hpp`, `src/main.cpp`, `src/pipeline.hpp`, `src/refine.hpp`,
`src/syntax.hpp`, `src/types.hpp`, `tests/kernel.cpp`, `tests/test_cli.py`, and
`tests/test_dev.py`. Historical provenance and old benchmark data remain in Markdown
and JSON where useful; they are not executable implementations.

## Deliberate limitations

The Wasm heap boxes generic values, uses a bounded per-main bump allocator and linear
record lookup. It has no GC, reclaiming ownership system, persistent host object ABI
or exported callable-closure interface. Runtime TT traps now carry source offsets for
newly emitted artifacts, but saved Wasm still has no embedded source text, source map,
or file identity; artifact-only `exec` therefore cannot reconstruct line/column text
without external source provenance. ABI metadata and digests are integrity checks,
not an audited hostile-module sandbox.

Variants, recursion, modules, inferred effects/handlers, nominal declaration metadata,
general compile-time evaluation, static parameters, declaration tags, ownership and
incremental compilation remain open. Generic refinement transport is conservative
for symbolic arithmetic and unsummarized collection primitives. Cross-engine and
cross-platform qualification remain open. Production gates are unchanged.

Next: continue allocator/lifetime auditing, define external source provenance for
standalone Wasm diagnostics, extend bounded refinement relations to selected
arithmetic/container summaries, then variants/recursion and nominal evidence before
effects/staging and the systems-only ECS slice.
