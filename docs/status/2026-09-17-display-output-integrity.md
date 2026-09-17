# Status delta — 2026-09-17 — bounded host result display

Current main remains a dependency-free Node.js compiler with WebAssembly as the only
executable output. This iteration changes only the JavaScript host representation
renderer and execution metrics. It does not change the checker, direct Wasm emitter,
in-module runtime, public Wasm exports, ABI version, source metadata, heap validation
or result graph decoding.

The result decoder already bounds and memoizes reachable Wasm result graphs, but the
text renderer previously expanded every shared edge with ordinary recursive string
concatenation and had no total output bound. A small immutable result DAG could
therefore decode successfully and then expand into a very large host string. That is
a separate output-work problem from validating Wasm memory.

`display` now accounts the UTF-8 byte size of the rendered representation while it is
constructed and rejects output above 16 MiB with `E_LIMIT: result display limit ...`.
The existing depth-64 ellipsis behavior is preserved. The bound admits the worst-case
escaped rendering of one legal 4 MiB Text scalar (8 MiB plus quotes), while deliberately
bounding larger aggregate output. Construction checks the budget while descending, so
a repeated shared DAG is stopped before its full expansion is materialized.

`execute` also now measures host result decoding and textual rendering separately.
`metrics.decode_ms` covers `readValue` only; the new `metrics.display_ms` covers
`display` only. Wasm validation/loading, Instance construction and Wasm execution
remain separate existing stages.

Regression-first evidence used exact live main
`862a278aba0322a994abdca24de119adcc86678a` and exact pre-change
`src/wasm-host.mjs` Git blob `67a888725867958141e7fe4b71b69f379e96e313`
(SHA-256 `39a1f668a11ac412b8cf391fd8ef5e4f99c28a8de9a9fc9a41114057386bde23`).
With the new tests and old host, the display suite passed 1/3: the 22-level shared-DAG
case produced its full output instead of rejecting, and `display_ms` did not exist.
With the change, `node --test tests/display-integrity.test.mjs` passed 3/3.

Local Node 22.16.0 / V8 12.4.254.21-node.26 / Linux x64 verification then ran:

- `npm test`: 131/131 passed, including all 75 source fixtures, the 191,751 kernel
  assertions, 2,020 i64 Wasm cases, existing ABI/heap/result-integrity tests, and the
  three new display tests.
- `npm run verify`: passed the same 131 tests, all four repository examples, README
  execution, standalone saved-Wasm execution, 500/1,000/2,000 compile-work gates and
  the separate 1,000-element map/fold engine-stage benchmark.
- `npm run bench -- --sizes 500,1000,2000 --samples 11 --output ...`: passed existing
  deterministic compiler work gates.
- `npm run bench:runtime -- ...`: passed checksum 500500 with 11 samples and 100
  Wasm calls/sample; that benchmark excludes host decode/display from execution.

Because public DNS is unavailable in the execution sandbox, the full workflow used a
locally reconstructed current Node/Wasm tree rather than a fresh clone. The production
file changed in this iteration was reconstructed byte-for-byte from live main before
the patch, as were the behavior-specific current result-integrity tests; the 75 fixture
contents were reproduced semantically from live main. This is local regression evidence,
not clean-checkout, cross-platform or cross-engine qualification.

`benchmarks/display-output-integrity.json` contains 11 alternating before/after host-only
samples after three warmups for rendering an already-decoded Array of 100,000 distinct
BigInt values. The measured median was 11.373 ms before and 7.490 ms after in that run,
but samples are noisy and support no general display-speed claim. The important cost
property is that ordinary flat rendering remains bounded by actual output work while
the 22-level shared-DAG adversarial case now terminates with `E_LIMIT` instead of
materializing more than the configured output budget.

This does not make decoded host values persistent, callable, owned, or safe across a
subsequent `main` invocation. The next high-value runtime boundary remains an explicit
persistent-host-value / host-callable-closure ownership and invalidation design.
