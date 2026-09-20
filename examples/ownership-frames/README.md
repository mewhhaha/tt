# Immutable frames with explicit owners

```sh
node examples/ownership-frames/run.mjs pure
node examples/ownership-frames/run.mjs host
node src/cli.mjs build examples/ownership-frames/pure.tt -o frames.wasm
node src/cli.mjs exec frames.wasm
```

Both modes run 10,000 updates of the same two-entity world. The initial world remains
an independently owned immutable snapshot. Final positions are 70010 and -29980;
the checksum is 40030. The host mode explicitly supplies 40,000 Step/Axis callbacks.
No implicit clock, filesystem or network authority is granted.

Three reusable 336-byte owner blocks suffice: initial snapshot, current frame and
next frame. The assertions require 1008 high-arena bytes, 9999 block reuses and zero
live owners at successful completion. The ordinary result and temporary code objects
have separate storage; total Wasm capacity is about 4.1 MiB because of the current
fixed scratch/owner split. These numbers are not an RSS or peak-total-memory claim.

The snapshot is copied, not reference-counted. Updates copy the new data before
releasing the old block. No tracing collector runs. This is a no-GC lifetime example,
not a complete ECS, renderer, persistent host API or production-ready game loop.
