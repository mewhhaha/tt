# Iteration: persistent host snapshots without live instance authority — 2026-09-17

## Baseline and provenance

Live main was read as `4363236f8aec1b5f8410795be65e670b66261ef3` (`Bound Wasm result display output`) before work. `AGENTS.md`, `docs/STATUS.md`, `docs/DESIGN.md`, `docs/WASM.md`, `docs/ROADMAP.md`, `docs/LOCAL_DEVELOPMENT.md`, `docs/PRODUCTION_READINESS.md`, recent status/iteration notes and recent commits were inspected. Current main contained only the supported Node/Wasm implementation.

A direct local `git ls-remote https://github.com/mewhhaha/tt.git refs/heads/main` attempt failed with `Could not resolve host: github.com`, so the runnable workspace was reconstructed from the current Node/Wasm sources. The production file changed by this iteration, `src/wasm-host.mjs`, was reconstructed byte-for-byte and matched live-main Git blob `d922c04e913098269233f516e61d92efb67b5c06` before editing. Some unchanged files in the broad reconstructed workspace are semantically reproduced text rather than a clean checkout; therefore broad test counts are not presented as clean-clone qualification.

## Falsifiable hypothesis

A successful `execute()` result can be made persistent and non-authoritative by copying/finalizing immutable host snapshots and withholding its internal `WebAssembly.Instance`, while preserving real Wasm execution, output, current ABI validation, graph validation, sharing, limits and metrics.

## Regression-first result

Command:

`node --test tests/host-snapshot.test.mjs`

With the exact pre-change host restored, the four new tests produced 0 passed / 4 failed. After the implementation, the same command produced 4 passed / 0 failed.

The tests require:

1. nested Arrays/Records and their backing vectors are frozen and mutation attempts throw;
2. `execute` has no `instance` or `memory` property;
3. returned closures expose only frozen `{ kind: 'Closure' }` data and no pointer/index/capture/call authority;
4. a decoded snapshot is unchanged after the underlying Wasm memory is overwritten.

Existing tests that previously used `execute(...).instance` for low-level memory-capacity assertions were moved to the already-supported explicit `loadWasm` + `WebAssembly.Instance` boundary instead of weakening those assertions.

## Commands executed locally

Runtime provenance:

`node --version` -> `v22.16.0`

Regression and aggregate verification:

`node --test tests/host-snapshot.test.mjs` -> 4/4 after the change.

`node --test tests/cli.test.mjs tests/heap-lifetime.test.mjs tests/wasm.test.mjs` -> 19/19.

`npm test` -> 135/135.

`npm run verify` -> passed: repository Node/Wasm-only policy, syntax checks, 135 tests, four example source/artifact runs, README program, compiler work gates, 1,000-element map/fold engine-stage benchmark, standalone execution, and no `node_modules` requirement.

`npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-run12/compiler-bench.json` -> passed. Medians in this run:

- 500: wrappers 8.567 ms; records 5.976 ms; polymorphism 13.866 ms; refinements 4.379 ms; refinement_relations 4.309 ms.
- 1,000: wrappers 14.850 ms; records 11.500 ms; polymorphism 27.430 ms; refinements 8.003 ms; refinement_relations 9.585 ms.
- 2,000: wrappers 31.477 ms; records 24.426 ms; polymorphism 69.347 ms; refinements 17.244 ms; refinement_relations 20.391 ms.

`npm run bench:runtime -- /mnt/data/tt-run12/runtime-bench.json` -> passed; 1,000-element map/fold checksum `500500`, 11 samples, 100 calls/sample.

Matched host snapshot microbenchmark -> 100,000-Int Array median 6.145 -> 6.546 ms; 20,000 empty aggregate children 3.357 -> 6.051 ms. Raw samples are committed as `benchmarks/host-snapshot-integrity.json`; no general speed claim is made.

## Scope and next step

The checker/emitter/Wasm runtime/ABI bytes are unchanged. This iteration defines only the copy-out/persistent snapshot side of the host lifetime boundary. Host-callable closure ownership remains deliberately unsupported. Next work should design that boundary without exposing raw Wasm pointers/table indices, or choose another bounded memory-management integrity improvement if a smaller proof obligation is available first.
