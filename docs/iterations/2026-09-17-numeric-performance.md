# Iteration: fast Wasm emission and unboxed numeric intermediates

Date: 2026-09-17. Baseline main: 5e6a9b82c946f31f27fd742f624796da117246c3.
Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64. No dependency install,
Python, native compiler, CI artifact or network-dependent execution was used.

## Hypotheses and changes

1. JS number-array byte accumulation dominates larger emission workloads. A growing
   byte Buffer and direct LEB writes should reduce copying/allocation while retaining
   exact reference-mode artifact bytes.
2. Adjacent checked arithmetic produces unnecessary intermediate boxes. Keep those
   intermediate values in i64 operands, while preserving boxed ABI boundaries,
   per-operation overflow checks, tick order and host-effect ordering.
3. Text concat's byte loop can be replaced by memory.copy when the entire copy's
   fuel is available; retain the original loop otherwise to preserve partial writes.

See ../OPTIMIZATION.md for the precise compatibility boundary, including intentional
changes to allocation exhaustion/address identity. This is not a type-system
shortcut, reassociation, GC, or a new execution target. No lexer changes were made.

The previously attached performance archive had no file entries. This iteration
therefore rebuilt from pinned current-main sources and records fresh evidence; it
does not present prior unrecoverable changes or old measurements as this run's work.

## Exact-input recovery and verification

Public DNS from the execution environment did not resolve GitHub. Sources were
recovered using authorized repository reads and verified by Git blob hashes. All
15 baseline production files, all 202 existing tests/fixtures, executed verification
and benchmark drivers, package manifests, README and examples match the pinned
repository. This is an exact executed-input workspace, not a complete git clone;
unexecuted historical documentation/evidence were not all restored.

Commands executed locally (paths abbreviated relative to /mnt/data/tt-next):

```text
cd baseline && npm test
# 202 passed, 0 failed
cd work && node --test tests/numeric-regions.test.mjs tests/byte-writer.test.mjs
# 12 passed, 0 failed
cd work && npm test
# 217 passed, 0 failed
cd work && npm run verify
# PASS: policy, syntax, 217 tests, examples/README/standalone Wasm,
# existing compile gates, runtime gates, module/effect gates and host runners
cd work && npm run bench -- --sizes 500,1000,2000 --samples 11 --output ../evidence/compiler-gates.json
cd work && npm run bench:runtime -- ../evidence/runtime-gates.json
# PASS; runtime gate checksum 500500
cd work && node benchmarks/numeric-performance.mjs ../baseline/src ../evidence/numeric-performance.json
# PASS: matched outputs, fuel, work, byte parity and timings
```

Fifteen new tests cover writer growth/copy/LEB boundaries; 800 independently modeled
checked-i64 expression trees; overflow/zero/remainder edge cases; fuel and imported
source locations; checked contracts in both modes; effects/host-call ordering;
collection heap savings; and concat full-memory/fuel parity. The existing tests and
work gates are unchanged. All 44 accepted captured fixtures emit byte-identical Wasm
to baseline with optimize:false. Default-mode output intentionally differs where
numeric regions or bulk copies apply. Seven of eight timed compiler workloads still
emit identical default artifacts; the numeric workload changes helper selection.

## Matched performance observations

Warm compile samples: five warmups, 11 alternating samples per implementation,
source generation outside timing, no compiler-result cache. Times include parse,
structural/effect/refinement checking, emission, validation and type display.

| Workload | Size | Before ms | After ms |
| --- | ---: | ---: | ---: |
| Wrappers | 2000 | 35.457 | 15.713 |
| Record fields/projections | 2000 | 35.030 | 10.967 |
| Polymorphic calls | 2000 | 78.392 | 40.760 |
| Refined calls | 2000 | 19.658 | 10.128 |
| Refinement wrappers | 2000 | 22.801 | 11.965 |
| Effect calls | 2000 | 37.312 | 19.765 |
| Diamond module branches | 128 | 8.184 | 4.981 |
| Numeric map/fold source | 5000 | 22.242 | 8.894 |

New-Node-process records/2000: five alternating samples. Median wall including
startup/import/read/compile/exit: 143.595 -> 118.769 ms. Inner compilation:
94.235 -> 68.464 ms. Warm ratios must not be advertised as cold-start ratios.

Wasm execution is timed separately using already instantiated modules, 20 warmups,
11 alternating samples and 100 main calls/sample (20 for concat). Each main resets
fuel/heap; host decoding/display happens after the timed loop.

| Runtime workload | Before ms/call | After ms/call | Before heap bytes | After heap bytes |
| --- | ---: | ---: | ---: | ---: |
| Numeric map/fold, 1000 | 0.378 | 0.245 | 248136 | 80136 |
| Numeric map/fold, 5000 | 1.836 | 1.219 | 1240136 | 400136 |
| Simple map/fold control, 5000 | 0.741 | 0.762 | 400136 | 400136 |
| Pure-effect numeric, 2000 | 0.906 | 0.603 | 592184 | 160184 |
| Text concat, 192000 result bytes | 0.851 | 0.004 | 192040 | 192040 |

All timed output hashes and remaining-fuel values agree. The arithmetic artifact
adds 21 bytes at size 5000 (129451 -> 129472), and one helper (26 -> 27).
Simple map/fold is effectively unchanged, not a claimed win. Heap bytes are dynamic
bump allocations, not RSS, peak memory or retained live data. Engine construction
samples may include engine caching; cross-engine/platform qualification is open.

CPU profiles of matched compiler workloads separately identified byte appending and
incidental GC as major baseline costs. Those sampled profiles are diagnostic,
not substituted for the unprofiled timing samples above.

## Evidence and next work

benchmarks/numeric-performance.mjs reproduces full raw phase/provenance reports.
benchmarks/numeric-performance.json retains raw totals/runtime/cold observations
from this run; its full-report SHA identifies the accompanying detailed local JSON.
benchmarks/numeric-performance-inputs.json records executed-input identities.

Next runtime targets are long-lived memory reclamation and remaining boxed storage,
curried closure allocations and record lookup. Structural/effect/refinement work,
variants/recursion, separate modules, nominal providers, staging, general handlers,
host-callable closure authority and the ECS application remain production gates.
Do not remove safety checks or erase obligations to improve a synthetic benchmark.
