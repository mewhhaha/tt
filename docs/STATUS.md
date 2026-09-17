# TT status — Node compiler / Wasm-only output — 2026-09-17

**Research prototype, not production-ready.** Current supported implementation is
local dependency-free Node ES modules; TT executes only as emitted WebAssembly.
No native/Python implementation, package installation, CI artifact or host TT
interpreter is required. The production-readiness checklist is unchanged.

## Latest implemented slice

Source modules now have explicit relative imports and returned-record exports.
Dependencies are parsed/initialized once per main invocation, with canonical
identities, private lexical names, bounded acyclic graphs and source diagnostics.
The compiler's project API consumes source Maps or explicit synchronous resolvers;
only the opt-in CLI file provider reads local files. This is whole-program module
assembly, not separate compilation or incremental interface caching.

Nominal operation declarations, inferred finite effect/call summaries, synchronous
scoped handlers and explicitly supplied host operations are implemented. Pure
handlers run entirely in Wasm with no imports. Host wrappers import typed functions
from `tt.host` and require an explicit callback Map. Scalar/refined results are
validated before use; callbacks receive copied values, not memory/closure authority.

Effects are retained through supported higher-order calls and discarded results.
Pure arrow annotations cannot erase requirements. Handler implementations retain
refinement checks, including deferred checks for generic handler parameters. The
previous deferred-call precondition regression suite remains unchanged and passes.

This is **not** a general resumable algebraic effect system: continuation capture,
resume/abort/multi-shot behavior and asynchronous host calls remain unimplemented.
See [MODULES_EFFECTS.md](MODULES_EFFECTS.md) for the exact accepted fragment, limits,
conservative cases, import initialization order and host trust contract.

## Exercised applications

- `examples/effects-workflow`: shared batch transformation/service modules, pure
  deterministic Scale/Clock/Save/Emit handlers, and explicit host clock/log/save
  callbacks. Pure total is 90; deterministic test clock yields elapsed 1 in host
  mode. The example save callback records a value in host memory, not a database.
- `examples/effects-simulation`: structural movement systems, shared scene, refined
  step/input operations, pure handlers and checked host callbacks. Both modes
  produce positions 17/17 and checksum 34. Invalid host input is rejected before
  reporting. This is a one-step simulation, not the complete systems-only ECS.

## Fresh local evidence

Baseline main: `09eb97c5a8da7eaf97e039300ba5ab713f64295d`.
Environment: Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64.
All execution was local, with no dependency installation, Python, native compiler,
network-dependent checking or CI result substituted for a local run.

- Exact baseline production sources plus existing tests: 155/155 passed.
- Updated suite: **202/202 passed**, including 47 new module/effect/application,
  negative/adversarial and cost tests; existing tests were not weakened.
- `npm run verify`: passed repository policy, JS syntax checks, 202 tests, all four
  original source/saved-Wasm examples, README, standalone Wasm execution, existing
  five-workload compiler gates at 500/1000/2000 and map/fold engine-stage checks.
  It now also runs the module/effect scale gates and both explicit host runners.
- Explicit compiler, runtime and module/effect benchmark commands passed, with 11
  samples and separate phase measurements. Runtime checksum stayed 500500.
- Nine existing pure single-source programs produced byte-identical Wasm against
  the exact pre-change compiler. Pure-handler examples have zero imports; host
  manifests contain only their explicit typed operation imports.

All baseline production and executed existing test/harness inputs were recovered
from the pinned repository and checked by Git blob hashes. This is not a network
clone or cross-platform qualification. `benchmarks/modules-effects-inputs.json`
records final executed-input hashes; `benchmarks/modules-effects.json` retains raw
samples and workload identities. Detailed results/commands are in
[the iteration note](iterations/2026-09-17-modules-effects.md).

## Performance boundary

New module/effect workloads have deterministic work/size gates. Local medians for
500/1000/2000 discarded effect calls were 10.125/17.719/32.217 ms; diamond module
graphs with 32/64/128 branches measured 4.518/4.569/8.271 ms. These are warm local
parse/check/emit/validate observations, not a matched speedup or whole-compiler
complexity proof. The phase data separates effect analysis from refinement checking.
Host callback time is recorded separately but is nested inside Wasm execute time.

## Remaining gates

General effect rows/continuations, variants/recursion, static execution/reflection,
nominal descriptor providers and the real ECS slice, exported callable ownership,
GC/reclamation, separate/incremental compilation and stable ABI remain open.
Effect-aware fold currently requires scalar accumulators; qualified effect rows,
host Text/aggregate results and async callbacks are not supported. Host capabilities
are trusted synchronous code and their duration is not bounded by TT fuel. Digests
and decoder integrity checks are not a hostile-module sandbox.

Next useful work: broaden a documented conservative effect/container case with
regressions, then variants/recursion and stable declaration evidence. Do not equate
these two example applications or passing tests with production readiness.
Historical evidence remains in the dated status/iteration notes and benchmark data.
