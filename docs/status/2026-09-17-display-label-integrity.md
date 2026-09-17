# 2026-09-17: account record labels by UTF-8 display bytes

## Hypothesis

The 16 MiB host display limit is documented and implemented as a UTF-8 byte limit, but record-label prefixes were charged with JavaScript string length. A multibyte label could therefore produce materially more UTF-8 output than the accounting budget allowed. Charging record prefixes with `Buffer.byteLength` should make the limit match the rendered byte stream without changing validation, decoding, checking, emission, the Wasm ABI, or generated Wasm.

The falsifiable regression is a record label made from 1,300,000 euro-sign characters: the label itself remains within TT's 4 MiB source/text-scale bound, while five references render more than 16 MiB of UTF-8 output. The pre-change host should incorrectly allow the rendering; the changed host must reject it with `E_LIMIT`.

## Change

`src/wasm-host.mjs` now charges each record display prefix (`.<label> = `) using `Buffer.byteLength(prefix)` rather than the default `String.length`. Existing Text display already charged the escaped text with `Buffer.byteLength`, and all remaining default-accounted fragments are ASCII punctuation, booleans, decimal BigInts, Unit, or `<fn>`.

`tests/display-integrity.test.mjs` adds:

- acceptance for an ordinary multibyte record label and an exact UTF-8 output-byte assertion;
- rejection for repeated rendering of a large multibyte-label record that exceeds the 16 MiB display budget.

No checker, refinement, Wasm emitter/runtime, ABI, validation, Module/Instance construction, execution, or decode behavior changed.

## Regression-first evidence

Exact pre-change production host Git blob: `89cf354a67868cad6bf1d6885c199f479f1cc5da`.

Targeted local command:

```text
cd /mnt/data/tt-run14/min && node --test display-unicode.test.mjs
```

Against the exact pre-change host: 1/2 passed; the adversarial test failed with `Missing expected exception.` After the one-line accounting fix: 2/2 passed.

## Local verification

Environment: Node v22.16.0, V8 12.4.254.21-node.26, Linux x64. Commands executed locally after the change:

```text
cd /mnt/data/tt-run14/repo && npm test
cd /mnt/data/tt-run14/repo && npm run verify
cd /mnt/data/tt-run14/repo && npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-run14/compiler-bench.json
cd /mnt/data/tt-run14/repo && npm run bench:runtime -- /mnt/data/tt-run14/runtime-bench.json
cd /mnt/data/tt-run14/display-bench && node bench.mjs
```

Results:

- `npm test`: 137/137 passed.
- `npm run verify`: repository policy passed; 137/137 tests passed; four examples passed from source and saved Wasm; README execution passed; standalone Wasm execution passed; compiler work gates at 500/1000/2000 passed; and the separate 1000-element map/fold engine-stage check passed.
- explicit compiler benchmark: all five workloads passed deterministic work gates at 500/1000/2000.
- explicit runtime benchmark: checksum 500500, 11 samples, 100 `main` calls per sample.

Outbound public DNS remained unavailable, so the broad verification workspace was reconstructed rather than freshly cloned. All nine unmodified production `src/*.mjs` files were reconstructed byte-for-byte from live Git blobs; several unmodified test/harness/document files were semantically reproduced rather than byte-identical. The 137/137 result is therefore reconstructed-workspace evidence, not clean-checkout or cross-platform qualification.

## Cost evidence

`benchmarks/display-label-integrity.json` contains 3 warmups and 11 alternating host-only samples on already-decoded values with 50,000 repeated record renderings. Output was checked for exact equality before/after.

- ASCII label workload (850,000 rendered UTF-8 bytes): median 12.555 ms before, 13.966 ms after.
- multibyte label workload (1,000,000 rendered UTF-8 bytes): median 17.322 ms before, 19.084 ms after.

The extra `Buffer.byteLength` call is expected accounting cost. Samples are local/noisy; no general runtime-performance claim is made. Checking/emission/Wasm execution and decode are outside this benchmark boundary.

## Remaining boundary

This closes one host output-budget mismatch only. Production readiness remains open, including the explicit host-callable closure ownership/lifetime interface, reclamation/GC, variants/recursion, modules, nominal evidence, effects/staging, cross-engine/platform qualification, sustained fuzzing/differential testing, and the systems-only ECS slice.
