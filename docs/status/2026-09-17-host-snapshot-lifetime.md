# Host snapshot lifetime boundary — 2026-09-17

Status: implemented as a bounded host-ownership hardening step; production readiness remains open.

## Hypothesis

`execute()` can return values that remain valid after Wasm execution without exposing the live `WebAssembly.Instance` or mutable aliases into linear memory. Aggregate values should be detached immutable snapshots, and returned closures should remain opaque non-callable descriptors until a separate host-callable closure ABI has explicit ownership/invalidation semantics.

## Change

`readValue` still validates the complete reachable result graph before exposing it. Once validation succeeds, Array/Record/Closure snapshots are now frozen before memoization and return. Array element vectors and Record label/value vectors are frozen as well. Scalars were already copied immutable JavaScript values. Shared aggregate pointers still decode once and preserve shared object identity through the existing memo table.

`execute()` no longer returns its live `WebAssembly.Instance`; it returns a frozen execution record containing the detached decoded value, rendered output, immutable metrics, the inert compiled `WebAssembly.Module`, and remaining fuel. The Module is equivalent authority to the caller's artifact bytes: it has no live memory or result pointers. This change deliberately does not make a returned TT closure callable from JavaScript. A host-visible closure remains exactly a frozen `{ kind: 'Closure' }` descriptor with no pointer, table index, captures, instance, memory, or call capability.

Low-level `loadWasm` remains available for explicit ABI/runtime tests and tools that intentionally construct their own `WebAssembly.Instance`; that interface is separate from the persistent result snapshot returned by `execute`.

No checker, refinement, Wasm emitter, runtime helper, artifact ABI, public Wasm export, or generated Wasm byte changed.

## Regression evidence

The exact pre-change production host was Git blob `d922c04e913098269233f516e61d92efb67b5c06`. Four new snapshot tests were run against that exact host before the implementation: 0/4 passed. They cover deep aggregate immutability, absence of live instance/memory authority from `execute`, opacity of returned closures, and persistence of a decoded snapshot after the source Wasm memory is overwritten. The changed host passes 4/4.

The reconstructed local Node/Wasm workspace on Node 22.16.0 / V8 12.4.254.21-node.26 / Linux x64 then passed `npm test` with 135/135 tests. `npm run verify` passed the same tests, all four examples, README execution, standalone Wasm execution with no PATH/environment dependencies, 500/1,000/2,000 compiler work gates, and the separate 1,000-element map/fold engine-stage check. Explicit compiler and runtime benchmark commands also passed. Public DNS remained unavailable for a fresh clone, so the aggregate count is reconstructed-workspace evidence rather than clean-checkout or cross-platform qualification; the changed production host baseline itself is byte-exact live main.

Exact commands from this run are recorded in the paired iteration note. No Python/native compiler/npm install/CI artifact/hosted checker was used by TT verification or benchmarks. Python was not used by the TT toolchain; local workspace text-edit helpers are not runtime dependencies.

## Cost evidence

`benchmarks/host-snapshot-integrity.json` records an alternating before/after `readValue` microbenchmark on prebuilt linear memory, 3 warmups and 11 samples per side. It excludes Wasm validation, Module/Instance construction, Wasm execution and display.

- One 100,000-Int Array: median 6.145 ms before, 6.546 ms after.
- One Array containing 20,000 distinct empty Array allocations: median 3.357 ms before, 6.051 ms after.

The aggregate-heavy case shows the expected cost of freezing every exposed aggregate snapshot. These are local host-decoder observations, not a general runtime slowdown claim. Compiler work gates and the engine-only map/fold benchmark remain separate from host decoding and were unchanged in design.

## Remaining boundary

This does not provide GC, retained Wasm objects, host-callable closures, cross-call pointer stability, hostile-module isolation, or an ownership type system. A future callable-closure interface must define explicit rooted lifetime, instance ownership, invalidation/release behavior, fuel/error boundaries and argument/result copying without promoting raw linear-memory pointers or table indices to public authority.
