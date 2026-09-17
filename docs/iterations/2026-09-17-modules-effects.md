# Iteration: modules, scoped pure/host effects and two shared applications

Date: 2026-09-17. Baseline: 09eb97c5a8da7eaf97e039300ba5ab713f64295d.

## Hypothesis and scope

A bounded whole-program module graph plus compositional synchronous operation
summaries can support reusable pure and host-backed applications without
interpreting TT, call-site AST rechecking, implicit host authority, or weakening
callable refinement contracts. The same application body should work under pure
Wasm handlers and explicitly supplied host callbacks.

Implemented semantics are specified in ../MODULES_EFFECTS.md. This is a returning
scoped handler slice, not general reified continuations or async algebraic effects.

## Changes

- Explicit project-relative source imports, record exports, canonical module/effect
  identity, cycle/size checks, private lexical bindings and dependency initialization.
- Module source provenance in a core-integrity-covered optional tt.modules section.
- Separate bounded effect-value/call summaries; primitive operations, closed effect
  annotations, higher-order substitution, pending handler elimination and escaping
  requirement diagnostics. Unknown operation identities are rejected.
- Pure handlers lowered to Wasm functions and private dynamic handler frames;
  clauses run outside their own binding and can forward to outer handlers.
- Typed tt.host imports plus integrity-covered tt.effects contracts; explicit
  capability Map, copied scalar/Text arguments and checked scalar/refined results.
  Actual Wasm import signatures and absence of host start functions are validated.
- Deferred generic handler refinement subsumption through existing pending-call
  machinery; a handler's narrower domain or invalid postcondition is not erased.
- Two seven-file applications: batch-processing workflow and movement simulation.
  Each shares application modules between deterministic pure and host-backed modes.
- Project CLI/API, documentation and local verifier; Node remains the only toolchain
  and Wasm the only output. ABI-2 fields and public exports remain unchanged.

## Local commands and outcomes

Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64. Commands below ran in
/mnt/data/tt-modules, without any install step or network during compilation/tests:

```sh
npm test
npm run verify
npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-modules-evidence/compiler-benchmark-final.json
npm run bench:runtime -- /mnt/data/tt-modules-evidence/runtime-benchmark-final.json
npm run bench:effects -- /mnt/data/tt-modules-evidence/modules-effects-final.json
```

Exact baseline suite: 155/155 passed before changes. Final suite: 202/202 passed,
no skipped or weakened tests. The 47 new tests include module graph/privacy/diamond
identity, handlers/forwarding/escape, higher-order effects and discarded results,
pure signature boundaries, generic handler variance/refinements, typed host values,
invalid callbacks/Promises/exceptions, fuel/strict order, saved-Wasm provenance,
malformed effect/module metadata, host start-function rejection, actual import
signature validation, both applications and linear work gates.

`npm run verify` passed policy/syntax, all tests, four original examples from source
and saved Wasm, README, standalone execution, the existing five compiler workloads
at 500/1000/2000, 1000-element map/fold (checksum500500; 11x100 calls), new module/effect
work gates, and both explicit host application runners.

Nine pure single-source regression programs emitted byte-identical Wasm against the
exact baseline. Pure handler modules have zero imports. A generated arithmetic corpus
compared 100 pure and host-backed computations with equal results. Negative handler
and host result cases fail before their contracts can justify an invalid TT value.

## Cost/provenance

benchmarks/modules-effects.mjs is the reproducible new driver. It records workload
SHA-256 hashes, 3 warmups, 11 raw samples, phase timings, work counters,
artifact sizes, and pure/host engine/decode/display timings. Input hashes are checked
again after measurement. Existing compiler work gates were not loosened.

The explicit final sample measured discarded effect calls at 500/1000/2000 in
10.125/17.719/32.217ms median; diamond graphs at 32/64/128 in 4.518/4.569/8.271ms.
This is not a matched before/after speedup. Runtime host callback time is nested in
execute_ms; compilation, Module/Instance construction, decode and display remain
separate. Host callbacks are synchronous trusted code, outside TT fuel's duration
bound. No peak/live-memory, cross-engine or whole-compiler complexity claim is made.

Raw module/effect samples are committed as benchmarks/modules-effects.json.
Repeated raw-sample keys are stored losslessly as columns/rows tables; zip each
row with its column names to recover the original objects. The unpacked report
was checked equal to the measured report before publication.
benchmarks/modules-effects-inputs.json contains final executed source/test/driver/
example/package hashes. Baseline sources and existing tests/harness inputs were
recovered byte-for-byte and Git-blob-verified; no existing test was semantically
rewritten for this run. Public DNS prevented a fresh clone; no CI result was used.

## Limits and next work

No arbitrary continuation capture/resume/abort, async host calls, host aggregate
results, recursive/import cycles, qualified imported effect-row annotations,
separate-checking cache or principal row theorem is claimed. Effect-aware fold is
limited to scalar accumulators and some generic callbacks need explicit signatures.
The batch save callback is host-memory instrumentation, and the simulation is not
an ECS provider/registry implementation. Production gates remain unchanged.

Next: extend a concrete unsupported container/row case through its checked summary,
then variants/recursion, descriptor/provider evidence and general staging/handlers.
