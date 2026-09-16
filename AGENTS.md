# Working on TT

The owner authorizes direct commits to mewhhaha/tt main and hourly exploration of a
fast refinement-first structural language. Preserve concurrent changes and never
force-push. Publishing packages, deploying, editing permissions, and modifying
other repositories are not authorized.

## Current implementation and local execution

The owner explicitly selected **Node.js** on 2026-09-16. The active execution path of this
prototype is JavaScript ES modules in src/*.mjs, not the retained reference C++ implementation.
Keep it locally runnable with Node alone. **WebAssembly is the ONLY output target.**
`run` compiles and executes real Wasm; no TT bytecode VM, JavaScript output, or native
code target is allowed. The host only loads Wasm and decodes results, never interprets
TT. No interpreter embedded inside Wasm may substitute for direct compilation. No CI artifact, native compiler, hosted
checker, or install step may be a prerequisite. There are no npm dependencies.

Read docs/STATUS.md, docs/DESIGN.md, docs/ROADMAP.md, docs/LOCAL_DEVELOPMENT.md,
docs/PRODUCTION_READINESS.md and recent commits before choosing work. Inspect live
main; do not assume a previous temporary workspace or checkpoint is current.

Run locally:

    npm test
    npm run verify
    npm run bench -- --sizes 500,1000,2000 --samples 11

The direct equivalent of verify is node scripts/verify.mjs. CI is optional
corroboration, never a substitute for a claimed local run. Report missing execution
or repository access honestly. JavaScript tests are not ASan/UBSan evidence.

## Iteration discipline

Choose a bounded useful improvement and a falsifiable hypothesis. Add acceptance,
rejection, runtime and adversarial tests; run relevant work/performance regressions.
Record exact commands, counts, failures, source/runtime provenance, and next work in
docs/STATUS.md and docs/ITERATIONS.md. Never fabricate tests or reuse stale hashes.
Benchmark startup, checking, emitting, Wasm engine compilation/instantiation/execution, and incidental GC as distinct
boundaries. RSS snapshots are not peak memory. Do not infer asymptotic guarantees
from one median. Reread main before publication and push one coherent state.

## Architectural constraints

Structured type predicates are not arbitrary Boolean callbacks run on unknowns.
Keep shape, refinement, effects, ownership, phase, identity, and layout judgments
separate even when their surface is uniform. Check ordinary functions compositionally.
Do not recheck source bodies at every generic call. Do not erase callable input
preconditions through polymorphism, records, arrays, joins, aliases or annotations.
Function inputs are contravariant. Branch evidence belongs to immutable binder IDs.
Unsupported or exhausted proof attempts never justify acceptance. Preserve strict
left-to-right demand, checked i64 overflow, and bounds checks. Keep TT names in Maps,
not host object prototypes; malformed artifacts must fail deliberately.

Future ECS inference needs real declaration-owned seeds/providers, not storage-type
guesses or accidental closure capture graphs. No native or host authority may be
forged through structural records or reflection.

Do not call the compiler production-ready until every documented gate has evidence.
Do not shrink the gates to finish. Once genuinely complete, report the evidence and
disable the hourly task. Until then, keep implemented semantics distinct from plans.
