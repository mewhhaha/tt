# WebAssembly-only backend and provisional ABI 2

The compiler runs in Node.js. Its only executable output is standard Core Wasm
(`00 61 73 6d 01 00 00 00`), using i32/i64, linear memory, structured control flow,
a funcref table and call_indirect. No WAT assembler, native toolchain, npm package,
WASI library, GC proposal, or host import is needed for the current pure fragment.
`check` runs static analysis without emitting; `build` never runs the TT program;
`run` emits and executes Wasm. There is no custom-bytecode output or interpreter.

## Lowering

Every source lambda becomes an ordinary Wasm function. All source functions and
curried primitive wrappers have `(environment: i32, argument: i32) -> i32`.
Values are linear-memory pointers. Closures hold a function-table index and an
ordered capture vector resolved using binder IDs, never names or runtime types.
Records, arrays and conditionals preserve left-to-right strict evaluation.

Arithmetic and array/text operations are Wasm functions included in the artifact.
`map` and `fold` are Wasm loops invoking generated closures. Arithmetic checks
signed-i64 overflow before exposing a result. In particular MIN / -1 traps while
MIN % -1 returns zero. Text length is UTF-8 byte length, not UTF-16 code units.

This boxed representation deliberately prioritizes a small compositional backend.
It does not claim unboxed optimization, optimal code size, or production runtime
speed. Runtime helpers are linked from a finite explicit dependency graph: source
operations and referenced native values seed the graph, and only their transitive
helper closure is declared/emitted. Returning a curried native still retains its
future indirect-call target even when the source does not call it immediately.
Optimizing layouts and ownership/GC remain future work.

## Exports

- `main: () -> i32`: run the closed program and return a boxed-value pointer.
- `memory`: defined linear memory, maximum 1,024 pages (64 MiB).
- `set_fuel: (i64) -> ()`: configure the next main call's nonnegative fuel budget.
- `error_code: () -> i32`: zero after a successful main, otherwise a TT trap code.
- `fuel_remaining: () -> i64`: current tick budget remaining.

The module has no imports. It can be instantiated by a standard engine with `{}`.
A module result that is a function is represented as a closure, displayed `<fn>`;
invocation of returned closures from a host is not yet a supported public ABI.

## Value layout (little-endian, 8-byte aligned)

Every value has a 16-byte header:

| Offset | Field |
| --- | --- |
| 0 | i32 tag |
| 4 | u32 element/byte/capture count |
| 8 | auxiliary u32 (Boolean or function-table index) |
| 12 | u32 aggregate nesting depth |

Tag 0 is Unit, 1 Int, 2 Bool, 3 Text, 4 Array, 5 Record, 6 Closure.
Int payload is signed i64 at offset 16. Text payload is count UTF-8 bytes at 16.
Arrays and closure captures store count u32 pointers at 16. Records store pairs
(label index, value pointer), each 8 bytes, at 16. Booleans use auxiliary 0 or 1.
Unit and booleans are static constants; literal scalars/text and native closures
are pooled. Other values use the per-run bump allocator. Values are not host
pointers and Wasm functions do not call JavaScript to perform language operations.

Linear-memory addresses 0..15 remain reserved and are never TT value pointers. New
artifacts use the u32 word at offset 8 as private trap-diagnostic scratch: `main`
clears it, and the in-Wasm trap helper stores the current source offset immediately
before trapping. This word is intentionally not a new public export or metadata
field; hosts should consume diagnostics through the TT loader rather than depending
on that private address. Older ABI-2 artifacts leave the word zero and continue to
load, so their runtime failures simply have no recovered source offset.

`main` resets the heap cursor, call depth, error, diagnostic source position and
remaining fuel every time. Previous result pointers are invalidated by the next main
call. Host decoding copies out values before reuse. Static bytes are retained; grown
memory is reused. Do not mutate exported memory while relying on language invariants.
There is no GC yet.

## Runtime source diagnostics

Each emitted source expression records its parser source offset before its fuel tick.
Operations that evaluate children and then enter a potentially trapping runtime helper
restore their own offset immediately before that helper call. Higher-order runtime
loops save the source call site around callback invocation, so a trap inside the
callback points into the callback while a later loop/fuel failure points back to the
`map`/`fold` call rather than to the callback's last expression.

The source offset is the compiler's index into the decoded JavaScript source string,
not a UTF-8 byte offset. The CLI `run` path still owns the original source and maps
that offset to line/column, including when preceding source contains non-ASCII text.
A standalone `.wasm` does not embed source text, path identity or a general source
map; artifact-only `exec` can classify the trap and retain the raw offset internally,
but reconstructing file/line text requires external source provenance. This is a
bounded diagnostic mechanism, not DWARF or a standardized Wasm source-map format.

## Artifact checks and trust

A final `tt.abi` custom section contains schema/version, interned label strings,
static heap boundary, SHA-256 of preceding module bytes, and a second SHA-256 over
the canonical metadata fields. This makes standalone CLI loading possible without
TT source or a sidecar while detecting accidental corruption of either the Wasm
core or host-visible label/layout metadata. ABI 2 requires the exact metadata field
set, unique label strings, and an 8-byte-aligned static heap boundary; ABI 1 artifacts
are rejected rather than silently reinterpreted. The loader also rejects missing
exports, imports, unsupported schema, corrupt bytes and legacy TTBC. These digests
are integrity checks, not signatures, authenticity proofs, or proof of typechecking.

WebAssembly.validate and the engine validate the machine code. The host decoder
bounds memory ranges, sizes/depths, tags, UTF-8 and cycles. `exec` accepts TT ABI
modules, not arbitrary Wasm applications. A deliberately forged module can bypass
its own fuel accounting or diagnostic bookkeeping; this is NOT an audited
hostile-module sandbox. Run trusted artifacts only. Strong hostile-input isolation
needs a separately audited boundary. ABI 2 is still provisional. The source-position
diagnostic did not change its metadata schema or public export set.

## Migration

Node remains the implementation language; Wasm is the compilation target. Saved
TTBC is unsupported, and `src/bytecode.mjs` / `src/vm.mjs` are removed. Public API:
`compile(source).wasm`, `check(source)`, `execute(bytes)`, `run(source)`.
There are no `encode`, `decode`, or `VM` exports. Build paths must end in `.wasm`.
Legacy C++/Python implementation files are not permitted on current main; historical
provenance remains in `docs/HISTORY_CPP.md`, `docs/ITERATIONS.md`, and benchmark JSON.
