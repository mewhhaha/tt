# Fast emission and numeric regions

The implementation remains dependency-free Node.js and the sole executable target
is WebAssembly. These optimizations run after the existing structural, effect and
refinement checks. They do not change inferred requirements or recheck function
bodies at calls. This is a measured prototype improvement, not production readiness.

## Byte construction

The Wasm writer appends to a geometrically growing Buffer, copies byte spans in
bulk, and emits LEB operands directly. The common safe-integer signed path avoids
BigInt conversion; full i64 operands still use BigInt. `finish()` returns a copy of
exactly the initialized prefix, not spare capacity or an alias changed by appends.
The existing artifact-byte limit also bounds individual writer growth.

The public `uleb`/`sleb` helpers remain as independent encoders for differential
checks. A reference-mode build retains the prior machine bytes for the tested
accepted corpus despite the writer implementation change. No lexer or checker
shortcut is part of this iteration.

## Boxed boundaries, unboxed intermediate arithmetic

The default backend identifies adjacent integer arithmetic nodes, including an
arithmetic expression feeding an integer comparison. Internal results remain i64
values in Wasm operands/locals; the outer result is boxed once (or converted to the
existing Bool constant). No expression is reassociated or constant-folded by this
pass. Each intermediate operation still performs its signed overflow/zero checks.
Both raw helpers and boxed wrappers use `wasm-integers.mjs` as the single checked
binary-operation implementation.

For example, `(40*3+7)/2-1` previously created four dynamic Int boxes. It now creates
one; `(40+2)==42` needs none. Ordinary function arguments/results, captured values,
let bindings, record fields, arrays, operation arguments/results and handlers keep
the existing boxed ABI. Calls remain in their original order, even inside a numeric
region. There is no monomorphization, generic body specialization, escape analysis,
GC, new host authority or hidden interpreter.

Every original expression retains its source-position update and fuel tick. No
callback, effect, trap-producing arithmetic or discarded source expression is
removed. Rejection tests cover both optimization modes. Differential tests compare
successful values, error code/message/source, fuel and explicit host-call traces.

Eliminated allocations are deliberately observable in `metrics.heap_bytes`. A
program can avoid or reach an allocation-limit failure later than its boxed
counterpart. Consequently exact out-of-memory timing, raw addresses and private
heap images are not promised to be optimization-invariant. The 64 MiB Wasm memory
maximum, current-allocation validation, snapshots and public ABI remain unchanged.
`unboxed_intermediates` counts static internal arithmetic box sites omitted by the
emitter, not dynamic allocation events or saved resident-memory bytes.

## Bulk text copies with the original low-fuel behavior

Concatenation still validates operands, checks the text bound and allocates its
result first. With enough remaining fuel for every source byte, it charges that
same byte count and emits two `memory.copy` operations. With insufficient fuel it
runs the original tick-per-byte loop. The latter deliberately preserves partial
writes, remaining fuel and the exact failure site. Tests compare entire memory
images across a fuel sweep for this path, including aliases and Unicode text.

Bulk copying executes within Wasm, not through a host text shim. Default artifacts
that use concat now require the Core Wasm bulk-memory instruction; the tested Node
22 engine supports it. Other engines remain unqualified.

## Reference lowering and reproduction

```js
import { compile, compileProject, run } from '../src/compiler.mjs';
const source = 'return (40*3+7)/2-1;';
const optimized = compile(source);
const reference = compile(source, { optimize: false });
console.log(run(source).value); // 62n
```

`optimize` is Boolean and defaults to true for `compile`, `compileProject`, and
`run`; it selects numeric regions and bulk concatenation, not static checking.
The efficient byte writer is used in both modes. The CLI currently uses the default
mode; there is no CLI optimization flag. ABI 2 and the public export set do not
change. Saved older pure and host artifacts continue through the current loader.

Run `npm test` and `npm run verify` without installing packages. For a matched
comparison, place the exact prior commit's `src` directory on the local filesystem:

```sh
node benchmarks/numeric-performance.mjs /path/to/baseline/src report.json
```

The driver separates checking/emission/validation from module/instance construction,
Wasm execution and host decode/display. It includes a cold new-Node-process sample
rather than treating a warm engine cache as startup performance. The committed JSON
retains raw total compilation, isolated runtime-stage and cold samples; the driver's
full output additionally contains every per-compilation phase observation.

The current experiment improves arithmetic-heavy callbacks but leaves simple
single-operation map/fold, boxed collection storage, curried closure allocations and
linear record lookup largely unchanged. Those are future measurement targets, not
features silently waived from the production checklist.
