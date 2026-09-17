# Status delta — 2026-09-17 — Wasm allocation-start integrity

Current main remains a dependency-free Node.js compiler with WebAssembly as the only executable output. This iteration changes only host-side result validation; the checker, direct Wasm emitter, in-module runtime helpers, public exports and ABI version remain unchanged.

The prior result decoder required aligned pointers inside the static pool or successful-run live heap, but did not prove that a pointer was the start of an allocated boxed value. An aligned interior address could therefore be interpreted as a different valid header. In the smallest concrete counterexample, an Int object's zeroed header words at `pointer + 8` looked like an empty Unit value.

The decoder now derives allocation-start provenance from the existing contiguous static pool and bump-allocation arenas. It lazily walks an arena only through the largest referenced pointer, using the exact documented size rule for each tag and an 8-byte stride bitset to mark real object starts. Every decoded pointer must be in that set. The successful-run live-heap watermark bounds dynamic scanning; older ABI-2 modules whose lifetime word is zero retain the existing compatibility path for dynamic values. Static-pool starts are still checked. The decoder also rejects a static heap boundary that does not fit the instantiated memory.

Regression-first evidence used the exact live-main pre-change `src/wasm-host.mjs` blob `0190ad5c51d3ee47c1d4fd5b048467a0da9c793d`. The two new interior-pointer regressions failed against it because the old decoder accepted both forged aligned addresses. With the change, the expanded result-integrity file passes 8/8, including the existing closure/nesting/header tests, dynamic and static interior-pointer rejection, lazy handling of later unreachable arena bytes, and the static-heap bound check.

Local Node 22.16.0 / Linux evidence in the reconstructed Node/Wasm workspace with exact current backend production files:

- `node --test tests/result-integrity.test.mjs`: 8/8 passed.
- `npm test`: 115/115 passed.
- `npm run verify`: passed those 115 tests, four example source/Wasm round-trips, README execution, standalone Wasm execution, 500/1,000/2,000 compile-work gates and the 1,000-element map/fold engine-stage check.
- `npm run bench -- --sizes 500,1000,2000 --samples 11 --output benchmarks/run9-compile-optimized.json`: passed; `npm run bench:runtime` passed checksum 500500 with 11 samples and 100 calls/sample.

The 115-test workspace is not claimed as an exact clean-checkout current-main aggregate: outbound public DNS remains unavailable, so the unchanged frontend comes from the recovered Wasm handoff while the backend files and relevant current tests were reconstructed from live GitHub. The changed production host file is based on the exact current blob above.

A matched host-decoder microbenchmark alternated the exact pre-change and new decoder for 11 samples over contiguous dynamic Int arenas. Medians were 0.198 -> 0.209 ms at 1,000 values, 0.360 -> 0.580 ms at 10,000, and 5.117 -> 6.156 ms at 100,000. The 100,000-value delta is about +1.04 ms / +20%; smaller measurements are noisy. This is host decode cost only, not checking, Wasm emission, engine compilation/instantiation, or execution, and no general performance claim is made. Raw samples are in `benchmarks/allocation-start-integrity.json`.

This closes the aligned-interior-pointer gap for compiler-generated current artifacts, but it is not GC, ownership, authentication, or hostile-module sandboxing. A deliberately forged module can still lie about its allocator discipline, and older ABI-2 dynamic results without a live watermark intentionally keep the compatibility fallback. Production-readiness gates remain open.
