# TT — Node.js compiler, WebAssembly-only output

TT is a research compiler for a structural functional language with bounded integer
refinements, source modules and synchronous scoped effects. **The compiler is
JavaScript running in Node; programs compile only to real WebAssembly.** There is
no TT bytecode VM, source interpreter, JavaScript output, native output or required
package installation. **This is not production-ready.**

## Local commands

```sh
node src/cli.mjs check examples/refinements.tt --metrics
node src/cli.mjs run examples/records.tt
node src/cli.mjs build examples/higher_order.tt -o program.wasm
node src/cli.mjs exec program.wasm
node src/cli.mjs run examples/effects-workflow/pure.tt
node examples/effects-workflow/run.mjs
node examples/effects-simulation/run.mjs 2 1
npm test
npm run verify
```

Node 22+ is the intended host; local evidence currently uses Node 22.16.0 on Linux.
No `npm install`, Python, native compiler, CI artifact or hosted checker is required.
Without npm, use `node scripts/verify.mjs`. `check` does not emit code, `build` does
not run TT code, and `run` compiles and executes Wasm. Saved modules need no TT source.

## Structural functions and refinements

```blot
const Small = Int where self >= 0 && self < 100;
const Positive = Int where self > 0;
let increment :: Small -> Positive = fn x => x + 1;
let input :: Small = 41;
return increment input;
```

This returns `42`; input `100` fails with `E_REFINEMENT`. A function contract describes
normal returns, not termination or freedom from traps. Unannotated functions infer
structural requirements and support let polymorphism:

```text
let getX = fn value => value.x;
let a = getX { .x = 42; .name = "point"; };
let b = getX { .x = true; };
return { .a = a; .b = b; };
```

Refinement evidence follows parameter identity, projections, packaging and selected
higher-order application relationships without rechecking source bodies. Executed-call
preconditions remain obligations even when callback results are discarded. General
symbolic arithmetic and container refinement summaries remain limited.

## Modules and scoped effects

A module exports its returned record. Imports are explicit, relative, source-only
and evaluated once per canonical path in dependency order:

```text
// operations.tt
// Declaring an operation does not perform it or grant host authority.
effect Clock :: Unit -> Int;
effect Emit :: Text -> Unit;
return { .Clock = Clock; .Emit = Emit; };
```

```text
// service.tt
let Ops = import "./operations.tt";
let run = fn ignored => do {
  let started = Ops.Clock ();
  let ignored = Ops.Emit "work complete";
  return Ops.Clock () - started;
};
return { .run = run; };
```

```text
// pure.tt: implementations execute entirely inside Wasm, with zero host imports.
let Ops = import "./operations.tt";
let Service = import "./service.tt";
return handle Ops.Clock with (fn ignored => 1000) in
  handle Ops.Emit with (fn message => ()) in
    Service.run ();
```

A host entry explicitly changes the implementations, not the service:

```text
let Ops = import "./operations.tt";
let Service = import "./service.tt";
return handle Ops.Clock with host Ops.Clock in
  handle Ops.Emit with host Ops.Emit in
    Service.run ();
```

The embedder must supply the matching capabilities; loading a module never grants
clock, logging, filesystem or network access automatically:

```js
import { compileProject, execute } from './src/compiler.mjs';
import { fileProject } from './src/project-files.mjs';
const project = fileProject('examples/effects-workflow/host.tt');
const built = compileProject(project.entry, project.read);
const saved = [];
const result = execute(built.wasm, {
  host: new Map([
    ['operations.tt::Clock', () => BigInt(Date.now())],
    ['operations.tt::Emit', message => { console.log(message); }],
    ['operations.tt::Save', total => { saved.push(total); }],
  ]),
});
console.log(result.output, saved);
```

The complete [batch workflow](examples/effects-workflow/README.md) shares its service,
transformation and operation modules between deterministic pure and host-backed runs.
It exercises diamond imports, records, higher-order map/fold, nested handlers, checked
host copying, and imported-file runtime diagnostics. The separate
[simulation example](examples/effects-simulation/README.md) uses refined host input
contracts around bare structural movement systems.

**These are synchronous, returning operation handlers, not general continuation
handlers.** There is no `resume`, abort/replay, multishot capture or async suspension.
Clauses execute outside their own binding, allowing forwarding to an outer handler.
Returned closures retain latent requirements; constructing a closure under a handler
does not handle a future call. Full effect/handler semantics remain a production gate.

[Module/effect semantics and limits](docs/MODULES_EFFECTS.md) describes inferred
requirements, closed effect-row annotations, module initialization order, host ABI
contracts, and conservative higher-order cases.

## API and implementation

```js
import { compile, check, execute, run, compileProject } from './src/compiler.mjs';
check('return 42;');
const { wasm } = compile('return 40 + 2;');
console.log(WebAssembly.validate(wasm)); // true
console.log(execute(wasm).value);        // 42n
console.log(run('return 42;').output);   // "42"
const sources = new Map([
  ['main.tt', 'let L=import "./lib.tt"; return L.answer;'],
  ['lib.tt', 'return {.answer=42;};'],
]);
console.log(execute(compileProject('main.tt', sources).wasm).value);
```

`syntax.mjs` parses an arena; `modules.mjs` joins a bounded dependency graph;
`types.mjs` does row unification; `effects.mjs` substitutes effect summaries;
`refine.mjs` checks interval contracts and call obligations. `wasm.mjs` emits real
Wasm control flow/functions; `wasm-runtime.mjs` and `wasm-effects.mjs` emit runtime
helpers and dispatch. `wasm-host.mjs` validates modules and copies out results;
`host-effects.mjs` validates/copies explicit external operations, not TT evaluation.

Pure artifacts have no imports. Host-backed artifacts import only declared,
machine-signature-checked operations from `tt.host`; closures, arithmetic and TT
collections still execute inside Wasm. See the [provisional ABI](docs/WASM.md) and
[extension contract](docs/MODULES_EFFECTS.md). Host callbacks are trusted synchronous
code: TT fuel does not bound their duration, and failed runs do not roll back I/O.

## Explicit no-GC owners (experimental)

`Owned T` provides isolated affine plain-data owners with lexical read borrows,
consuming updates, copied snapshots and deterministic whole-block reclamation.
Neither tracing garbage collection nor reference counting runs in the TT runtime.
Node's own memory management is separate. Existing ordinary values still use the
invocation arena; this is not ownership-by-default for all legacy code.

`let next = @update (@move current) with step;` transfers an owner. Read through
`@borrow current as view in body`; retain an independent version with
`@snapshot current`; copy data out and consume an owner with `@take (@move current)`.
`@evolve` repeats a checked data transformation with bounded reusable storage.

Run `node examples/ownership-frames/run.mjs pure` or select `host` for the
same 10,000-frame simulation using explicit Step/Axis callbacks. The retained initial
snapshot remains unchanged. See [ownership semantics and limits](docs/OWNERSHIP.md)
for unsupported captures, usage-polymorphic interfaces and allocation tradeoffs.

## Open milestones

Separate/incremental module checking, exported compile-time type values, general
row polymorphism, resumable algebraic handlers, variants, recursion, nominal provider
metadata, broader ownership and deterministic reclamation, static evaluation/tags, stable host-callable closures, and
cross-engine/platform qualification remain open. A closed digest or fuel counter is
not a hostile-code sandbox. Never run untrusted Wasm in a shared Node process.

Current main contains only Node/Wasm implementation files. Historical C++ and TTBC
notes/data remain provenance, not supported implementations or targets. See
[design](docs/DESIGN.md), [syntax](docs/SYNTAX.md), [local development](docs/LOCAL_DEVELOPMENT.md),
[roadmap](docs/ROADMAP.md), [status](docs/STATUS.md), and [production gates](docs/PRODUCTION_READINESS.md).

## Immutable array views and consuming writes

`@slice(xs, lo, hi)` and `@concat(a, b)` share immutable element storage.
`@get(xs, i)` reads through the bounded representation; `@materialize(xs)` explicitly
builds a flat pointer vector. Active owner loans cannot escape or overlap a consuming
write. `@set(@move owner, i, value)` reuses an isolated Int/Bool/Unit array cell, with
no new owner allocation in the default lowering. Snapshots still copy independently.

```sh
node examples/array-views/run.mjs pure
node examples/array-views/run.mjs host
node benchmarks/array-views.mjs array-report.json
```

General concatenation uses indirection, not contiguous zero-cost storage. See
[the exact costs and limits](docs/ARRAYS.md), and
[the locally verified iteration](docs/iterations/2026-09-18-array-views.md).
The ownership and array layers are included together in this commit. See
[publication verification](docs/iterations/2026-09-18-publish-ownership-arrays.md).
