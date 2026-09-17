# Source modules and synchronous effects — experimental contract

This extension adds a useful, deliberately restricted slice. It does not implement
arbitrary algebraic continuations, async suspension, multi-shot resume, modules as
compile-time values, or a complete effect-row inference calculus.

## Module semantics

`let Library = import "./library.tt";` is a module-level binding. An imported module
exports the record returned by its top-level `return`. Private lexical names and
module-local type aliases do not enter the importer. Exported values retain their
structural types, polymorphism, refinement evidence and latent effect summaries.

A canonical project-relative `.tt` path identifies a module within one compilation.
Imports must begin with `./` or `../`; normalization must remain inside the project
root. No package, URL, absolute-path, dynamic or nested-expression imports exist.
The dependency graph must be acyclic. Each dependency is parsed once and initialized
once per `main` invocation, before its importer, in source import order. Diamond
imports share the same export value and operation declarations. Initialization is
not delayed until the textual import binding, and importing a module that performs
host operations may require capabilities before any importer code runs.

`compileProject(entry, sources)` accepts a Map of canonical paths to source strings,
or an explicitly supplied synchronous source resolver. The compiler itself performs
no filesystem or network access. The Node CLI uses `fileProject(entryFile)`, whose
project root is the entry's directory; it rejects symlinks resolving outside that
root. This is not a hostile concurrent-filesystem sandbox. API callers can instead
supply a broader explicitly rooted Map, such as entry `src/main.tt` and `lib/x.tt`.

Budgets: 256 modules, 4 MiB combined source including virtual separator newlines,
500,000 tokens, and 200,000 AST nodes. Paths are limited to 4,096 UTF-8 bytes.
This implementation joins modules in one request-local arena; it is not separate
compilation, incremental interface caching, or parameterized module instantiation.

## Declaring, performing and handling an operation

```text
effect Read :: Unit -> Int;
let reader = fn ignored => Read ();
return handle Read with (fn ignored => 42) in reader ();
```

An effect declaration creates a nominal operation value. Its identity is the
canonical module path plus declaration name, not its structural arrow type.
Declarations are module-level, limited to 1,024 per program and 8,192 UTF-8 bytes
per identity. Reexporting an operation preserves its identity. Different modules'
equally named and equally shaped declarations remain different operations.

Calling the operation performs it. The call returns the result of the nearest
currently active handler for that declaration. `handle E with implementation in body`
checks that the implementation accepts every permitted operation argument and
satisfies the operation's result contract. It evaluates the implementation, installs
the binding, evaluates `body`, and restores the previous binding on normal return.
An uncaught runtime trap aborts the invocation; the next `main` resets all bindings.

A handler clause runs **outside its own binding**. Calling the same operation in
that clause forwards to the outer handler, not recursively back into itself:

```text
effect Read :: Unit -> Int;
return handle Read with (fn ignored => 40) in
  handle Read with (fn ignored => Read () + 2) in Read ();
```

This returns 42. Other effect bindings remain active. A closure created under a
handler does not capture that handler; its latent requirements are checked where
it is invoked. Returning an uncalled effectful closure does not perform its effects.

These are synchronous, normally returning operation handlers. There is one implicit
return to the operation caller, no reified continuation, and no source `resume`,
abort, replay or suspension. Pure implementations execute inside Wasm and introduce
no host imports. Do not describe this slice as a complete resumable effect system.

## Inference, checking and conservative boundaries

A separate bounded pass accumulates operation requirements and substitutes finite
higher-order value/call summaries. Each ordinary source function body is analyzed
once. Calling a helper substitutes its summary; it does not recheck its AST. Calls
whose results are discarded still contribute effects and refinement obligations.
Aliases, structural fields, arrays/get, selected map/fold uses, nested handlers and
returned closures retain their summaries. Handler elimination transforms executed
requirements only; it does not erase latent effects of a returned closure.

An ordinary arrow contract is pure. A closed row can allow preceding local effect
declarations, using `Unit -> Int ~ {Read}` or `Unit -> Int ~ {host Read}`. Source and
host modes are distinct, even for one declaration. A pure annotation cannot hide an
effectful function through a record, array, alias or generic wrapper. Generic handler
arguments retain deferred refinement checks; narrower preconditions are not assumed
away. The shape, effect and refinement judgments remain separate.

`compile(...).type` remains the structural type display, not a complete effect or
refinement signature. `compile(...).effects` lists escaping root requirements; source effects must be
handled and only explicit host requirements may escape. `effect_functions` exposes
per-source-lambda direct requirements plus an `open` flag for unresolved higher-order
terms. These diagnostics are not first-class type reflection or a principal-row
serialization API. Host import manifests enumerate constructed host wrappers,
including uncalled ones; they may be a superset of the root's performed effects.

Current limitations are intentional and checked rather than silently weakened:

* Handler/host selectors must resolve to a statically known declaration. Handlers
  can be generic over implementations/computations, but not over unknown operation
  identities. Closed row annotations cannot name imported qualified operations yet.
* Writable row variables, full row-polymorphic signatures, effect recursion and a
  proof of principal effect inference are not implemented. Branches conservatively
  contribute potential effects, even when a richer analysis could prove them dead.
* Effect-aware `fold` supports scalar accumulators. Callback/container refinement
  inference is still conservative; a generic `map f` helper may need a checked
  callback signature. Unsupported dependent shapes fail closed.
* Summary traversal is budgeted at 2,000,000 counted steps, with existing nesting
  bounds and a 256-alternative cap. E_LIMIT is not evidence of purity or invalidity.

## Explicit host operations

```text
effect Clock :: Unit -> Int;
return (host Clock) ();
```

Constructing `host Clock` requests a host-backed operation wrapper, not implicit
clock authority. `execute(wasm, { host: new Map([[key, callback]]) })` must receive
a callback for every declared import before instantiation. The default Map is empty;
missing capabilities fail with E_HOST_MISSING. CLI `exec` and `run` do not silently
supply clock, logging, filesystem or network services. Use an explicit embedding
runner for host-backed programs.

Inputs: Int maps to BigInt, Bool to Boolean, Text to a copied UTF-8-decoded string,
and Unit to null. Results: Int must be an in-range BigInt satisfying its refinement,
Bool must be a Boolean, and Unit must be null or undefined. Text/aggregate results,
functions, host object references and Promises are not supported. No integer
coercion or silent wrapping occurs. Generated Wasm independently checks refined
Int and Boolean host results before exposing a boxed TT value; the Node adapter
checks types/ranges and supplies source-positioned E_HOST failures.

Callbacks receive no Wasm pointer, memory, table, instance or callable closure.
The high-level result remains a frozen detached snapshot. Explicit low-level engine
instantiation remains possible for trusted embedders; it is not an authority granted
to a TT program by structural typing.

Host callbacks are synchronous trusted code. Their time is not bounded by TT fuel,
exceptions abort without retry, and already performed I/O is not rolled back. The
result metrics include host_calls and host_ms; host_ms is nested within execute_ms,
not a separate disjoint phase. No asynchronous host service is implemented.

## Wasm and artifact extension

TT code is still compiled directly to Wasm. Operations use private scoped handler
frames and globals; source and handler functions use the existing closure ABI.
Imported host functions live in `tt.host`, named by declaration identity. Their
machine signatures are scalar: Unit takes no arguments, Int takes i64, Bool takes
i32, and Text takes `(i32 pointer, i32 byteLength)`; results are i64, i32 or void.
Only the private Node adapter sees Text addresses to copy bytes. Imported table
slots are not exported as public authority.

The optional `tt.effects` custom section contains version 1 and exact operation
keys/input/output contracts. The loader checks those claims against actual Wasm
import signatures, rejects other imports and host modules with start functions,
and requires the section when imports exist. The optional `tt.modules` section
contains version 1 and source records: name, virtual start, code-unit length,
source SHA-256, and line-start offsets. It contains no original source text.

Both sections precede final `tt.abi`, so its existing core digest covers them.
The ABI-2 field set and public exports remain unchanged. Pure single-source modules
retain their old artifact bytes; old ABI-2 pure artifacts still load. Earlier TT
loaders intentionally reject host imports. Digests provide integrity, not
authentication or evidence of safe arbitrary Wasm. Public hostile-code isolation
and a stable release ABI remain unqualified.

## Examples and further work

`examples/effects-workflow` shares a batch service between deterministic pure
handlers and explicit clock/log/save callbacks. `examples/effects-simulation` shares
bare structural movement systems between pure time/input and refinement-checked
host inputs. Neither is a complete ECS, database, async workflow engine or production
application. The ECS registry/provider milestone, static evaluation, ownership/GC,
variants/recursion and general continuation handlers remain on the roadmap.

Encoding reference: WebAssembly Core binary modules/imports and instructions,
https://webassembly.github.io/spec/core/binary/modules.html (accessed 2026-09-17).
Related effect-inference research: Leijen, Koka, https://arxiv.org/abs/1406.2061.
These motivate boundaries; they are not proofs of this experimental implementation.
