# 2026-09-17 — bound host result display work

## Hypothesis

Result-memory validation and textual output are distinct resource boundaries. If the
host renderer accounts rendered UTF-8 bytes incrementally, a valid shared result DAG
can no longer amplify into unbounded text after decode, while normal output formatting
and legal maximum-size Text scalars remain accepted. Separating decode and display
metrics should also make host-stage measurements match the documented phase boundary.

## Counterexample first

A decoded JavaScript value was built as a 22-level immutable DAG where every Array has
two edges to the same child. The exact live-main `display` recursively rendered both
edges every time and had no total-output budget. A new regression expecting `E_LIMIT`
failed against exact pre-change `src/wasm-host.mjs` Git blob
`67a888725867958141e7fe4b71b69f379e96e313`; the old implementation returned the full
expanded string. A second new regression expecting `metrics.display_ms` also failed,
because `execute` measured `readValue` and `display` together as `decode_ms`.

The acceptance case verifies ordinary Array/Record/Text formatting and renders a Text
containing exactly 4 MiB of backslashes. Its escaped output is 8 MiB plus two quotes,
showing the new cap does not reject the worst-case escaped form of one legal Text value.

## Change

`display` now has a 16 MiB rendered UTF-8 budget. Scalar and punctuation bytes are
accounted as traversal proceeds. Aggregate strings are only joined after descendants
have consumed the budget, so a repeated DAG is interrupted before its complete textual
expansion is built. Existing depth truncation at 64 levels remains unchanged. Crossing
the byte budget raises `E_LIMIT` rather than returning a partial string.

`execute` now times `readValue` and `display` separately:

- `decode_ms`: Wasm result graph validation/decoding only;
- `display_ms`: conversion of the decoded host value into TT textual output.

No Wasm bytes, ABI fields, runtime functions, checker judgments or emitter behavior are
changed.

## Local evidence

Node 22.16.0 / V8 12.4.254.21-node.26 / Linux x64:

    node --test tests/display-integrity.test.mjs
    # exact old host + new tests: 1/3 passed; two expected regressions failed
    # changed host: 3/3 passed

    npm test
    # 131/131 passed

    npm run verify
    # 131 tests, four examples, README, standalone Wasm, compiler work gates,
    # and the 1,000-element map/fold engine-stage check passed

    npm run bench -- --sizes 500,1000,2000 --samples 11 --output <local-json>
    # compiler work gates passed

    npm run bench:runtime -- <local-json>
    # checksum 500500; 11 samples; 100 calls/sample

The full workspace was reconstructed locally because outbound public DNS prevented a
fresh clone. The changed production host baseline was exact current-main bytes before
modification. This is not cross-engine/platform qualification.

## Cost evidence

`benchmarks/display-output-integrity.json` alternates exact pre-change and changed
renderer functions for 11 host-only samples after three warmups. The workload is an
already-decoded Array of 100,000 distinct BigInt values, excluding Wasm validation,
Module/Instance construction, execution and result decoding. Medians in this run were
11.373 ms before and 7.490 ms after. Individual samples vary substantially, so no
general speedup is claimed; the data only shows no obvious cost explosion on the flat
case while establishing the new bounded-output behavior adversarially.

## Limitations and next work

The 16 MiB limit is a host textual-output policy, not a language value-size limit and
not a hostile-module sandbox. `readValue` still has its own independent graph/arena
bounds. The renderer deliberately repeats shared values in text rather than inventing
pointer/reference syntax.

Persistent decoded values and returned closures still have no supported ownership
across a subsequent `main` call, and closures are not host-callable. Next define that
lifetime/ownership boundary with explicit invalidation and tests before exposing any
callable closure ABI.
