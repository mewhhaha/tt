# TT status — Node compiler, WebAssembly-only output — 2026-09-16

**Research prototype, not production-ready.** The compiler and all active tools
are JavaScript ES modules running locally under Node. The sole executable target
is standard Core WebAssembly. This replaces the previous Node TTBC emitter/VM;
no interpreter or alternate executable target remains in active sources.

## Implemented and preserved

The existing structural/refinement frontend is retained: let polymorphism, open
record requirements, closures and higher-order functions, arrays/map/fold, strict
records/conditionals, UTF-8 Text, full signed-i64 arithmetic, interval-set contracts,
checked callable pre/postconditions, contravariant input requirements and scoped
branch facts. Compact symbolic evidence now transports direct parameter, projection,
record and higher-order application relationships without call-site body rechecking.

The new backend lowers checked syntax to Wasm functions, structured branches, an
indirect-call table and explicit closure environments. Runtime helpers for checked
arithmetic, arrays, field access, text and currying are emitted in Wasm. The emitter
now links only helpers reachable from source operations and actually referenced
native values, including transitive future targets of curried closures. Artifacts
have zero host imports. The JavaScript loader decodes results but does not evaluate
TT operations. There is no VM inside the Wasm module.

`check` runs the frontend only. `compile(source).wasm` and CLI `build` emit .wasm;
`run` compiles then executes Wasm. The public API no longer exports VM/encode/decode.
`exec` accepts the versioned TT Wasm ABI and refuses legacy TTBC. See WASM.md.

## Local verification

Actual runtime: Node 22.16.0, V8 12.4.254.21-node.26, Linux x86_64. No CI artifact,
native compiler, Python or third-party package was used for this verification.

Commands: `node --test tests/*.test.mjs` and `node scripts/verify.mjs`.

- 102 tests passed, 0 failed, including all 75 captured source fixtures, generic-
  refinement substitution/variance regressions, and demanded-runtime linking.
- 191,751 structural/refinement kernel assertions passed. Six legacy VM checks
  were deliberately removed and replaced by Wasm-specific tests; the older
  191,757 total is NOT claimed for this backend.
- 2,020 boundary/generated i64 arithmetic cases agree with independent BigInt
  arithmetic, including traps. The existing 300 generated arithmetic expressions,
  refinement decisions, 1,000 malformed-source and 500 malformed-byte cases pass.
- Four examples and the README program check, compile, validate and execute.
- A saved .wasm runs in a separate Node process using only WebAssembly.Module /
  Instance and DataView, without the TT source tree, original source or runner.
- Demand/trap order, short circuiting, alias/capture correspondence, higher-order
  collections, memory growth, fuel exhaustion/reset, integrity checks, bounded
  result decoding, deterministic artifacts and atomic output writes are tested.
- Compile work/size gates pass at 500/1,000/2,000 items, 11 samples per workload,
  including a refinement-relation wrapper chain with counted evidence substitutions.
  Separate Wasm engine-stage measurements pass for 1,000-element map/fold with
  checksum 500500, 11 samples and 100 main calls per sample.
- A literal-only artifact now links 5 runtime helpers and has 7 total Wasm functions
  / 573 bytes, versus 41 functions / 2,275 bytes in the pre-change snapshot. At the
  1,000-item compile workloads, dead stripping removes 26-29 functions and
  1,296-1,457 bytes depending on workload. Wall-clock compile samples remain noisy;
  no compilation-speed claim is made from this change.

Committed matched compile evidence: `benchmarks/helper-linking-1000.json` retains
all eleven raw total samples for the n=1,000 before/after workloads plus focused
size/work metrics. `benchmarks/helper-linking-runtime.json` retains the raw
engine-stage samples. The full 500/1,000/2,000 raw benchmark runs were executed
locally for verification but are not required by the active workflow or committed.
Earlier handoff logs and obsolete backend benchmark files are historical only. No matched speedup over differing pipelines,
cross-engine qualification or soundness proof is claimed. The committed evidence keeps
raw total samples and phase medians; benchmark boundaries still distinguish checking/emitting
from Wasm engine validation/compilation/instantiation and execution.

## Deliberate limitations

The Wasm heap boxes generic values, uses a bounded per-main bump allocator and
linear record lookup. It has no GC, reclaiming ownership system, persistent host
object ABI or exported callable-closure interface. Runtime source locations are
not yet precise. Metadata/digests/fuel are NOT an audited hostile-module sandbox.

Variants, recursion, modules, inferred effects and handlers, nominal declaration
metadata, general compile-time evaluation, static parameters, declaration tags,
ownership and incremental compilation remain open. Generic refinement transport is
still conservative for symbolic arithmetic and unsummarized collection primitives.
Production gates are unchanged and unchecked.

## Repository state

The active source tree is the dependency-free Node/Wasm implementation described
above. Retained native C++ files and older build scripts are historical reference
only and must not participate in the supported local workflow. The previous
source-handoff blocker is recorded in ITERATIONS.md as history rather than as a
current semantic limitation.

Next: audit the Wasm ABI and allocator, extend bounded refinement relations to
selected arithmetic/container primitives, and continue effects/staging without
adding another output target. See ROADMAP.md and production gates.
