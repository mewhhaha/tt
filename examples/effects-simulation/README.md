# A structural simulation step with checked host input

```sh
node src/cli.mjs run examples/effects-simulation/pure.tt
node examples/effects-simulation/run.mjs 2 1
```

`systems.tt` defines a bare movement function over structural entity records. Its
input/time dependencies come from operation calls, not an explicit effect list.
`scene.tt` maps that function, folds the resulting positions, and reports a checksum.
The pure entry supplies deterministic step/axis values and a pure report handler.
The host entry supplies the same operations through an explicit capability Map;
the runner reads the step/axis from its own command-line arguments and logs the
checksum. For step 2 and axis 1, both positions are 17 and the checksum is 34.

The operation contracts require step in 0..100 and axis in -1..1. The Node adapter
checks returned values, and generated Wasm independently checks these refined Int
postconditions. For example, passing axis 9 fails with E_HOST rather than allowing
an invalid TT AxisValue. A failed run does not undo earlier host reports.

This is a one-step simulation example, not a complete ECS or engine. There is no
persistent world, spawn/component registry, asynchronous input loop, ownership/GC,
or host-callable closure ABI. It exercises modules, shared operation identities,
inferred synchronous effects, higher-order collection composition, copied host
scalars, and refinement checks at a meaningful external-input boundary.
