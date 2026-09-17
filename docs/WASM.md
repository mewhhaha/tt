# Direct Wasm backend and provisional ABI 2

Node.js runs the compiler; standard Core Wasm is its only executable output.
Pure modules require no imports, assembler, native toolchain, packages, WASI, or GC
proposal. Explicit host-effect modules add only declared `tt.host` function imports.
See [MODULES_EFFECTS.md](MODULES_EFFECTS.md) for the experimental extension.

## Lowering and exports

Every source lambda and curried primitive uses `(environment:i32, argument:i32)->i32`.
Values are boxed linear-memory pointers. Closures contain a function-table index and
captures in checked binder order, not lexical-name or runtime-type guesses. Host
imports precede defined functions; private table entries preserve actual function
indices. The table is not exported. Runtime helpers are demand-linked through an
explicit dependency graph, including future curried targets returned as values.

Arithmetic, collections, captures, handler dispatch and source control flow execute
inside Wasm. Checked i64 arithmetic traps on overflow; MIN/-1 traps, MIN%-1 is zero.
Text length means UTF-8 bytes. No TT bytecode interpreter or JavaScript arithmetic
shim implements source operations.

Public exports remain:

- `main: () -> i32`, returning the closed program's boxed result pointer;
- `memory`, maximum 1,024 pages (64 MiB);
- `set_fuel: (i64) -> ()`, setting the next invocation's nonnegative budget;
- `error_code: () -> i32` and `fuel_remaining: () -> i64`.

`main` resets heap cursor, source-handler globals, depth, errors, diagnostic position
and fuel. A result pointer is invalidated by the next main invocation. No persistent
pointer or public callable-closure ABI is provided.

## Value layout

Every value is 8-byte-aligned and has this 16-byte little-endian header:

| Offset | Field |
| --- | --- |
| 0 | i32 tag |
| 4 | u32 element/byte/capture count |
| 8 | auxiliary u32: Bool value or function-table index |
| 12 | u32 aggregate nesting depth |

Tags: Unit=0, Int=1, Bool=2, Text=3, Array=4, Record=5, Closure=6. Int payload is i64
at 16. Text payload is count UTF-8 bytes at 16. Arrays/captures hold count u32 pointers;
records hold (label index, pointer) pairs, 8 bytes each. Allocations round up to an
8-byte boundary. Runtime handler frames are ordinary internal Arrays containing a
handler closure and previous frame. They introduce no host pointer representation.

Addresses 0..15 are reserved. Word 8 stores the source offset associated with a trap;
word 12 is zero until successful completion, then stores the live bump-heap endpoint.
A failed invocation leaves word 12 zero. These are private loader conventions, not
public exports or additional ABI metadata fields. Old ABI-2 artifacts without the
watermark retain the previous page-bound compatibility path.

## Host result ownership and checks

`readValue` checks static `[16, heap_start)` and current dynamic allocation ranges,
real allocation starts, full reachable graphs including opaque closure captures,
cycles, nesting metadata, sizes/tags/UTF-8 and work/depth bounds. Fully validated
aggregate subgraphs are memoized; each edge still consumes work. Arrays/Records and
backing vectors are frozen detached copies. Closures become only frozen
`{kind:'Closure'}` markers, not callable handles or table indices.

`execute` exposes only frozen value/output/metrics/remaining_fuel. It does not retain
or expose a Module, Instance or linear memory. `loadWasm` remains the explicit
low-level route to a compiled module for trusted embedding. Display separately caps
rendered UTF-8 at 16 MiB, including escaped text and multibyte record labels.

Metrics distinguish load (including engine compilation), instantiation, source
execution, host decode and display. heap_bytes is successful dynamic bump allocation,
not peak or retained-live memory. host_calls counts delegated operations; host_ms
is nested within execute_ms, not a disjoint elapsed-time bucket.

## Metadata and diagnostics

The final `tt.abi` JSON custom section has exactly schema/version/labels/heap_start/
core_bytes/core_sha256/metadata_sha256. ABI version is 2. The metadata digest covers
the canonical fields; the core digest covers all preceding module bytes. Labels
are unique and the static heap boundary is aligned. Older ABI 1 is rejected.

Optional `tt.source` version 1 carries source length in JS code units, SHA-256 of
UTF-8 source, bounded diagnostic name and ordered u32 line starts. Source text is
not included. CLI uses project-relative diagnostic paths. Imported projects also
carry integrity-covered `tt.modules` version 1 records mapping virtual source offsets
to individual names, hashes and line tables. Saved Wasm can report imported-file
runtime locations without the original source. Old pure modules without the optional
sections remain valid. This is neither DWARF nor a general-purpose source map.

Each expression records its source offset before its fuel tick; runtime operations
restore their call site after evaluating children. Map/fold preserve the enclosing
call site around callbacks. Wasm traps save their position before unreachable; host
imports save their call site before entering external code. The loader returns
source-positioned TT errors. Unhandled source effects use code 13; invalid host
results use code 14. Older artifacts without position bookkeeping degrade to offset0.

Optional `tt.effects` version 1 specifies exact host operation keys and scalar
contracts, including canonical Int intervals. The loader checks the actual Wasm
import types and names against this section, rejects unknown/non-function imports,
requires explicit capabilities before instantiation, and rejects host modules with
start functions. Unit has no machine parameters, Int uses i64, Bool i32, and Text
an internal pointer/byte-length pair copied by the adapter. Results are i64/i32/void;
generated wrappers check refined Int and Bool results. No host result pointer is
accepted. Earlier TT loaders reject host modules instead of silently granting I/O.

## Trust and unfinished work

A digest is an integrity aid, not a signature or proof that TT checking occurred.
A forged module can omit fuel, misuse memory, or forge private bookkeeping. Only
trusted artifacts belong in the current in-process runner. The host callback Map
is explicit authority; callbacks are trusted synchronous JavaScript and can take
unbounded time. TT fuel does not constrain them, exceptions are not retried, and
prior I/O is not rolled back. This is not a hostile-module sandbox.

The current boxed, linear-lookup, bump-allocation representation prioritizes a small
compositional backend. It is not GC or an optimized stable runtime. Ownership,
reclamation, async/full continuation handlers, public callable closures, cross-engine
qualification and ABI stabilization remain open gates. The exact module/effect
restrictions and example workflows are in MODULES_EFFECTS.md.
