# Production readiness gates

**None of the unchecked gates is waived by a passing prototype test suite.**
The requested hourly process stops only when evidence supports every applicable
gate and the supported language/target boundary is explicit. This is not a deadline
or a guarantee that unattended iterations alone can establish production quality.

## Semantics and static safety

- [ ] A precise, versioned language specification covers every accepted construct,
      numeric/trap behavior, evaluation order, refinement meaning, effects, staging,
      identity, and ownership rules.
- [ ] Typing/evidence preservation obligations have a documented argument and
      independent review or equivalent checkable evidence. No known accepted
      counterexample violates a published contract.
- [ ] Higher-order substitution, variance, recursive definitions, record/variant
      coverage, effect escape, and staging boundaries have adversarial regressions.
- [ ] Compiler limitations are distinguished from source errors, with no optimistic
      proof acceptance or hidden weakening on exhaustion.

## Useful abstractions and targets

- [ ] Functional data structures, higher-order polymorphism, structural and nominal
      abstraction, algebraic variants, recursion, inferred effects/handlers, and
      explicit compile-time programming work through documented interfaces.
- [ ] A userland ECS example infers requirements from bare systems and recovers real
      descriptor construction evidence without per-system lists.
- [ ] Module/separate-checking boundaries and a supported ownership/resource policy
      are implemented; private construction authority cannot be forged by reflection.
- [ ] A concrete application beyond toy snippets runs on a declared supported
      backend. The supported target and artifact compatibility policy are explicit.

## Implementation and robustness

- [ ] Clean-checkout builds and all tests pass on every supported toolchain/platform.
- [ ] Source execution agrees with an independent reference/model across a sustained
      generated corpus, including traps and demand order, not just result values.
- [ ] Sustained lexer/parser/checker/artifact fuzzing and sanitizer runs show no
      unresolved crashes, undefined behavior, leaks, or uncontrolled amplification.
- [ ] Artifact validation, malformed input behavior, allocation/depth limits, and
      interrupted writes have been audited. An untrusted execution claim requires
      its own evidence; a fuel counter alone is not a sandbox.
- [ ] No unresolved critical correctness/security bugs; important diagnostics carry
      stable codes and accurate source locations.

## Performance and release evidence

- [ ] Reproducible raw benchmarks cover cold and resident compilation, scaling,
      memory, specialization growth, and representative runtime workloads.
- [ ] Regression gates use matched provenance and stable workloads; claimed wins
      clear observed noise without unreported regressions elsewhere.
- [ ] Realistic schemas, wrappers, recursive code, and refinement-heavy examples
      have an explicit acceptable cost envelope, not only a small-source median.
- [ ] Documentation, migration/compatibility notes, and a release checklist match
      actual behavior. The implementation has received review beyond its author.

Publishing packages or deploying services remains a separate authorization. Once
all gates are genuinely satisfied, document the evidence and disable the hourly
ChatGPT task; do not edit this checklist into completion by shrinking its scope.
