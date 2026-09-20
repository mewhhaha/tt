# Borrowed array views and consuming writes

Run `node examples/array-views/run.mjs pure` or
`node examples/array-views/run.mjs host 1 99` with Node alone.
Both use the same array-processing module. No host capability is implicitly granted.

Expected data: before `[10,20,30,40]`, after `[10,99,30,40]`, rotatedFirst `30`,
joinedLength `4`. Host mode delegates exactly two scalar operations. Invalid host
indices fail their `0..3` contract; the language still retains runtime bounds checks.

Slices and concatenation share element storage. Adjacent halves merge back to the
original array; the rotation is a two-part read-only view. The lexical borrows end
before the consuming set, which rewrites one exclusive scalar cell in the existing
owner block. The explicitly requested previous snapshot is an independent copy.
Taking results copies them into the ordinary result arena. Those two copy boundaries
are not zero-cost, and this example does not claim zero allocations end to end.

No tracing GC or reference counting is used in TT. See `docs/ARRAYS.md` for
representation, bounds, costs, interoperability and current limitations.
