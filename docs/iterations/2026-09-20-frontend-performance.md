# Lower-allocation compiler frontend — 2026-09-20

Base: `038dc74e21454f322b3053d4e7651b2ab2e2c007`.
Research prototype; production gates remain unchanged.

## Change and compatibility argument

A local Node CPU profile of seven existing compilation workloads identified token
scanning and incidental JavaScript allocation/collection as substantial remaining
costs after the byte-writer optimization. Only src/syntax.mjs changes in production:

- Classify ASCII identifier/digit characters by code units rather than per-character
  regular-expression calls. EOF yields no accepted character. Identifier syntax is
  unchanged; Unicode remains supported in Text and rejected in names as before.
- Scan Text using spans. An unescaped literal takes one source slice; escaped text
  joins spans and decoded escapes, not an array entry for every code unit. Each
  original code unit is still consumed in order; unsupported escapes retain the
  exact error offset. Source UTF-8 size and well-formedness checks still run first.
- Skip comments with newline search and skip the token-offset loop only at offset 0.
  Imported modules still receive their exact virtual source offsets.
- Share a frozen empty vector for absent AST children. Actual Array/Record/Block
  vectors are distinct and built before node insertion. Replace two hot temporary
  array/callback selectors with direct tests/a fixed Map.

No cache skips compilation. Structural, ownership, effect, and refinement passes,
work counters, budgets, emitter, runtime, ABI, and source evaluation order are
unchanged. No TT garbage collector or reference counting is introduced. The CPU
profile's garbage-collector activity is Node compiler activity, not TT execution.
Unused internal AST vectors are now read-only; compiler consumers never mutate them.
Broader type-node and AST-layout experiments did not show a sufficiently reliable
additional win and were discarded before final tests/benchmarks.

## Verification

All unchanged executed inputs were restored from the supplied archive and checked
against live Git tree/blob identities. The exact baseline passed 290/290 tests;
changed code passes 296/296 with no skips or edited existing tests. Six new tests
include all ASCII boundary classes, Unicode/escape/error offsets, 5000 seeded mixed
strings, large literals, exact token/source limits, imported diagnostics, shared
empty-vector allocation invariants, and unchanged ownership/effect rejection.
The test-only frozen tokenizer is an oracle, not another TT executable backend.

The matched driver confirms all 75 existing fixture outcomes (including diagnostics),
byte-identical artifacts for accepted fixtures, eight pure/host application entries,
and all twelve timed workloads. It also checks inferred effects/types, work counters,
and successful runtime values/fuel where the existing call-depth limits permit.
Large wrapper chains remain compiler-only workloads, not runtime-limit claims.

Commands (all local Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64):

```sh
cd baseline && npm test
cd ../work
node --test tests/frontend.test.mjs
npm test
npm run verify
npm run bench -- --sizes 500,1000,2000 --samples 11 --output ../evidence/compiler-gates.json
npm run bench:runtime -- ../evidence/runtime-gates.json
node benchmarks/frontend-performance.mjs ../baseline/src ../evidence/frontend-performance.json
```

All completed commands pass. One initial verifier invocation was interrupted by the
execution tool's 120-second limit, after passing tests/compiler/effect stages. The
unmodified verifier was rerun to completion (exit 0), including ownership/array gates,
both 10000-frame examples (checksum 40030, zero live owned bytes, 9999 reuses), both
array examples and standalone Wasm. No verifier timeout or test limit was weakened.
Explicit runtime gate checksum 500500 passed with 11 samples and 100 calls per sample.

The exact source/test/verifier baseline tree identities are
ac21aff8062208fd9aed7f9484f365bd9b46bfcd,
583d8dce238f761cc9e2374f85093da5444a159d, and
856fc97e1e8d16a4ca3ec1388202272a3c314d6a. Live individual hashes also cover README,
package files, used benchmark drivers, documented examples, and old example inputs.
The supplied executed-input manifest records 83 final files. Nonexecuted historical
files were not all reconstructed: this is not a full network clone or cross-engine
qualification. The parent tree preserves those files unchanged on publication.

## Matched timings

Five warmups and 21 alternating samples per implementation, no result cache. Totals
include parsing, all checking, emission, WebAssembly.validate and type display.
Source generation and startup are excluded. Median phases do not necessarily sum
to median totals. Profiling data is diagnostic; these are unprofiled measurements.

| Workload | Size | Before total ms | After total ms | Parse before / after ms |
| --- | ---: | ---: | ---: | ---: |
| records | 2000 | 25.297 | 25.338 | 13.954 / 8.090 |
| wrappers | 2000 | 31.362 | 27.300 | 9.682 / 6.162 |
| polymorphism | 2000 | 68.308 | 56.483 | 22.829 / 16.519 |
| refinements | 2000 | 19.395 | 15.451 | 8.418 / 5.385 |
| refinement_relations | 2000 | 23.550 | 20.698 | 7.146 / 3.725 |
| effect_calls | 2000 | 38.362 | 33.825 | 9.839 / 6.091 |
| modules | 128 | 7.317 | 6.715 | 3.002 / 2.331 |
| owner_bindings | 1000 | 19.264 | 16.730 | 6.970 / 4.219 |
| owned_writes | 256 | 4.811 | 4.131 | 1.502 / 1.071 |
| plain_text | 524288 | 76.740 | 17.437 | 68.521 / 3.428 |
| escaped_text | 16384 | 34.722 | 11.907 | 31.289 / 8.477 |
| comment | 524288 | 13.489 | 7.580 | 5.969 / 0.128 |

Most ordinary workloads improve modestly; record total time is unchanged despite
faster parsing. No universal compiler speedup is claimed. The large Text/comment
cases specifically exercise the eliminated per-character allocation/scanning costs.
They must not be presented as representative of every application.

Fresh Node process measurements use 9 alternating samples. Records/2000 wall time
(including startup/import/read/compile/exit) is 413.391->414.016ms: no wall-time win;
inner compilation is 193.078->166.001ms. Plain Text wall time is 361.697->259.879ms,
inner compilation 135.518->48.962ms. Warm speedups are not cold-start speedups.
Scheduling and incidental Node collection introduce noise; no RSS/peak-memory or
cross-platform claim follows from these timings. Runtime performance is unchanged
for byte-identical artifacts, and no runtime speedup is claimed here.

benchmarks/frontend-performance.json retains selected exact raw warm totals and
cold medians. The full report, identified by SHA-256 b7bac2c513d4dae0e94c32b9c76e7c77ab1c772b60a9f0a0223059950869d42c,
also includes per-phase series, source/work hashes and raw cold samples. It is in
the supplied evidence; the committed driver reproduces that full format.

Next useful targets are structural instantiation/row costs and repeated closure
capture traversal, with the same checked contracts and matched artifact evidence.
Separate/incremental modules and broader ownership/handler features remain open;
this performance iteration neither implements nor waives them.
