# Local Node development; WebAssembly-only output

Node.js 22+ is the intended compiler host; this checkpoint is tested on Node 22.16.0,
Linux x86_64. No install step, Python, CMake, native compiler, CI download or external
solver is needed. There are no third-party packages. Other hosts remain unqualified.

    node src/cli.mjs check examples/refinements.tt --metrics
    node src/cli.mjs run examples/higher_order.tt
    node src/cli.mjs build examples/higher_order.tt -o program.wasm
    node src/cli.mjs exec program.wasm
    npm test
    npm run verify

Without npm: `node scripts/verify.mjs`. `run` executes generated Wasm, not a source
interpreter. Saved modules run without TT source; pure modules have no host imports.
See WASM.md to load them using the standard engine without this repository's runner.
The compiler is Node code, not a compiler that itself needs to be built to Wasm.

Verification checks JS syntax, tests positive/negative and generated cases, runs
examples and README code through Wasm, verifies standalone artifacts in a clean
process, and records separate checking/emission and engine-stage benchmarks.
Every compile call owns its arenas; this is not yet incremental compilation.

Build writes are atomic through an exclusive same-directory temporary file and
rename. Failures preserve existing outputs. The CLI refuses non-.wasm output names
and overwriting the source path. No fsync crash-durability guarantee is made.

    npm run bench -- --sizes 500,1000,2000 --samples 11
    npm run bench:runtime
    node --cpu-prof src/cli.mjs check examples/records.tt

Profiling changes the timing boundary. Separate Node startup, checking, emitting,
WebAssembly.validate, Module construction, Instance construction, runtime calls,
and result decoding. Engine code caches and lazy compilation affect repeated runs;
never present them as cold-engine timings. RSS observations are not peak live memory.

No CI result substitutes for local execution. No old C++ sanitizer result certifies
Node or Wasm. Retained C++ source and older evidence are historical only and do not
participate in this active workflow. Untrusted Wasm is not safe merely because it
has plausible metadata or a fuel export: see the explicit trust limitations.
