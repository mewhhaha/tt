# Iteration: immutable shared array views and consuming scalar writes

Date: 2026-09-18. Published base:
`3e135945062e8c950c5fbc465f11f77edc1f9563`.
The starting ownership slice was recovered from the user's verified archive/patch,
not assumed to be on main. Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64.
All execution used local Node without dependency installation, Python/native tools,
CI artifacts or hosted checking. Node's own memory management is not TT runtime GC.

## Publication attempt

The live main ref was reread and matched the base above. Normal Git access failed
with `Could not resolve host: github.com`. Unlike the preceding run, connector write
actions were available. Normal UTF-8 tree writes staged some ownership source files,
but the `src/types.mjs` submission was blocked with:

> This tool call was blocked by OpenAI because we couldn't determine the safety status of the request.

No commit or ref update was made. No alternative encoding, transport or write API
was used to evade the block. Staged partial trees are not published source. Both the
ownership slice and this extension therefore remain local, with a combined patch
against the published base. Repository history and unrelated files are preserved.

## Falsifiable hypotheses and implementation

1. Readonly slicing/concatenation can share elements without scanning/copying them.
   Added checked 32-byte slice/concat descriptors, offset collapsing, empty elision,
   and adjacent same-base window merging. General concatenation is a bounded binary
   view and has O(height) lookup, not a magical contiguous O(1) representation.
2. Isolated owning arrays of fixed-size scalars can update one cell without copying
   the owner. `@own` already expands source aliases; normalized view copying maintains
   this invariant. `@set` consumes the owner after loans end, validates all inputs,
   charges byte-copy fuel, and overwrites only its exclusive scalar cell.
3. Computed write arguments should not cause a per-write scratch-memory leak.
   The result is only an isolated owner, so the setter rewinds argument temporaries
   after copying its scalar. Earlier captures, values and enclosing handlers remain.
4. The optional representation should not change artifacts for old programs.
   Feature guards avoid linking new helpers/metadata when unused. A matched suite
   verifies exact machine-byte equality for 102 pre-extension compilations.

See ../ARRAYS.md for syntax, lifetime arguments, representations and compatibility.
No tracing GC, reference counting, arbitrary callback specialization, skipped proof
pass or new executable target was introduced. Full persistent sharing/linear closure
semantics remain outside this slice.

## Fresh tests and exact-input recovery

The prior 30-file ownership patch SHA-256 and all changed-file bytes were verified
against their delivered manifest. Reversing that patch reproduced the exact published
src/tests/scripts Git trees and 26 other recorded file blobs (29 checked identities).
The published baseline was rerun locally: **217/217 passed**. The recovered ownership
snapshot's full verifier also passed **260/260** before the new array changes.

The final extended suite passes **290/290**, no skipped or weakened existing tests.
Thirty new tests exercise positive/negative bounds, zero-copy pointer evidence,
constant descriptor allocation, alias expansion, independent snapshots, loan escape,
use after move, index/value effect ordering, modules, refinement preservation,
malformed backing graphs, height/length limits, budget exhaustion, repeated computed
writes, low-fuel cleanup and standalone saved real-Wasm execution. One hundred
generated array cases are checked against an independent immutable-array model in
both optimized and copying-reference modes. A 400-budget setter sweep checks traps.

All old tests are byte-unchanged. `npm run verify` retains the original checker,
compiler work, runtime, effects and ownership gates, and additionally runs the new
array work gates and pure/host example. Both 10,000-frame ownership examples still
produce checksum40030, reuse blocks9999 times and finish with zero live owned bytes.
The new example preserves `[10,20,30,40]`, returns `[10,99,30,40]`, reads rotatedFirst30,
and joins length4. Host mode performs exactly two explicitly granted callbacks.
Documentation positive/negative examples were also executed, not only displayed.

Commands executed locally (working directory `tt` unless shown):

```text
cd ../ownership-baseline && npm run verify
cd ../published-baseline && npm test
cd ../tt
node --test tests/array-views.test.mjs
npm test
npm run verify
npm run bench -- --sizes 500,1000,2000 --samples 11 --output ../current-evidence/compiler-gates.json
npm run bench:runtime -- ../current-evidence/runtime-gates.json
node benchmarks/array-compatibility.mjs ../ownership-baseline/src ../current-evidence/compatibility-final.json
```

The new full verifier invokes `node benchmarks/array-views.mjs`; raw retained results
are in benchmarks/array-views.json. `array-inputs.json` identifies the tested sources,
tests, examples, package, README and drivers. Patch/extracted-snapshot checks have
separate logs in the supplied evidence; this is not a complete network git clone or
cross-engine/platform qualification. Historical ownership JSON remains labeled as
prior evidence, not reinterpreted as current measurements.

## Cost evidence, not a universal no-overhead claim

Eleven alternating samples, ten warmups. Runtime numbers below are per main call on
already instantiated Wasm; they include initial array/owner construction but exclude
loading, host decoding and display. Writes compare identical source with full-owner
copying reference lowering versus in-place lowering. View measurements compare
explicit materialization against the corresponding shared view. These are not claims
of speedups over a previously available TT view/set API.

| Workload | Copying/materializing ms | In-place/view ms |
| --- | ---: | ---: |
| 64 scalar writes, 128 elements | 0.3861 | 0.0117 |
| 64 scalar writes, 1024 elements | 2.9902 | 0.0544 |
| 64 scalar writes, 4096 elements | 11.9274 | 0.2392 |
| View/materialize, 512 elements | 0.0173 | 0.0035 |
| View/materialize, 4096 elements | 0.1410 | 0.0468 |
| View/materialize, 16384 elements | 0.5735 | 0.1987 |

The 4096-element setter case reserves one114736-byte owner block instead of two
blocks totaling229472 bytes; the default performs no new owner allocation per write.
The lower result prefix is24 bytes in both modes. Actual Wasm capacity is4456448
bytes because of the prototype's fixed high-arena split: tiny allocation counters
are NOT total capacity, RSS or peak-memory claims. Repeated computed-write tests use
128 bytes of common retained scratch data at 1/32/256 writes, rather than growing per
write. Three shared-view descriptors cost96 bytes regardless of backing size.

The final matched old-program controls (5 warmups,11 alternating samples) measured:
records/2000 10.622->10.429ms, polymorphism/2000 32.662->34.811ms,
effects/1000 9.094->8.716ms, modules/64 2.423->2.275ms. Earlier controls were noisy and
put the regression elsewhere (records10.926->11.894ms, polymorphism32.081->32.110ms).
The earlier samples are retained with the handoff evidence. The final polymorphic
control is about6.6% slower; no blanket zero-cost or general compile-speed claim is
made. Every tested old artifact is byte-identical and existing deterministic work
gates remain unchanged. New setter scaling work is bounded at 100/200/400 writes.

## Remaining work

There is no balanced rope/segment iterator, variable-sized in-place setter, implicit
copy-on-write, constant-time independent snapshots, owner-capturing closure system,
full usage polymorphism, nonlexical borrowing or long-lived host handle interface.
Views live in the invocation arena or inside scoped loans; all views are flattened
and recursively unshared when constructing an owner. Snapshot/owner-copy and host
snapshot decoding remain real costs. Extending these limits must preserve lifetimes,
refinements/effects and deterministic storage reuse, not introduce a hidden collector.
Production gates remain unchanged and no production-readiness claim is made.
