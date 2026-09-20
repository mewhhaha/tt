# Explicit no-GC ownership — experimental first slice

This is an implemented restricted slice, not the entire proposed ownership language.
TT still has immutable ordinary values in an invocation arena. Explicit `Owned T`
adds independently reclaimable, single-owner plain data. There is **no tracing GC,
reference counting, collector pause, or host allocator call in the TT runtime**.
Node's compiler, tests, and copied-out host snapshots still use Node's own memory
management. No claim of a GC-free JavaScript process is made.

## Surface and value rules

```text
let world = @own { .frame = 0; .items = [1, 2]; };
let before = @snapshot world;
let next = @evolve (@move world) by 10000 with
  (fn state => { .frame = state.frame + 1; .items = map (fn x => x + 1) state.items; });
let count = @borrow next as view in length view.items;
return { .before = @take (@move before); .after = @take (@move next); .count = count; };
```

The `@` forms avoid stealing ordinary names such as an ECS system named `move`.
`as` and `by` remain usable as ordinary identifiers outside these forms.

- `@own expression` copies a closed plain-data graph into one isolated block.
  Int, Bool, Unit, Text, arrays and closed records are supported. Functions,
  nested owners and unresolved payload shapes reject. Empty arrays may need an
  annotation, for example `let a :: Owned [Int] = @own [];`.
- `@move name` transfers its owner and invalidates that binding. An ordinary read
  of an owner is not an implicit clone. Duplicate use and use after move/drop reject.
- `@drop name` releases one block. Unconsumed local owners and owning parameters
  drop on normal scope exit, so the source policy is affine (at most one use), not
  a requirement to write an explicit destructor for every temporary.
- `@snapshot name` makes a complete independent copy. It does not consume the old
  owner, share a reference count, or promise constant-time persistent snapshots.
- `@borrow name as view in body` opens a lexical read loan. Any number of read
  loans are compatible. Move/drop of that owner is forbidden until all loans end.
  A different owner can be updated while a previous snapshot is borrowed.
- A loan body may return copied Int/Bool/Unit values or an independent owner. It
  may not return an ordinary Text, aggregate or closure, even when a richer escape
  analysis could prove a particular case safe. `@own view` is an explicit copy-out.
  Scalar results are physically copied too; their ABI box cannot dangle after reuse.
- `@take ownerExpression` consumes an owner and copies its data into the ordinary
  invocation arena. This is the explicit route to a returned host snapshot. Raw
  owners cannot escape `main` or appear in ordinary records/arrays.
- `@update ownerExpression with step` consumes an owner, calls `step` on its
  read-only data, copies the returned data into a new block, then releases the old
  block. No existing observable value is mutated. It is not in-place field mutation.
- `@evolve ownerExpression by count with step` repeats that update in Wasm. The
  count is an Int; negatives trap. Zero returns the input owner without calling the
  already-evaluated step value. Source evaluation order remains left-to-right.

The step must accept the complete structural payload type, not just the initial
value's refinement. Result evidence is conservative after an update. A narrower
precondition cannot be smuggled into a later iteration. Source and host effects in
step retain their existing inferred requirements and explicit capability checks.

## Functions, groups and conservative boundaries

Ownership is checked after structural inference, separately from effects and value
refinements. Each ordinary function body is visited once, not specialized at calls.
The pass tracks moved/available owner state and lexical loan counts by binder ID.
Continuing branch states must agree; even a statically obvious branch may be rejected
by this deliberately conservative rule. Proof work is budgeted; exhausted analysis
never justifies acceptance. Type-containment queries are request-locally memoized.

Direct owning functions and module-exported aliases work, for example
`let transfer = fn x => @move x;`. Generic functions whose checked summary does not
already establish consuming usage cannot be reinterpreted as owning functions.
Callbacks with higher-order ownership interfaces, owner-capturing closures, owning
payloads inside ordinary containers, and ownership-bearing operation contracts are
currently rejected. Copying an owning closure, FnOnce-style captured consumption,
partial moves, nonlexical lifetimes and more general usage-polymorphic APIs remain
future work. Ordinary pure/higher-order data callbacks remain available for updates.

A group is a logical collection of read loans to one owner. A move is permitted
only after its loans end. This first implementation associates an owner with one
allocation block, but does not claim that arbitrary mutable alias groups or region
inference have been implemented. The payload stays immutable during reads, so its
refinement facts cannot be invalidated by a hidden write.

## Runtime and lifetime argument

The old invocation-prefix allocator remains for ordinary values. Ownership programs
also have a high arena in the same linear memory, starting at the first 64-KiB page
at or after `heap_start + 4 MiB`. The lower allocator cannot cross that boundary.
The whole memory still has a 64-MiB maximum. This fixed split is a prototype tradeoff:
the first owner can grow logical Wasm capacity to about 4.1 MiB even for tiny data.
The small live-owner metrics do not represent total Wasm capacity or resident memory.

Each block has a 32-byte private header (capacity, live bit, free-list link, payload
size and root), followed by 8-byte-aligned copies in the existing boxed data layout.
A fuel-bounded traversal measures/copies the requested data, not the live heap.
Source DAG aliases can expand into duplicate data; copying cost and size are bounded
by the byte, depth and fuel limits. Copying charges fuel for each visited node and
each aligned byte copied; a large Text cannot hide bulk work behind one node tick.
Insufficient copy fuel traps before that node's bulk copy and resets owner storage.
No cyclic or callable payload is constructed.

Drop marks the known block free and links it into a first-fit reusable free list.
It does not trace children to discover garbage. New owners may reuse freed capacity.
There is no splitting, coalescing, compaction or reference counting. Variable-size
churn can fragment capacity and fail despite free smaller blocks. Freed pages are
reusable, not returned to the OS; Wasm memory does not shrink.

An update copies the new result **before** dropping the old owner. Thus an aliased
input child or unchanged subtree remains readable throughout copying. The new owner
contains no references into the old block or temporary invocation storage. Per-step
ordinary temporaries are rewound only after the independent copy completes. The step
closure and active outer handlers precede that scratch checkpoint. A saved snapshot
has its own block; group exclusivity does not authorize changing shared old data.

Borrowed raw data cannot escape its checked scope through closures, containers or
operation interfaces. Scalar loan outputs and `@take` data are copied into the lower
arena. Consequently the existing host result decoder still sees only its validated
static/lower prefix and requires no unsafe exception for freed/reused high blocks.

Language traps clear the entire owner arena before aborting. High-level `execute`
also clears it when a host callback throws (which bypasses the Wasm trap helper).
The next `main` starts fresh. This reclaims memory, **not** host I/O or external
resources: callbacks are not retried, previous I/O is not rolled back, and no
recoverable continuation/async borrowing protocol has been added. Trusted low-level
embedders must call `owned_reset` after a foreign exception before reusing an instance;
they must not reset or mutate storage during an active invocation.

## Artifacts, diagnostics and metrics

Owned modules add an integrity-covered `tt.ownership` custom section with exactly
`{version:1, arena_start, arena_limit}`. ABI 2 and its existing fields remain. Owned
modules additionally export `owned_reset:()->()` and four `()->i32` metric helpers:
`owned_live_bytes`, `owned_peak_bytes`, `owned_reserved_bytes`, `owned_reuses`.
The loader accepts this extension only with its metadata and exact export set.
Older loaders reject owned artifacts; ordinary artifacts keep their previous bytes
in the tested 44-program accepted corpus. No ownership pointer/table is exported.

`execute().metrics` includes those four counters only for owned modules. Byte counts
include block metadata/capacity, not just payload. `heap_bytes` is the successful
lower prefix, not its peak or total allocation activity. `owned_reserved_bytes`
measures the high-arena frontier, including free reusable blocks. All owners are
released before a successful high-level result; host results remain frozen copies.
Integrity checks are not authentication or a hostile-Wasm sandbox.

`E_OWNERSHIP` reports invalid source usage; `E_OWNERSHIP_UNSUPPORTED` distinguishes
missing ownership interfaces. Runtime allocation/fuel failures remain `E_LIMIT`;
invalid internal owner state uses runtime code 15 and negative counts use code 16.

## Verification and next work

Run `npm test`, `npm run verify`, and `node benchmarks/ownership.mjs report.json`.
The verifier retains every previous test and work gate and runs both pure and host
10,000-frame examples under `examples/ownership-frames`. The tests cover moves,
loans, snapshots, generic/annotation rejection, direct module ownership summaries,
header metadata, cleanup, hostile sizes, checked arithmetic and independent models.

This is not ownership-by-default for every value, a complete borrowing calculus,
zero-copy snapshots, a general variable-size in-place update API, stable persistent host handles, GC,
reference counting, or production qualification. Next steps must extend the checked
usage/lifetime model and allocator together rather than admitting unsupported aliases
or adding an implicit collector to make a benchmark pass.

## Subsequent array extension

[ARRAYS.md](ARRAYS.md) adds zero-element-copy readonly slices/concatenations and
consuming constant-size writes for Owned arrays of Int/Bool/Unit. Existing @update
and @evolve still copy whole results. Views are normalized and aliases expanded when
copied into an owner; the setter relies on this stronger cell-isolation property.
No reference counting or tracing collector was introduced.
