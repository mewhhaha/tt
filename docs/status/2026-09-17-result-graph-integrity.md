# Status delta — 2026-09-17 — result graph integrity

Current main remains a dependency-free Node.js compiler with WebAssembly as the only executable output. This iteration changes only host-side result decoding; emitted Wasm bytes, the ABI version, public exports, TT evaluation semantics, compiler checking and runtime helper code are unchanged.

The host decoder now validates the complete reachable result graph before exposing even opaque closures. Closure capture arrays are range-checked and traversed, so an invalid or cyclic capture can no longer hide behind the `<fn>` display. Arrays, records and closures also have their runtime-maintained nesting-depth header checked against the recursively decoded graph. Scalar count fields and aggregate reserved fields are rejected when they contradict the documented value layout.

The four new adversarial tests all failed against the exact pre-change `src/wasm-host.mjs` blob `9b922a855c8f97fecee862c15bb46c892b029a33` and pass with the new decoder. Local Node 22.16.0 / Linux evidence on the recovered Node/Wasm workspace with exact current `compiler.mjs`, `wasm.mjs`, `wasm-runtime.mjs` and pre-change host baselines reconstructed from GitHub:

- `npm test`: 104/104 passed after adding the four result-integrity regressions.
- `npm run verify`: passed the same 104 tests, four example source/Wasm round-trips, README execution, standalone Wasm execution, 500/1,000/2,000 compile-work gates and the 1,000-element map/fold engine-stage check.
- `npm run bench -- --sizes 500,1000,2000 --samples 11 --output benchmarks/run8-compile.json`: passed; `npm run bench:runtime` passed checksum 500500 with 11 samples and 100 calls/sample. No compiler/runtime speed claim is made because the emitter and Wasm runtime are unchanged and the workspace is reconstructed rather than a fresh network clone.
- A matched host-decoder microbenchmark used identical synthetic flat Int arrays and 11 alternating samples per version. At 100,000 elements the pre-change median was 18.957 ms and the new decoder median was 19.963 ms; smaller samples were dominated by host noise and moved in both directions. Raw samples are in `benchmarks/result-decoder-integrity.json`; no speedup is claimed.

This closes one allocator/host-lifetime validation gap but does not add GC, reclamation, persistent host objects, host-callable closures, allocation-start provenance, hostile-module isolation or ownership typing. A forged module can still construct internally self-consistent metadata. Production-readiness gates remain open.
