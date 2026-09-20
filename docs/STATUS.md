# TT status — Node compiler / Wasm-only output — 2026-09-20

**Research prototype, not production-ready.** The supported implementation is a
dependency-free Node.js compiler emitting real Wasm. There is no C++/Python
implementation, source interpreter, custom bytecode target, or required package
installation. The production-readiness checklist is unchanged.

## Ownership and array publication

This change integrates the previously delivered ownership and array implementations
on top of `3e135945062e8c950c5fbc465f11f77edc1f9563`. Earlier dated reports describe
unsuccessful publication attempts; their implementation and measurements are now
included together, rather than left as partially uploaded source objects.

Explicit affine `Owned T` plain data supports `@own`, `@move`, `@drop`, independent
`@snapshot`, scoped read-only `@borrow`, `@take`, consuming `@update`, and `@evolve`.
The checker rejects duplicate consumption, moved uses, escaped loans, owner captures,
and unsupported generic interfaces. Whole-owner blocks are deterministically freed
and reused. Neither tracing garbage collection nor reference counting is used in
the TT Wasm runtime; Node's own memory management is separate.

Arrays support `@get`, `@slice`, `@concat`, and explicit `@materialize`. Read-only
views share element storage. Slices collapse offsets and adjacent same-base windows
can rejoin without a descriptor. General concatenations use bounded indirection.
`@set(@move owner, index, value)` reuses an isolated Int/Bool/Unit array cell once
read loans end; successful writes reclaim their computed argument scratch.

See [ownership](OWNERSHIP.md), [arrays](ARRAYS.md), and the
[publication verification](iterations/2026-09-18-publish-ownership-arrays.md).

## Local publication verification

Fresh local execution on Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64 passed:

- `npm test`: **290/290**, zero failures or skips.
- `npm run verify`: repository policy, syntax checks for restored files, all tests,
  original examples, README, standalone Wasm, compiler/runtime/module-effect gates,
  ownership/array gates, and pure/host example applications.
- Both 10,000-frame owner applications: checksum 40030, 9999 block reuses, zero live
  owner bytes; the host application performs exactly 40000 explicit callbacks.
- Both array examples: unchanged `[10,20,30,40]` snapshot, updated `[10,99,30,40]`,
  rotated first value 30, and joined length 4; host mode performs two callbacks.

The restored source, test and verifier directory Git tree hashes match the staged
publication bytes. This is a restored executed-input workspace, not a complete
network clone or cross-engine/platform qualification. Source code and existing
regressions were not changed during publication. Historical reports retain their
original dates; this run does not claim their old timings as new measurements.

## Retained features and performance boundaries

Structural functions, let polymorphism, bounded integer refinements, deferred call
preconditions, checked i64 arithmetic, source modules, inferred synchronous effect
summaries, pure Wasm handlers and explicit typed host callbacks remain supported.
Fast byte emission, numeric intermediate unboxing and bulk Text copying remain active;
`optimize: false` retains the checked reference lowering.

The array benchmark distinguishes copying writes from in-place writes, and explicit
materialization from shared views. No universal zero-overhead claim is made. Reads
through general concatenations cost O(height); snapshots and ownership construction
copy data. Owner byte counters exclude the fixed 4 MiB arena spacing and are not
RSS or total capacity. The historical roughly 6.6% polymorphic compile-control
increase is not hidden by the array runtime gains.

Historical evidence and reproduction commands:
[ownership iteration](iterations/2026-09-18-owned-data.md),
[array iteration](iterations/2026-09-18-array-views.md), and
[numeric performance](iterations/2026-09-17-numeric-performance.md).

## Remaining work

Ordinary legacy values still use the invocation arena. This is explicit ownership,
not ownership-by-default for every value. Snapshots copy independently. Full usage
polymorphism, owner-containing closures/containers, nonlexical loans, external
resource finalizers, persistent callable host handles, balanced concatenation trees,
and variable-sized in-place setters remain unsupported.

General resumable/async effect handlers, variants/recursion, separate or incremental
module checking, nominal providers and the systems-only ECS, compile-time evaluation,
and stable ABI/cross-platform qualification remain open. Host callbacks are trusted
synchronous code: TT fuel does not bound their duration or roll back I/O. Integrity
metadata is not authentication or a hostile-module sandbox. Do not shrink the
production gates to describe this prototype as complete.
