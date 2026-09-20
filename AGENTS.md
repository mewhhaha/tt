# Working on TT

The owner authorizes direct commits to mewhhaha/tt main and ongoing exploration of a
fast refinement-first structural language. Preserve concurrent changes and never
force-push. Publishing packages, deploying, editing permissions, and modifying
other repositories are not authorized.

## Current implementation and local execution

The implementation is **dependency-free Node.js ES modules**. **WebAssembly is the
ONLY executable output target.** `run` compiles and executes real Wasm; no TT
bytecode VM, JavaScript executable output, native code target, or embedded
interpreter is allowed. The host validates/instantiates Wasm and decodes values; it
does not evaluate TT operations. No native compiler, Python, package installation,
CI artifact, hosted checker, or third-party runtime is a prerequisite.

The current branch must not contain a parallel C++/Python implementation. Historical
notes and benchmark evidence may remain as documentation/data, but active or dormant
`.cpp`, `.hpp`, `.py`, and `CMakeLists.txt` implementation files are forbidden by
`scripts/repository-policy.mjs` and local verification.

Read docs/STATUS.md, docs/DESIGN.md, docs/WASM.md, docs/ROADMAP.md,
docs/LOCAL_DEVELOPMENT.md, docs/PRODUCTION_READINESS.md and recent commits before
choosing work. Inspect live main; do not assume a previous temporary workspace or
checkpoint is current.

Run locally:

    npm test
    npm run verify
    npm run bench -- --sizes 500,1000,2000 --samples 11
    npm run bench:runtime

The direct equivalent of verify is `node scripts/verify.mjs`. CI is optional
corroboration, never a substitute for a claimed local run. Report missing execution
or repository access honestly.

## Iteration discipline

Choose a bounded useful improvement and a falsifiable hypothesis. Add acceptance,
rejection, runtime and adversarial tests; run relevant work/performance regressions.
Record exact commands, counts, failures, source/runtime provenance, and next work in
docs/STATUS.md and docs/ITERATIONS.md. Never fabricate tests or reuse stale hashes.
Benchmark startup, checking, emitting, Wasm engine compilation/instantiation/execution,
and incidental GC as distinct boundaries. RSS snapshots are not peak memory. Do not
infer asymptotic guarantees from one median. Reread main before publication and push
a coherent state.

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
disable the recurring development task. Until then, keep implemented semantics
distinct from plans.

## No-GC ownership direction

The owner requires no tracing garbage collection and no reference counting in the
TT Wasm runtime. Node's own compiler/host memory management is separate. The first
implemented slice is explicit affine `Owned T` for isolated plain data, lexical
read borrows, copied snapshots and deterministic whole-block reuse. Read
`docs/OWNERSHIP.md` before extending it. Existing ordinary immutable values still
use the invocation arena; do not claim that all legacy values have become linear.
Never allow ownership, loans, or their obligations to disappear through generic
substitution, captures, records, operation contracts or module boundaries. Unsupported
ownership interfaces reject; adding them requires an explicit checked usage rule.
