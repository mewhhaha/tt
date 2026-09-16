# Working on TT

The owner authorized direct commits to main and ongoing hourly exploration of a
fast refinement-first structural language. Preserve concurrent changes. Never
force-push. Do not change other repositories, publish packages, or deploy services
without separate authorization.

Read docs/STATUS.md, docs/DESIGN.md, docs/ROADMAP.md, docs/PRODUCTION_READINESS.md,
docs/LOCAL_DEVELOPMENT.md, and recent commits before choosing an iteration. The existing compiler is a
prototype and not a soundness proof. Keep the implementation language a pragmatic
choice, not a semantic commitment.

## Required iteration discipline

1. Choose a bounded, meaningful improvement. State a falsifiable hypothesis when
   changing inference, refinement semantics, or performance-sensitive algorithms.
2. Add regression tests first where practical. Run acceptance, rejection, runtime,
   artifact, and relevant adversarial tests. Use ASan/UBSan for memory-sensitive work.
3. For performance changes, capture matched workload/toolchain/source provenance,
   retain raw samples, and count work. Do not claim speedups from incomparable runs.
4. Update docs/STATUS.md and append an iteration entry with commands, real outcomes,
   known failures, and next work. Never invent test results or mark an unrun check as
   passed. A limit diagnostic is not evidence that a source program is ill-typed.
5. Push only a coherent state. Inspect current main before updating it; preserve
   other edits. Report the exact commit and remaining blockers.

## Architectural guardrails

- Type predicates are structured descriptions, not arbitrary Boolean closures
  invoked against unknown values. Richer inference must have a specified logic.
- Preserve the distinction between shape evidence, value refinements, effects,
  ownership, staging, nominal identities, and runtime layouts. A unified surface
  does not justify conflating these judgments.
- Function inputs are contravariant. Never erase a callable's precondition through
  polymorphism, an alias, a record, an array, a join, or an interface boundary.
- Branch facts are scoped to immutable binding identities. No optimistic proof on
  a timeout, unsupported predicate, or exhausted budget.
- Check source bodies compositionally. Avoid call-site body rechecking masquerading
  as ordinary generic inference. Make generation/specialization explicit.
- Effects and ECS owners will need stable declaration evidence containing real
  providers/seeds. Do not substitute storage shapes, inferred names, or accidental
  physical closure captures for that evidence.
- No unchecked wraparound, out-of-bounds access, or silently changed demand order.
- Do not turn a known wrong result into the expected test output.

## Commands

python3 dev.py doctor
python3 dev.py verify
python3 dev.py sanitize

LOCAL EXECUTION IS REQUIRED by the owner. Build and run the compiler in the
current execution environment; never depend on a CI artifact or hosted checker.
The commands above perform no downloads. CI, if configured later, must run these
same commands and is corroboration only. When local tooling is unavailable, report
the blocker; do not claim CI checks were local execution. Verify an empty build
directory when changing the build system. Separate compiler-build time from the
time the resulting TT compiler spends checking/compiling a TT program.

## Completion

Do not call this production-ready until the explicit readiness gates have actual
recorded evidence. Do not shrink the gates to finish the task. Once all gates are
satisfied, report the evidence and disable the hourly task. If blocked, record the
blocker; do not claim asynchronous work or changes that were not performed.
