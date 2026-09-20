# Iteration: explicit affine data owners and deterministic Wasm block reuse

Date: 2026-09-18. Baseline main:
`3e135945062e8c950c5fbc465f11f77edc1f9563`.
Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64. No dependency installation,
Python/native compiler, hosted checker or CI artifact was used for execution.

## Implemented scope

The earlier ownership sources did not survive in the available handoff. This run
recovered the exact published compiler and implemented a restricted, verified slice:
explicit `Owned T`, @own/@move/@drop/@snapshot, lexical read borrowing, @take,
consuming @update and @evolve, plus direct owning function/module interfaces.
The static pass is separate from structural/effect/refinement checking. Unsupported
capture, aggregate, operation and higher-order ownership interfaces reject.

Plain owned data lives in independently allocated whole blocks. Updates copy a new
value before freeing the old block and rewind their ordinary temporary allocations.
Snapshots own independent copies. Drop and scope cleanup release known blocks;
language traps and the high-level host-exception path reset the arena. This uses
neither tracing garbage collection nor reference counting. Node's own memory
management is separate. See ../OWNERSHIP.md for the exact semantics and limits.

This is not ownership-by-default for ordinary values, arbitrary linear closures,
usage-polymorphic callbacks, nonlexical lifetimes, an in-place update API, external
resource finalization or a complete implementation of the earlier design proposal.
The existing invocation arena remains for ordinary immutable values. No production
gate has been waived and no existing test was edited to accept the new feature.

## Bugs caught during implementation

- Bare `move` collided with an existing simulation system name. New forms now use
  explicit @ prefixes; all old code continues to parse unchanged.
- Branch-state cloning inside a borrow initially risked decrementing a stale loan
  counter. Loan close now updates the current binder state; nested branches/loans
  have regressions.
- Counting copied objects alone did not bound repeated large-Text bulk copying.
  A new regression failed in the local implementation before the fix. Copy now
  charges aligned bytes as well as visited nodes. At fuel 10000 the repeated
  4096-byte copy workload rejects; at fuel 100000 it returns the expected length.
  The low-fuel test sweep includes every earlier budget and now extends to 1200.

## Fresh verification

Commands below ran in `work` under `/mnt/data/tt-ownership-verified` unless stated.
Logs accompany the source handoff; benchmark raw samples and executed-input hashes
are also carried in `benchmarks/ownership.json` and `ownership-inputs.json`.

```text
cd ../baseline && npm test
# 217/217 passed: exact published existing tests and source inputs
cd ../work
node --test tests/ownership.test.mjs tests/ownership-artifact.test.mjs
# 43/43 passed after copied-byte fuel fix
npm test
# 260/260 passed, no skips; all 217 previous tests unchanged
npm run verify
# PASS: policy, JS syntax, 260 tests, original examples/README/standalone Wasm,
# original compiler/runtime/module-effect gates and both earlier host runners,
# new ownership work/allocation gates, pure and host 10000-frame runs
npm run bench -- --sizes 500,1000,2000 --samples 11 --output ../evidence/compiler-gates-final.json
# PASS: existing deterministic work/size gates
npm run bench:runtime -- ../evidence/runtime-gates-final.json
# PASS: checksum 500500, 11 samples, 100 calls/sample
node benchmarks/ownership.mjs ../evidence/ownership-performance-final.json ../baseline/src
# PASS: ownership work/allocation gates, ordinary-vs-owned result equivalence,
# all 44 accepted captured ordinary fixtures have byte-identical Wasm to baseline
```

New tests cover duplicate consumption, use after move/drop, loan escape through
closures/data, incompatible branch usage, direct owning helpers across imports,
unsupported generic/annotation/operation laundering, refined update preconditions,
scalar copy-out, snapshot alias isolation, nested owners, negative/zero iteration
counts, 100 independently modeled state programs, fuel/arithmetic/host-error cleanup,
allocation exhaustion, work limits, corrupted/rehashed manifests, and a saved owned
artifact run by a separate process using standard Wasm/Memory APIs without TT code.

The pure/host multi-module application retains the initial two-entity snapshot for
10000 updates. Both finish with frame 10000, positions 70010 and -29980, checksum
40030, zero live owner bytes, 1008 reserved/peak owner bytes, and 9999 block reuses.
Host mode executes exactly 40000 explicitly supplied Step/Axis callbacks. The high
arena uses three 336-byte blocks; these counts exclude the lower arena and the fixed
scratch reserve. The test also checks that the initial snapshot remains unchanged.

## Costs, not a speedup claim

Ownership declaration/drop compilation (parse, shape, ownership, effects/refinement,
emission, validation and type display) measured medians 4.245/7.053/15.043 ms at
500/1000/2000 owner declarations, with 3 warmups and 11 samples. New work gates
bound ownership steps by 25*n+100; source bodies are not rechecked at generic calls.
This does not establish a whole-language complexity guarantee or cold-start speed.

The matched lifetime experiment uses the same plain-data step and index-array input,
but one program uses ordinary fold and one explicitly uses owned evolve. They have
matching returned values, not identical allocation/fuel semantics or machine work.
Execution is timed on already instantiated Wasm, 5 warmups, 11 alternating samples,
10 main calls/sample; engine loading, instantiation, host decode/display are separate.

| Frames | Ordinary ms | Owned ms | Ordinary lower bytes | Owned lower bytes | Owned reserved bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.040 | 0.050 | 19760 | 584 | 320 |
| 1000 | 0.399 | 0.478 | 196160 | 4184 | 320 |
| 10000 | 3.914 | 4.833 | 1960160 | 40184 | 320 |

At 10000 frames the owned program uses roughly 23% more Wasm execution time in this
sample. Whole-block copying and new lifetime checks are not free. Its owner frontier
stays at two 160-byte blocks; the lower index array deliberately scales with frames
in both programs. Live owner bytes are zero after every successful run.

Actual logical Wasm capacity is 4325376 bytes for owned versions at these sizes,
compared with 65536/196608/1966080 bytes for the ordinary versions. The prototype's
4-MiB scratch gap makes owned capacity larger at this scale despite reuse. No claim
of smaller RSS, peak total memory or faster general runtime is made. First-fit blocks
are not split/coalesced; variable-sized churn can fragment. Freed capacity is reused,
not returned to the OS. Engine caches and incidental Node GC affect timing samples.

## Provenance and publication

The complete baseline src, tests and scripts trees were hash-matched to the published
Git trees, including modes. Existing example source/runner files, manifests, README,
benchmark drivers, AGENTS and modified baseline docs were individually blob-checked.
69 final executed inputs are recorded with SHA-256 and Git blob identities. Unexecuted
historical docs/evidence were not all recovered: this is an exact executed-input
workspace, not a full clean clone or cross-platform qualification.

No remote commit or main update has occurred. This session's connector lists only
read actions. The installed GitHub integration was checked, without permission
changes. Normal `git ls-remote https://github.com/mewhhaha/tt.git refs/heads/main`
failed with `Could not resolve host: github.com`. No alternate transport, encoding,
credentials bypass or documentation-only repository commit was used.

The handoff provides the tested source, logs and a Git patch against the pinned
baseline. The patch preserves all unmodified repository files/history and must not
be treated as a published commit. Apply it only to a matching clean checkout and
rerun verification before a normal non-forced main push. Patch-application and
extracted-workspace verification are recorded in the handoff's separate evidence.
