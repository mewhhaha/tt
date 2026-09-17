# 2026-09-17: detach high-level host results from compiled engine objects

## Hypothesis

`execute` and `run` should be persistent copy-out APIs: successful high-level results can contain detached TT values, text output, metrics, remaining fuel, and copied Wasm bytes from `run`, but they do not need to retain a `WebAssembly.Module`. Callers that intentionally need an engine module already have the explicit low-level `loadWasm` API.

The falsifiable condition was that removing the module from `execute` would leave normal execution, standalone Wasm, validation, decoding, display, fuel behavior, and compiler work gates unchanged while making the persistent high-level result graph free of WebAssembly engine objects.

## Change

`src/wasm-host.mjs` no longer places `loaded.module` on the object returned by `execute`. The module is still constructed internally for instantiation and `loadWasm(wasm).module` remains the explicit low-level route for callers that deliberately manage engine objects.

`tests/host-snapshot.test.mjs` now checks that:

- `execute` returns exactly `value`, `output`, `metrics`, and `remaining_fuel`;
- the retained high-level result graph contains no `WebAssembly.Module`, `Memory`, `Table`, `Global`, or function authority;
- `loadWasm` still exposes a module for deliberate low-level use;
- `run` inherits the detached execution boundary while retaining only its copied Wasm byte buffer;
- opaque returned closure snapshots continue to expose no module authority.

No checker, refinement, emitter, in-module runtime, ABI, Wasm export, or generated-Wasm change was made.

## Regression-first evidence

On the locally reconstructed pre-change host behavior (the only semantic difference was restoring `module: loaded.module` to the `execute` return object), the updated host-snapshot suite passed 3/5 and failed the two new ownership assertions. Command:

```text
node --test tests/host-snapshot.test.mjs
```

The changed host passed 5/5.

The production change itself was formed from the exact live-main `src/wasm-host.mjs` blob `19907d47a0f84c46200875ca65e7e45d27e3101f`; the local offline workspace is reconstructed because `git clone https://github.com/mewhhaha/tt.git` still fails with `Could not resolve host: github.com`.

## Local verification

Environment: Node v22.16.0, V8 12.4.254.21-node.26, Linux x64. Exact commands executed locally:

```text
npm test
npm run verify
npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-run13/compiler-bench.json
npm run bench:runtime -- /mnt/data/tt-run13/runtime-bench.json
```

Results:

- `npm test`: 136/136 passed.
- `npm run verify`: 136/136 passed, repository policy passed, all four examples passed from source and saved Wasm, README execution passed, compiler work gates at 500/1000/2000 passed, the separate 1000-element map/fold engine-stage benchmark passed, and standalone execution from an empty working directory passed.
- explicit compiler benchmark: all five workloads passed deterministic work gates at 500/1000/2000.
- explicit runtime benchmark: checksum 500500, 11 samples, 100 `main` calls per sample.

Because outbound public DNS is unavailable, the broad workspace was reconstructed from live repository content rather than obtained by a fresh clone. The changed production host file was sourced from the exact live blob; other unmodified local files were in several cases semantically reconstructed rather than byte-identical. The 136/136 result is therefore local reconstructed-workspace evidence, not clean-checkout or cross-platform qualification.

## Cost evidence

A matched host-only retention measurement used the same compiled `return 1+2;` Wasm bytes, 2 warmups, 11 alternating samples, and 200 `execute` calls per sample. Raw samples are in `benchmarks/host-result-ownership.json`.

- pre-change retained module references per 200 stored results: 200;
- changed retained module references: 0;
- median elapsed time for 200 calls: 30.583 ms before, 29.357 ms after.

Timing samples are noisy and include loading, module/instance construction, execution, decoding, and display, so no speedup claim is made. The deterministic result is the ownership change: high-level retained results no longer keep compiled engine modules alive.

## Remaining boundary

This does not create a host-callable closure ABI, reclamation, GC, or hostile-module sandbox. A future callable interface still needs an explicit rooted handle, call operation, release/invalidation semantics, fuel/error behavior, and copied argument/result ownership without exposing raw Wasm pointers or table indices.
