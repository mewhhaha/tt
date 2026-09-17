# Iteration: UTF-8 record-label display accounting

Date: 2026-09-17

## Scope

Bounded host-output integrity step: make the existing 16 MiB display budget count multibyte record labels in UTF-8 bytes. Do not change result validation/decode, the Wasm ABI/runtime, or introduce a callable-closure interface.

## Acceptance / rejection / adversarial checks

Acceptance:

- ordinary record labels, including `€x`, retain exact textual output;
- exact rendered byte length for the ordinary multibyte example is asserted;
- all existing display, decode, runtime, source-provenance, snapshot, and Wasm tests continue to pass.

Rejection/adversarial:

- a 1,300,000-character euro-sign label remains below the 4 MiB input-scale bound;
- five repeated renderings of that record exceed 16 MiB in UTF-8 and must raise `E_LIMIT`;
- the exact pre-change host fails this regression by returning the oversized string instead of rejecting it.

## Commands and results

```text
cd /mnt/data/tt-run14/min && node --test display-unicode.test.mjs
# exact pre-change host: 1 passed, 1 failed (Missing expected exception)
# changed host: 2 passed, 0 failed

cd /mnt/data/tt-run14/repo && npm test
# 137 passed, 0 failed

cd /mnt/data/tt-run14/repo && npm run verify
# PASS: repository policy, 137 tests, four examples, README, standalone Wasm,
# compiler 500/1000/2000 work gates, and 1000-element engine-stage benchmark

cd /mnt/data/tt-run14/repo && npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-run14/compiler-bench.json
# all deterministic compiler work gates passed

cd /mnt/data/tt-run14/repo && npm run bench:runtime -- /mnt/data/tt-run14/runtime-bench.json
# checksum 500500; 11 samples; 100 calls/sample

cd /mnt/data/tt-run14/display-bench && node bench.mjs
# ASCII median: 12.555 -> 13.966 ms
# multibyte-label median: 17.322 -> 19.084 ms
```

## Provenance / limitations

Exact pre-change live `src/wasm-host.mjs` Git blob: `89cf354a67868cad6bf1d6885c199f479f1cc5da`. Its locally reconstructed file hash matched that blob before the regression was run.

Public DNS remained unavailable (`Could not resolve host: github.com`), so a clean clone could not be obtained. The production `src` baseline was reconstructed from live GitHub blobs and all unmodified source hashes were checked byte-for-byte; some unmodified tests/harness files in the broad local workspace were semantically reproduced rather than byte-identical. Treat 137/137 as local reconstructed-workspace evidence, not clean-checkout/cross-platform qualification.

The matched display benchmark measures `display()` only on already-decoded host values. It does not measure checking, Wasm emission, validation, Module/Instance construction, Wasm execution, or result decoding.

## Next

Return to the host-callable closure ownership boundary: opaque rooted handles, copied arguments/results, explicit release/invalidation, bounded fuel/error behavior, and no raw linear-memory pointer or table-index authority. If that remains too broad for one iteration, take another falsifiable ownership/memory-management integrity step first.
