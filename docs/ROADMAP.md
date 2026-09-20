# Research and implementation roadmap

Order work by safety and useful vertical slices, not feature count. A passing
prototype suite does not waive any production-readiness gate.

## Current slice and immediate follow-up

Source modules now form a bounded acyclic graph with once-per-invocation dependency
initialization, private lexical scope, returned-record exports, and preserved
structural/refinement/effect summaries. Synchronous scoped operations can be handled
by TT functions or explicitly bound host callbacks. The batch and simulation examples
exercise both. This is neither separate module compilation nor a complete resumable
effect calculus; exact restrictions are in MODULES_EFFECTS.md.

1. Audit effect-summary substitution, higher-order handler contracts and module
   boundary preservation using adversarial examples. Extend useful container/row
   cases without silently erasing requirements or rechecking generic AST bodies.
2. Add bounded symbolic arithmetic and container refinement summaries. Keep unknown
   callback preconditions and normal-return guarantees distinct from performed
   effects. Preserve measured work bounds and explicit proof-limit diagnostics.
3. Add variants and ordinary recursion with fail-closed coverage, recursive-group
   inference, explicit recursive datatype boundaries and tail-call considerations.
4. Define separate checked module interfaces, static imports/type exports and
   incremental invalidation that distinguishes interface users from static
   implementation users. Do not call the current shared-arena graph an incremental
   or separately compiled module system.
5. Extend nominal declaration references with immutable real construction evidence,
   visibility and invalidation rules. Current operation keys alone are not ECS
   component prototypes/providers. Equal storage shapes must not merge declarations.
6. Specify and implement general effect rows/handlers: open-tail relationships,
   higher-order quantification, handler elimination, escape, one-shot resumption,
   continuation ownership and async host suspension. Do not describe the current
   returning scoped handler as that complete system.
7. Add explicit static parameters, first-class type construction/reflection,
   compile-time evaluation with explicit inputs/budgets, and hygienic tags. Rebuild
   a userland ECS from bare systems without manual per-system inventories or
   accidental physical closure capture discovery.

## Runtime, qualification and release

Wasm remains the only executable target. Audit and improve allocation, ownership and deterministic reclamation,
layout selection, host-callable closure handles, lifetime/release, copying, traps,
and explicit external capability protocols. Never introduce a TT interpreter,
JavaScript/native executable backend or CI artifact as an alternate semantic path.

Keep structural types, value refinements, effect terms, ownership, phase availability,
nominal identity and representation as distinct judgments. Generalize only with
executable positive/negative tests and a recorded argument for the new boundary.

Cross-platform/engine testing, sustained generated/fuzz/differential tests, reproducible
cold/resident benchmarks, compiler and runtime memory bounds, public ABI compatibility,
independent review, documentation and a real application beyond examples remain
required. An external callback is trusted authority: fuel and an integrity digest
alone are not a hostile-code sandbox or transactional I/O model.

Compare unification+rows against a reduced subtype-bound core using the same programs,
staging rules and safety obligations. Do not drop useful abstractions just to improve
a synthetic benchmark. Do not shrink the production checklist to mark completion.

## Ownership direction (2026-09-18)

No tracing GC or reference counting is allowed in the TT runtime. The implemented
explicit Owned/plain-data slice is documented in OWNERSHIP.md. Extend it toward
usage-polymorphic interfaces, owner-containing data/closures, checked splitting and
more flexible allocation without weakening lifetime checks. Ordinary invocation
values have not all become linear, and broad ownership/resource policy remains a
production gate. Node compiler/host memory management is separate.
