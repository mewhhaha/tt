# TT — Node.js compiler, WebAssembly-only output

TT is a research compiler for a structural functional language with bounded integer
refinements. **The compiler is JavaScript running in Node; programs compile only
to real WebAssembly.** No custom-bytecode VM, source interpreter, JavaScript output
or native output is part of the active compiler.

No C++, Python, package installation, external solver or CI artifact is needed.
Local verification uses Node 22.16.0 on Linux x86_64. Node 22+ is intended; other
platforms and engines are not yet qualified. **This is not production-ready.**

## Local commands

```sh
node src/cli.mjs check examples/refinements.tt --metrics
node src/cli.mjs run examples/records.tt
node src/cli.mjs build examples/higher_order.tt -o program.wasm
node src/cli.mjs exec program.wasm
npm test
npm run verify
```

No `npm install` is necessary. Without npm, use `node scripts/verify.mjs`.
`check` does not emit code; `build` does not execute the program; `run` compiles and
executes Wasm. The saved `.wasm` runs without TT source. Pure modules have no imports;
closures, arithmetic, map/fold and aggregate operations execute inside Wasm.
JavaScript host code only validates, instantiates and decodes the result.

## Language example

```blot
const Small = Int where self >= 0 && self < 100;
const Positive = Int where self > 0;
let increment :: Small -> Positive = fn x => x + 1;
let input :: Small = 41;
return increment input;
```

This checks and returns `42`; input `100` is rejected with E_REFINEMENT. Function
contracts concern normal returns, not termination or freedom from runtime traps.
Unannotated functions infer structural requirements and support let polymorphism:

```text
let getX = fn value => value.x;
let a = getX { .x = 42; .name = "point"; };
let b = getX { .x = true; };
return { .a = a; .b = b; };
```

Refinement evidence also follows simple generic relationships without rechecking the
function body at each call. Identity, structural projection, record packaging and
higher-order application can transport a caller's evidence:

```text
const Positive = Int where self > 0;
let id = fn x => x;
let apply = fn f => fn x => f x;
let answer :: Positive = apply id 42;
return answer;
```

Passing a positive-only function through `apply` preserves that precondition; it
does not broaden the callable to `Int -> Int`. Symbolic arithmetic relations such
as proving `fn x => x + 1` from an arbitrary caller interval remain future work.

Curried/higher-order functions, captured closures, arrays/map/fold, records,
conditionals, short-circuit logic and exact signed-i64 arithmetic are implemented.
Syntax is Blot-inspired, not compatible: semicolons and `do { ... }` are deliberate.
`const` currently defines type aliases, not arbitrary compile-time programs.

## API

```js
import { compile, check, execute, run } from './src/compiler.mjs';
check('return 42;');
const { wasm } = compile('return 40 + 2;');
console.log(WebAssembly.validate(wasm)); // true
console.log(execute(wasm).value);        // 42n
console.log(run('return 42;').output);   // "42"
```

A standard engine can instantiate the artifact directly with no imports. The
provisional ABI exports `main`, `memory` and budget/diagnostic helpers. `main`
returns a pointer to a tagged value, not directly to a host object. See
[Wasm ABI](docs/WASM.md). There is no embedded interpreter or required JavaScript
arithmetic shim. Generic values are boxed and fields use linear lookup: this is a
simple baseline, not a claim of optimized runtime performance or a stable public ABI.

## Checking and compilation

`syntax.mjs` parses an arena; `types.mjs` performs row unification and let
polymorphism; `refine.mjs` checks bounded interval sets, branch facts and callable
contracts. Ordinary generic bodies are not rechecked at every call. `wasm.mjs`
emits real functions/branches directly; `wasm-runtime.mjs` emits Wasm helpers;
`wasm-host.mjs` loads modules and decodes their output. No npm dependencies exist.

The local 102-test suite includes 191,751 structural/refinement kernel assertions,
2,020 i64 boundary/generated arithmetic cases, source/refinement rejections, closure
capture tests, atomic builds, malformed modules, fuel checks and standalone execution.
Six obsolete VM kernel checks were removed; Wasm-specific cases replace them rather
than reusing the old assertion count. Counts are not a soundness proof.

Compile-scaling benchmarks separately record parser/checker/refinement/emitter and
Wasm-validation phases. Runtime benchmarks separate Module/Instance creation and
execution. See [performance](docs/PERFORMANCE.md) and [status](docs/STATUS.md).

**Open milestones:** effects, variants, recursion, modules, nominal declaration
evidence, ownership, general compile-time evaluation, incremental compilation,
optimized memory management, public host-callable closures and ABI stability.
Refinement transport is intentionally bounded: direct parameter/projection/application relationships are supported, while general symbolic arithmetic and container primitives remain conservative. A fuel counter/digest is not
a hostile-code sandbox. Do not run untrusted Wasm in a shared Node process.

Legacy C++ files, when present in the repository, and old Node bytecode evidence
are historical reference only. Old TTBC artifacts are not supported. See
[design](docs/DESIGN.md), [syntax](docs/SYNTAX.md), [local workflow](docs/LOCAL_DEVELOPMENT.md),
[roadmap](docs/ROADMAP.md), and [unchanged production gates](docs/PRODUCTION_READINESS.md).
