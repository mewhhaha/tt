# Research and implementation roadmap

Keep this ordered by soundness and useful vertical slices, not feature count.
Each item requires executable acceptance and rejection cases plus cost evidence.

## Next iterations

1. **Adversarial validation and maintainability.** Expand generated tests for
   polymorphic rows and nested callable contracts; audit bytecode/resource limits,
   error recovery, and lifetime behavior. Improve source formatting and module
   boundaries without adding another semantic implementation. Record any discovered
   counterexample before repairing it.
2. **Refinement abstraction.** Compact parameter/result qualifiers for generic
   functions; preserve useful scalar evidence through identity/composition and
   container operations without body specialization. Establish substitution and
   variance tests. Avoid arbitrary theorem proving or hidden call-site retries.
3. **Variants and ordinary recursion.** Closed/open variant requirements,
   construction and matching, fail-closed coverage, recursive-group inference,
   explicit recursive datatype boundaries, and tail calls. Clarify termination vs
   normal-return contracts. Add realistic persistent data-structure examples.
4. **Nominal declaration evidence.** Stable keys with immutable checked metadata;
   actual prototypes/providers stay recoverable. Equal storage shapes must not
   merge distinct declarations. Define visibility, identity, and invalidation.
5. **Effects.** Specify an effect-row calculus before implementation: higher-order
   tails, joins, generalization, handler elimination, escaping effects, and one-shot
   resumption. Do not treat every effect as an ordinary callback dictionary. Test
   inferred system access sets and recover descriptors through declaration evidence.
6. **Explicit staging.** Static parameters, type constructors/reflection, compile-time
   value execution with explicit inputs and budgets, and hygienic declaration tags.
   Ordinary function checking must remain interface-based. Rebuild a small ECS from
   systems without manual registration or accidental capture discovery.

## Before a stable production candidate

- Modules and separate checking; first-class interface evidence; incremental
  invalidation separating interface users from static implementation users.
- A supported native/Wasm code-generation path, or an explicitly agreed VM target
  with measured runtime behavior and a stable artifact contract.
- Resource/ownership analysis and a documented policy for continuations, arrays,
  cleanup, and abstraction boundaries.
- Independent differential evaluator/model, stronger generated/property tests,
  sustained fuzzing, reproducible builds, useful source diagnostics, documentation,
  portability gates, and a concrete real application.
- Matched benchmark suites for cold check/build, resident edits, memory growth,
  specialization count, wide schemas, higher-order wrappers, proof-heavy programs,
  and runtime execution. Do not infer whole-compiler complexity from the core solver.

## Design comparisons, not foregone conclusions

The refinement-first surface does not predetermine one inference kernel. Compare
unification+rows against a minimal subtype-bound alternative under the same staging
rules. Record which programs and annotations each admits, as well as measured work.
Do not remove valuable abstractions simply to improve one synthetic benchmark.
