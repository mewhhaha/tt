# Immutable array views and consuming scalar updates

This is a locally verified extension to the explicit no-GC ownership slice.
The compiler is dependency-free Node.js; all TT array operations execute in Wasm.
There is no tracing garbage collector or reference counting in the TT runtime.
The implementation does not promise that every immutable operation is free, or that
arbitrary concatenation produces one contiguous allocation without copying.

## Surface

```text
let a = @own [10, 20, 30, 40];
let old = @snapshot a;
let read = @borrow a as xs in
  @get(@concat(@slice(xs, 2, 4), @slice(xs, 0, 2)), 0);
let b = @set(@move a, 1, 99);
return { .old = @take(@move old); .new = @take(@move b); .read = read; };
```

The result contains the unchanged old array, `[10, 99, 30, 40]`, and `read = 30`.
The previous version exists because `@snapshot` explicitly copied it. The write
itself reuses the consumed owner's array and scalar cell.

| Operation | Meaning | Data movement and access cost |
| --- | --- | --- |
| `@get(xs, i)` | Read an element, with checked bounds. | No element copy in Wasm; O(1) for flat arrays, O(h) through views. |
| `@slice(xs, lo, hi)` | Checked half-open window `[lo, hi)`. | No element copies; at most one 32-byte descriptor. Full windows return the input. |
| `@concat(a, b)` | Immutable logical concatenation. | No element copies; at most one 32-byte descriptor. General result is a bounded binary view, not contiguous storage. |
| `@materialize(xs)` | Make the indexable pointer vector flat. | O(n*h), pointer copying only; elements remain immutable and shared. Already-flat inputs return themselves. |
| `@set(@move a, i, value)` | Consume `Owned [Int]`, `Owned [Bool]`, or `Owned [Unit]`, return its updated owner. | O(1) cell work and no new owner block in the default lowering; evaluates arguments normally first. |

Here h is representation height, capped at 64, and n is logical length, capped at
1,000,000 for this extension. Slice endpoints and indices are checked as signed i64
before narrowing. Reversed, negative and out-of-range windows reject; no implicit
clamping or Python-style negative indices occur. An empty window at the end is valid.

Slices of slices collapse offsets to their underlying base rather than adding a
chain. Adjacent windows on the same base merge; a whole-base rejoin returns that
base pointer. Empty concatenations also return the nonempty input. Nonadjacent,
reordered, overlapping, or unrelated arrays remain views with explicit indirection.
Unbalanced concatenation is not silently rebalanced or copied: exceeding the height
limit produces E_LIMIT. Materialization offers an explicit flattening point.

`length`, curried `get`, `map`, and `fold` work on these representations in view-enabled
programs. The direct forms avoid constructing a curried accessor closure. Function
elements and their effects/refinement obligations still propagate through slices,
concatenation and reads; no callback is assumed pure merely because it is in a view.

## Borrowing and immutability

A view of an ordinary array shares immutable invocation-lifetime data. A view of an
owned array can only be obtained inside its lexical read borrow. Multiple overlapping
views are legal while reading. Their owner cannot be moved, dropped, or written until
all loans end. Views cannot escape the borrow in records, arrays, or closures.
The current borrow rule conservatively allows only copied Int/Bool/Unit or independent
owners as results; explicit `@own view` copies data for a longer-lived owner.

This must be rejected:

```text
let a = @own [1, 2, 3];
return @borrow a as xs in do {
  let next = @set(@move a, 0, 9);
  return @get(xs, 0);
};
```

The in-place proof depends on more than a unique group handle: `@own`, `@snapshot`
and copying updates recursively expand all source aliases into isolated allocations.
An owned scalar array therefore has one distinct scalar cell per slot, with no
pointers into other owners or the invocation scratch area. A write checks the index,
cell/value tags and available copy fuel before overwriting that 16- or 24-byte cell.
The old owning binding is consumed, no loan remains, and independent snapshots cannot
observe the mutation. Source-level observable values stay immutable.

Text, nested arrays and record elements are deliberately not supported by in-place
`@set`; variable-size replacement needs a separate storage policy. Use the existing
copying `@update`/`@evolve` path for general closed plain data. This implementation
has not inferred object-level uniqueness for arbitrary shared graphs.

An owning array copied from a view is normalized to a flat, recursively independent
array. View nodes do not hide aliases within an owner. `@take` and host snapshots
remain copies. Neither persistent snapshots nor ordinary generic transforms have
become zero-copy merely because a view representation exists.

## Evaluation, fuel and scratch storage

Inputs evaluate once, left to right, including effectful index and replacement
expressions. Bounds failure happens after those inputs are evaluated. Exceptions
are not retried and previous host I/O is not rolled back. Static checks run in both
optimization modes; no effect or callable precondition is erased by this extension.

`@set` records a scratch mark before evaluating its arguments. Its only result is an
isolated owner, and its replacement is a fixed-size scalar copy, so argument boxes
and temporary closures cannot escape into that owner. On success the scratch prefix
rewinds to that mark. Previously existing values and enclosing handlers precede the
mark. This keeps repeated computed writes from accumulating index/value boxes. It
is not general region inference for arbitrary expressions.

Index descent, copying and loops are charged to fuel. Setter validation and byte-copy
fuel are complete before the cell write. A language trap resets the owner arena;
foreign exceptions are cleaned up by high-level `execute`. Existing trusted low-level
embedding/reset rules still apply. A partial failed invocation is not resumable.

`optimize: false` provides a full-owner-copy reference setter. Both modes check the
same source contracts and produce the same successful logical values. Copying has
more fuel and allocation work, so exact fuel/OOM timing or raw addresses are not
promised equal between setter modes. Ordinary pre-extension programs retain their
machine bytes in the tested compatibility corpus.

## Representation and host boundary

An array view is a private 32-byte, 8-byte-aligned object. Existing flat Array tag4
is unchanged; Slice is tag7 and Concat tag8. Offset4 holds the logical length,
offset8 is reserved zero, and offset12 is a certified upper bound on value nesting.
Slice carries `(base, start)` at offsets16/20; Concat carries `(left, right)`.
Offset24 carries representation height and offset28 is reserved zero. The maximum
logical nesting remains 128, separate from the maximum representation height64.

A slice's nesting bound can exceed the nesting of its selected elements. Keeping the
backing bound avoids scanning elements during zero-copy construction and remains safe
for parent depth checks. Normalized owner copies recompute the actual flat depth.

View-enabled modules carry an optional integrity-covered `tt.arrays` custom section
with exactly `{version:1}`. Unknown versions, oversized or duplicate metadata and
additional fields reject. ABI2 fields/public exports remain unchanged (except the
existing separate ownership exports when owners are used). Older hosts cannot decode
new view tags. The core digest covers the extension; it is not authentication or a
proof that arbitrary Wasm passed TT's checker.

The result decoder validates all reachable backing allocations, including portions
outside a slice, actual allocation starts, bounds, child tags, cycles, lengths,
heights and reserved words. Logical snapshot expansion consumes the existing
million-work budget in addition to graph traversal. It then creates frozen detached
arrays. This can copy/validate more than the visible window and costs time: zero-copy
TT operations do not make host decoding or textual display zero-copy.

Views contain no public host authority. The existing bounds/trust restrictions remain;
this runtime is not an in-process hostile-Wasm sandbox.

## Reproduction and limits

```sh
npm test
npm run verify
node examples/array-views/run.mjs pure
node examples/array-views/run.mjs host
node benchmarks/array-views.mjs array-report.json
node benchmarks/array-compatibility.mjs /path/to/prior-ownership/src controls.json
```

`benchmarks/array-views.json` retains raw local timings and deterministic cost gates.
Writes compare identical source with the copying reference versus consuming in-place
lowering. View timings compare explicit materialization with shared views; they are
not speedups over a previously available TT array-view API. Measurements isolate
already-instantiated Wasm execution from loading, host decoding and display.

The fixed 4-MiB scratch/high-arena split, first-fit block reuse, no coalescing and no
Wasm memory shrinking remain prototype limits. Whole-data snapshot copying, the
current scalar-only setter, bounded unbalanced concatenation, conservative lexical
loans and lack of separately checked ownership interfaces remain open work. Tests
and measured improvements do not establish production readiness.
