# 2026-09-17: retain executed-call refinement obligations

Research prototype; all production-readiness gates remain open.

## Correctness defect

At main `74306d94e3c95bc0a80fbbff027ff1f90ab16dd2`, a generic helper
could discard a callback's input contract along with its return-value evidence:

```text
const P = Int where self > 0;
let positive = fn (x :: P) => x;
let discard = fn f => fn x => do {
  let ignored = f x;
  return 7;
};
return discard positive (-1);
```

The previous checker accepted this program even though the executed callback
requires a positive argument. Arithmetic/comparison of the callback result and
unused record/array packaging also lost the requirement. This is a static contract
defect, not a missing runtime optimization. Strict execution still performed the
call; nothing justified dropping its precondition.

## Change

Function evidence now retains an explicit, bounded list of pending call obligations
separate from return-value evidence. Lambda bodies collect their own obligations.
Calls substitute/discharge this finite evidence without rechecking syntax; returning
a closure preserves its obligations for the future call, not for mere construction.
Known direct parameter requirements can strengthen the inferred domain.

Function subsumption instantiates the actual summary under the expected domain and
must discharge its obligations before an annotation can erase implementation detail.
Unsupported joins of different pending summaries reject with E_REFINEMENT_JOIN and
need an explicit common checked contract. Residual top-level obligations reject.
Collection and substitution charge the existing proof-work budget; E_LIMIT is never
converted into evidence. Directly returned call summaries are not substituted twice.

No new syntax, solver dependency, runtime check, call-site body specialization,
Wasm helper, artifact field, ABI change or executable target was introduced.
Symbolic arithmetic result summaries remain future work.

## Local evidence

Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64. All execution was local,
without installed packages, a native compiler, Python, network access or CI artifacts.

- Exact pre-change production sources and all 137 existing tests: 137/137 passed.
- New 18-test file against the old checker: 3 passed, 15 failed. Rejection regressions
  exposed accepted invalid calls; one kernel check also requires the new explicit
  subsumption helper and counted collection.
- Changed checker plus every existing test: 155/155 passed, no skips.
- `npm run verify`: passed repository policy, all 155 tests, all four source/saved-Wasm
  examples, README execution, standalone Wasm, the existing five-workload compiler
  gates at 500/1000/2000, and the 1000-element map/fold engine-stage benchmark.
- Explicit compile and runtime benchmark commands passed. Runtime checksum: 500500,
  11 samples with 100 calls per sample.

Unlike earlier semantically reconstructed runs, all 32 unchanged executed inputs
(production source, every current test/fixture, verifier/policy, benchmark drivers,
package manifests and README/examples) were verified byte-for-byte against the
pinned live Git blobs. The old refine.mjs was also verified exactly. Only the changed
checker and two new test/benchmark files differed. `benchmarks/deferred-call-inputs.json`
records the hashes. This is not a complete git clone: nonexecuted historical docs and
evidence were not all reconstructed, and cross-platform qualification remains open.

## Cost and compatibility

`benchmarks/deferred-calls.json` records 3 warmups, 11 alternating samples and raw
checking durations; `benchmarks/deferred-calls.mjs` reproduces the matched comparison
against a supplied local baseline src directory. All six timed programs emitted
byte-identical Wasm before/after; small counterparts were executed through Wasm.
Deep wrapper programs are compile-only workloads, not claims about runtime limits.

Representative warm checking medians (parse + infer + refine + type display):

| Workload | Before | After | Proof work before / after |
| --- | ---: | ---: | ---: |
| 400 forwarding discard helpers | 2.994 ms | 3.853 ms | 5221 / 12855 |
| 1000 calls through a discard helper | 2.850 ms | 3.104 ms | 5018 / 15042 |
| 1000 identity/refinement wrappers | 5.210 ms | 5.676 ms | 11019 / 12029 |
| 1000 ordinary refined calls | 2.910 ms | 2.911 ms | 7004 / 7005 |

Correctly checking formerly omitted obligations costs work. Samples are noisy; no
general speed claim is made. New forwarding tests bound proof work by 40*n+100 and
substitutions by 12*n+100. Existing tighter identity-wrapper gates are unchanged.
The checker intentionally rejects previously accepted programs that violated call
contracts. More conservative joins may need explicit common signatures.

Next: audit other abstraction paths with the separate obligation representation,
then extend bounded arithmetic/container result summaries. Host-callable closures
still require a checked callable interface as well as lifetime/ownership authority;
a frozen pointer-free host wrapper alone would not establish those premises.
