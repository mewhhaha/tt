# One batch service, pure and host-backed effects

From the repository root, without installing anything:

```sh
node src/cli.mjs run examples/effects-workflow/pure.tt
node examples/effects-workflow/run.mjs
```

`operations.tt` owns `Scale`, `Clock`, `Save`, and `Emit`. `transform.tt` maps
structural rows and folds totals; `service.tt` performs the workflow. Both import
`operations.tt`, demonstrating a diamond dependency whose declarations retain one
identity. The two entry modules share all application code.

`pure.tt` supplies deterministic TT implementations. It produces rows worth 30 and
60, total 90, and elapsed time 0. The complete module has no Wasm imports. `Save`
and `Emit` are pure no-ops here; this is a deterministic testing interpretation,
not a claim that persistent storage has occurred.

`host.tt` keeps `Scale` pure and explicitly forwards clock, save and log to host
implementations. `run.mjs` grants three exact keys through a Map: the current time,
a copied-text logger, and a callback that stores the total in a host-owned array.
This example does not write a database or file. Tests substitute a deterministic
clock and assert total 90, elapsed 1, one saved total, and one log message.

Both runs execute the TT service, map/fold, arithmetic, records and handler dispatch
inside real Wasm. Only explicitly delegated operations call the host. Missing
capabilities or invalid callback results fail deliberately. A host callback that
throws aborts the invocation without retry; previous external actions are not
rolled back. A clock implementation can be nonmonotonic: elapsed time is an ordinary
signed Int, not a promised duration invariant.

The current scalar/Text host boundary, effect inference, handler scope and module
restrictions are specified in `docs/MODULES_EFFECTS.md`. These returning handlers
do not expose continuations and are not an async workflow engine.
