# 2026-09-17 — validate complete Wasm result graphs

Hypothesis: returned closures and aggregate nesting metadata can be validated transitively at the Node/Wasm boundary without changing generated Wasm, the ABI, or the public value surface, and without materially changing large-result decode cost.

The previous decoder returned `{ kind: 'Closure' }` after checking only the 16-byte closure header. It therefore did not inspect capture payload bounds or cycles. It also bounded arrays/records recursively but ignored the nesting-depth field that the in-Wasm `put` helper maintains to enforce the runtime value-nesting limit. The new decoder traverses closure captures without exposing them, applies the existing range/cycle/visit limits to those captures, and checks the declared aggregate nesting depth against the recursively decoded graph. Scalar count fields and non-closure aggregate reserved fields are checked as representation invariants. Closure function-table indices remain opaque because returned closures are still not a public host-callable ABI.

Regression-first evidence used the exact live-main pre-change host blob (`git hash-object` `9b922a855c8f97fecee862c15bb46c892b029a33`). All four new tests failed before the patch: out-of-lifetime closure capture, self-capturing closure cycle, aggregate depth mismatch, and malformed header fields were all accepted. All four pass after the change.

Local Node 22.16.0 / Linux commands and outcomes:

    npm test
    # 104/104 passed

    npm run verify
    # 104 tests, four examples, README, standalone Wasm, compile work gates,
    # and 1,000-element map/fold engine-stage check passed

    npm run bench -- --sizes 500,1000,2000 --samples 11 --output benchmarks/run8-compile.json
    npm run bench:runtime
    # both passed; runtime checksum 500500, 11 samples, 100 calls/sample

A matched synthetic decoder benchmark alternated the exact pre-change and new host functions for 11 samples at 1,000, 10,000 and 100,000 flat Int elements. The 100,000-element medians were 18.957 ms before and 19.963 ms after. Smaller cases were noisy enough to reverse ordering, so this is not evidence of a general slowdown or speedup. The emitted Wasm path is byte-for-byte unaffected by this host-only change.

The local full suite uses the recovered Node/Wasm handoff plus exact current backend files because outbound public DNS still prevents a fresh `git clone`. The current host baseline itself was reconstructed byte-for-byte and hash-matched before modification. Do not treat this run as cross-platform or clean-checkout qualification.

Next: define allocation-start provenance or another bounded way to distinguish valid object starts from aligned interior pointers, then continue the ownership/host-callable-closure boundary. Do not mistake decoder integrity for GC or hostile-module sandboxing.
