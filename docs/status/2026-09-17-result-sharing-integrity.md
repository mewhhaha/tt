# Status delta — 2026-09-17 — shared Wasm result graph decoding

Current main remains a dependency-free Node.js compiler with WebAssembly as the only
executable output. This iteration changes only host-side decoding of already-validated
Wasm result memory. The checker, direct Wasm emitter, in-module runtime, public Wasm
exports, ABI version, allocation-start validation and source diagnostics are unchanged.

The result decoder previously walked every aggregate edge recursively even after the
same allocation had already been fully decoded. TT values may form immutable DAGs:
for example an array can contain many references to the same array. A synthetic live
heap containing one 2,000-Int child array referenced 600 times by a root array has only
2,002 allocated objects, but the exact pre-change decoder revisited the child subtree
for every edge and exhausted the 1,000,000 decode-work limit. That is a host-side
amplification failure, not a source typing error.

`readValue` now memoizes only fully decoded aggregate allocations (Array, Record and
Closure) by their validated allocation-start pointer. Scalars keep the previous fast
path. Memo entries are published only after all children, cycle checks and nesting
metadata have succeeded, so an active cycle cannot hide behind the cache. Every edge
still increments the existing decode-work counter and checks depth before reuse; the
change removes repeated subtree traversal, not the resource bound. Cached aggregate
nesting depth is restored when a shared node is reused so parent depth validation is
unchanged. TT has no language-level pointer identity; JavaScript aggregate object
identity remains an implementation detail of the decoded host representation.

Regression-first evidence used exact live main `c068088f6d26101d7bb13e3a54be99b899717ab3`
and exact pre-change `src/wasm-host.mjs` Git blob
`196240a913f6f5dd8a10395d185acc5645cedcf3`. With the new shared-DAG regression but
the old host, `node --test tests/result-integrity.test.mjs` failed 9/10 with
`E_LIMIT: result decoding limit exceeded`. With the change, the
same exact current-host test file passed 10/10 locally on Node 22.16.0 / V8
12.4.254.21-node.26 / Linux x64.

Broader local execution used the recovered migration handoff because outbound public
DNS still prevents a fresh checkout. The same aggregate-only memoization was applied
to that coherent Node/Wasm snapshot and one equivalent regression was added:

- `npm test`: 101/101 passed, including 191,751 structural/refinement kernel checks,
  generated arithmetic/malformed-input tests, Wasm runtime tests and the shared-DAG
  decoder regression.
- `npm run verify`: passed those 101 tests, all four examples, README execution,
  standalone Wasm execution, 500/1,000/2,000 compile-work gates and the separate
  1,000-element map/fold engine-stage benchmark.
- `npm run bench -- --sizes 500,1000,2000 --samples 11 --output ...`: passed the
  existing compiler work gates.
- `npm run bench:runtime`: passed checksum 500500 with 11 samples and 100 calls/sample.

The 101-test run is deliberately not claimed as an exact current-main aggregate; the
behavior-specific 10/10 result is against exact current production host bytes and the
current result-integrity test baseline.

A matched host-only benchmark alternated exact before/after decoders for 11 samples
after three warmups. It excludes Wasm validation, module/instance construction,
execution and display. A flat array of 20,000 distinct Int values had median decode
1.686 ms before and 1.658 ms after; samples are noisy and no flat-workload speed claim
is made. A root with 200 references to one 1,000-Int child array changed from
19.709 ms to 0.301 ms median because the shared subtree is decoded once. Raw samples
and provenance are in `benchmarks/result-sharing-integrity.json`.

This addresses repeated-subgraph decode amplification only. It does not add GC,
reclamation, persistent host values, callable escaping closures or hostile-module
isolation. The next high-value runtime boundary remains persistent host values and a
host-callable closure ownership/lifetime design; large textual display of shared
values also needs an explicit output/work policy rather than being conflated with
result-memory validation.
