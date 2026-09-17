# Local Node development; Wasm-only output

Node22+ is intended; recorded tests currently use Node22.16.0 on Linux. No installation
step, Python, native compiler, downloaded compiler, hosted checking or CI artifact is
required. There are no third-party dependencies.

```sh
npm test
npm run verify
npm run bench -- --sizes 500,1000,2000 --samples 11
npm run bench:runtime
npm run bench:effects
node src/cli.mjs run examples/effects-workflow/pure.tt
node examples/effects-workflow/run.mjs
node examples/effects-simulation/run.mjs 2 1
```

The direct verification equivalent is `node scripts/verify.mjs`. It runs repository
policy, syntax checking, all tests, four original examples, README execution, saved
standalone Wasm, existing compile/runtime gates, new module/effect gates, and both
host example runners. No install or CI step occurs. Benchmark files under local
output paths are generated evidence, not implementation inputs.

CLI check/run/build resolve relative source imports beneath the entry directory
using the explicit local file provider. `compileProject` can instead consume a Map
or caller-supplied synchronous resolver with another explicitly defined project root.
No implicit package/network resolution exists. Host-backed execution requires a Map
of callbacks in an embedding runner; CLI run/exec do not grant external services.

Build writes use an exclusive same-directory temporary and rename, preserving an
existing output after failure. No crash-durability/fsync guarantee is made. Output
must end in `.wasm` and cannot overwrite the source. Compilation never runs TT code;
run builds real Wasm and executes it. Saved modules need no original source files.

Profile with `node --cpu-prof src/cli.mjs check FILE.tt`. Keep startup, parsing,
structural checking, effect summaries, refinement checking, emission, engine
validation/compilation/instantiation, runtime, host decoding and display distinct.
host_ms is nested inside execute_ms. Repeated engines may cache or compile lazily;
RSS samples are not peak/live-set measurements. Never claim a general speedup from
an incomparable historical TTBC/C++ run.

CI is optional corroboration, never a replacement for local execution. Supported
platform claims must follow actual tests; no previous native sanitizer result
qualifies Node/Wasm. The current loader is not a hostile-code sandbox. All changes
must preserve the unchanged production-readiness obligations.
