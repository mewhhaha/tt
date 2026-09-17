# 2026-09-17 — memoize shared Wasm result subgraphs

## Hypothesis

Because TT aggregate values are immutable within a successful Wasm invocation, a
host decoder can memoize a completely validated aggregate by its allocation-start
pointer without weakening cycle, depth, allocation-start or decode-work checks. This
should turn repeated-DAG traversal from repeated subtree work into one decode per
aggregate while leaving ordinary tree/flat-result cost within measurement noise.

## Counterexample

The exact live-main decoder at
`c068088f6d26101d7bb13e3a54be99b899717ab3`, Git blob
`196240a913f6f5dd8a10395d185acc5645cedcf3`, recursively decoded every aggregate edge.
A valid bump heap with 2,000 boxed Ints, one array containing those Ints and a root
array containing 600 references to that same child has 2,002 allocations. The old
host nevertheless performed more than 1.2 million recursive reads and failed with
`E_LIMIT: result decoding limit exceeded`.

The regression was added first to the current `tests/result-integrity.test.mjs`.
Against the exact old host:

    node --test tests/result-integrity.test.mjs
    # 9/10 passed; shared-subgraph case failed with E_LIMIT

## Change

`readValue` now keeps a per-decode `Map` for completed Array, Record and Closure
allocations. Scalars are intentionally not memoized. The cache lookup occurs only
after ordinary pointer bounds, allocation-start and tag checks. Active aggregates are
not entered into the cache, so cycles still reach the existing `active` rejection.
A cache entry stores both the decoded value and its checked nesting depth; reuse
restores that depth before the parent computes its own nesting metadata.

The existing `visited` counter is incremented before cache lookup, and the path-depth
check also runs before lookup. Thus a million pointer edges remain bounded even when
they all target one cached aggregate. Only repeated traversal beneath an already
validated aggregate is removed. The Wasm ABI, emitter/runtime bytes and checker are
unchanged.

## Local evidence

Exact current-host targeted run on Node 22.16.0 / V8 12.4.254.21-node.26 / Linux x64:

    node --check src/wasm-host.mjs
    node --test tests/result-integrity.test.mjs
    # 10/10 passed

The coherent recovered Node/Wasm migration handoff was also patched with the same
aggregate-only memoization to exercise the full dependency-free workflow offline:

    npm test
    # 101/101 passed

    npm run verify
    # 101 tests, four examples, README, standalone Wasm, compile work gates,
    # and the 1,000-element map/fold engine-stage check passed

    npm run bench -- --sizes 500,1000,2000 --samples 11 --output <local-json>
    # existing work gates passed

    npm run bench:runtime
    # checksum 500500; 11 samples; 100 calls/sample

This broader workspace is not an exact fresh current-main checkout because public DNS
is unavailable. The exact production file changed in this iteration and the relevant
current test were reconstructed byte-for-byte from live GitHub before modification.

## Cost evidence

`benchmarks/result-sharing-integrity.json` retains 11 alternating before/after
host-only samples after three warmups for each workload. On the same process/engine:

| workload | before median | after median |
| --- | ---: | ---: |
| 20,000 distinct Int children | 1.686 ms | 1.658 ms |
| 200 references to one 1,000-Int child array | 19.709 ms | 0.301 ms |

The flat samples contain outliers and support no general speed claim. The shared-DAG
case directly exercises the removed redundant traversal and shows a large matched
reduction. These numbers exclude Wasm validation, Module/Instance construction,
execution and display.

## Limitations and next work

Decoded aggregate JavaScript object identity is not a TT semantic identity; shared
Wasm allocations may now reuse the same decoded aggregate object. Large textual
rendering can still expand a shared DAG because output itself repeats the value, so
an explicit display/output work policy remains separate future robustness work.

No ownership, GC, reclamation, persistent host value or callable-closure ABI is added.
Next define the persistent-host-value / host-callable-closure lifetime boundary, with
explicit invalidation/ownership evidence rather than treating refinement predicates
or raw Wasm pointers as authority.
