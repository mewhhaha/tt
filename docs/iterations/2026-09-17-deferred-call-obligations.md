# Iteration: call requirements survive discarded results

Base: 74306d94e3c95bc0a80fbbff027ff1f90ab16dd2. Date: 2026-09-17.

## Hypothesis and representation

The previous refinement pass recovered deferred callback requirements only from the
returned evidence tree. Strictly executed calls whose values were discarded or
replaced by arithmetic could disappear from that tree. Keep call obligations in a
separate function summary; substitution must check them even when the result is Int,
Bool, Unit, an unused aggregate or a constant.

An obligation retains the symbolic callable, argument, original structural type and
known requirement. It is not an effect row or a runtime trace. Unknown callable
requirements can remain symbolic inside a generic function; a concrete invocation
must discharge them. A checked full structural arrow is distinct from ANY (a generic
callable whose future input refinement is unknown).

The body traversal owns a pending-call accumulator per lambda. Returned function
evidence owns its own accumulator during substitution, preventing mere closure
construction from consuming future call requirements. Function interface checking
uses the expected input domain, respecting contravariance, instantiates the actual
summary and requires no residual obligations before accepting its result contract.
A retained generic scalar type ID may still be an inference variable; integer
refinement inclusion then uses already-checked scalar evidence rather than inventing
structural operations from that stale ID. Unsupported composite cases fail closed.

Calls already identical to the returned evidence node are substituted through that
node only once. This avoids duplicating proof work on ordinary identity/application
chains. Summary collection, equality and substitution consume existing work limits.
This is a bounded repair, not a proof of the full higher-order refinement system.

## Regressions

The 18 new tests cover discarded, arithmetic and comparison results; unused records
and arrays; partial application, aliases and forwarding; record projection; branch
requirements; known-dead short circuit operands; common function signatures; unsafe
joins; strict runtime trap order; lexical binder identity; -8..8 generated arguments;
100/200/400 forwarding chains; stored closures; annotated records; and propagation
of proof-budget exhaustion. Valid counterparts execute as real Wasm, including saved
byte buffers with zero host imports.

The original positive-only discarded-call counterexample is reproduced against the
exact baseline. Existing tests were not weakened, deleted or replaced.

## Commands and outcomes

From the locally materialized project:

```sh
npm test
# 155 passed, 0 failed, 0 skipped
npm run verify
# policy; 155 tests; four examples; README; standalone Wasm;
# compiler gates 500/1000/2000; map/fold engine-stage check: passed
npm run bench -- --sizes 500,1000,2000 --samples 11 --output /mnt/data/tt-update15/compiler-bench.json
npm run bench:runtime -- /mnt/data/tt-update15/runtime-bench.json
node benchmarks/deferred-calls.mjs /mnt/data/tt-update15/baseline/src /mnt/data/tt-update15/deferred-calls-comparison.json
```

The baseline src directory contained the exact same ten production modules except
refine.mjs, whose pre-change blob was 1ac47914369ff98b85193a1eb1eb75992004572c.
Running all preexisting tests with that baseline passed 137/137. Running the new
file against it passed 3/18 and failed 15/18. The changed test file passed 18/18.

All unchanged executed files were matched to live Git blob hashes, including test
and harness bytes, not just production files. No dependency installation or CI run
was involved. Historical documentation is not part of that complete executed-input
claim; this was a blob-verified reconstruction, not a network clone or independent
platform run. See benchmarks/deferred-call-inputs.json for exact provenance.

The matched benchmark asserts equality of every unchanged production input, records
raw checking samples and checks byte-identical Wasm for accepted programs. Runtime
parity checks run small counterparts outside timing. Normal compiler and runtime
benchmark boundaries remain separate; no measurements of host display are presented
as compiler work. Existing allocation, callable, UTF-8, ABI, trap, fuel and memory
regressions remain in the locally executed suite.

## Scope left open

No generic arithmetic postcondition inference, variants, recursion, effects, staging,
nominal declaration metadata, host-callable closure API, ownership or GC is claimed.
Do not expose a callable host handle until its argument contracts and lifetime rules
are both enforced. Continue the original production-readiness gates unchanged.
