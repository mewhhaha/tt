# Iteration: high-level host result ownership

Date: 2026-09-17

## Scope

Bounded runtime ownership step: remove the compiled `WebAssembly.Module` from persistent high-level execution results. Do not add a callable-closure ABI in this iteration.

## Acceptance / rejection / adversarial checks

Acceptance:

- ordinary `execute` still returns the same TT value/output/metrics/fuel;
- `run` still returns compiled Wasm bytes plus the detached execution result;
- `loadWasm` still exposes a module to explicit low-level callers.

Rejection/adversarial:

- retained `execute` graphs must not contain WebAssembly Module/Memory/Table/Global objects or function authority;
- returned closures remain opaque descriptors with no module/pointer/index/call authority;
- the new result-shape tests fail when the prior `module: loaded.module` property is restored.

## Commands and results

```text
git clone --depth 1 https://github.com/mewhhaha/tt.git /mnt/data/tt-live
# failed: Could not resolve host: github.com

node --test tests/host-snapshot.test.mjs
# pre-change behavior: 3 passed, 2 failed
# changed behavior: 5 passed, 0 failed

npm test
# 136 passed, 0 failed

npm run verify
# PASS: repository policy, 136 tests, examples, README, standalone Wasm,
# compiler 500/1000/2000 work gates, and 1000-element engine-stage benchmark

npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-run13/compiler-bench.json
# all deterministic work gates passed

npm run bench:runtime -- /mnt/data/tt-run13/runtime-bench.json
# checksum 500500; 11 samples; 100 calls/sample
```

Matched retention-cost harness: 200 high-level executions/sample, 2 warmups, 11 alternating samples. Median 30.583 ms with the prior result shape and 29.357 ms with the detached result shape; raw timing is noisy and is not a speed claim. The prior shape retained 200 Module references for 200 stored results; the changed shape retained zero.

## Provenance / limitations

Live main was reread immediately before publication and remained `b156bceb04abb0d41643e54885397b03e595c1e6`. Exact current production host blob before the change: `19907d47a0f84c46200875ca65e7e45d27e3101f`.

Public DNS remained unavailable to the local execution sandbox, so a clean clone could not be obtained. Verification used a coherent Node/Wasm workspace reconstructed from live repository content. The production file changed here was sourced from the exact live blob; some unmodified local reconstruction files were semantically reproduced rather than byte-identical. This evidence is not cross-platform or clean-checkout qualification.

## Next

Design the host-callable closure ownership boundary only after defining rooted handles, copied arguments/results, explicit release/invalidation, fuel/error semantics, and a rule that raw linear-memory pointers and table indices never become public authority. If that remains too broad for one iteration, continue with another falsifiable memory-management integrity step.
