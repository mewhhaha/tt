# Design experiment 0: structured predicates, cheap shape inference

## Hypothesis

A unified semantic account of types as requirements need not use a universal
prover for ordinary code. Start with a compositional shape inference engine plus
an explicitly bounded predicate fragment. Measure the fragment before broadening
it. This is a candidate implementation, not a settled design for all of Blot.

The executable slice deliberately separates three questions:

1. Which operations does a value support? Structural inference answers this.
2. Which additional properties are established? A refinement pass answers this.
3. How is checked code represented and executed? Closure conversion, direct Wasm functions, engine validation, and an explicit
   linear-memory ABI answer this.

The annotation API presents normal scalar, record, array, and function contracts
alongside refinements. Not every predicate has been reduced to userland primitive
calls yet; the contract and shape constructors in the implementation are trusted. Claiming that
all language features have already been derived from a single predicate would be
incorrect.

## Node.js implementation

The compiler is dependency-free JavaScript ES modules running locally on Node.
The only output is Core WebAssembly. Node's WebAssembly engine executes generated
functions; arithmetic, captures, higher-order calls and collection primitives run
inside the module with no host imports. JavaScript handles source checking,
emission, loading and result decoding, not TT evaluation. BigInt is used during
checking, while emitted arithmetic uses checked Wasm i64 instructions. Text length
is UTF-8 bytes. See WASM.md for the representation and its current limitations.

## Current structural fragment

Shapes are Int, Bool, Text, Unit, arrays, unary arrows, structural records, row
extensions, and inference variables. The solver uses mutable links, level-based
let generalization, an occurs check, and row unification. A lambda parameter is
monomorphic in its scope; a let binding generalizes only variables above the
surrounding level. The pure language permits ordinary let generalization.

Record construction is closed. Field projection introduces an open row
requirement. Explicit record contracts specify required fields and admit extras.
Two incompatible closed record alternatives are not implicitly joined into a new
union. There is no arbitrary impredicative or higher-rank inference.

Already known fields take a direct binary-search path through sorted type-row
entries. Monomorphic schemes are not traversed by the instantiator at every use.
The ordinary body is inferred once; the prototype has no call-site body
specialization. Inferred type display is bounded and is not type identity.

## Predicate domain

Integers are signed 64-bit values. A scalar predicate is a canonical union of
sorted, disjoint, non-adjacent closed intervals. Full Int is the entire domain;
an empty interval set describes no integer. Subtyping in this fragment is set
inclusion. Intersection and union operate directly on interval sets; `!=` creates
a hole rather than unsoundly widening it away.

Annotations support `where self OP integer` and conjunctions of those conditions.
Integer type aliases can be combined with `&` and `|`. Mixed-type unions, arbitrary
logical callbacks, relational quantifiers, and user-supplied proof axioms are not
accepted. Annotation construction is presently syntax-directed; arbitrary const
execution is a future stage.

The refinement judgment is conceptually:

    inferred shape + established evidence entails the required contract

Evidence is separate from an unresolved type variable. Null evidence means the
full *structural type at this occurrence*, not an untyped universal value. A distinct
internal wildcard represents an unannotated parameter whose refinement evidence is
polymorphic: callers may supply a more refined scalar, record field, or callable.
The wildcard is not a proof that an unknown callback accepts every argument.

Unannotated lambdas publish compact evidence templates keyed by their parameter
binding. Templates can contain parameter references, structural field projections,
and symbolic applications. A call substitutes argument evidence into this finite
template; it never rechecks the source body. This preserves refinements through
identity, record projection/packaging, aliases, and higher-order identity/composition.
When substituting a refined callback reveals a precondition on a still-symbolic
argument, that obligation is retained and strengthens the corresponding returned
function domain. Thus `apply positiveOnly` remains positive-only instead of being
silently widened or rejected merely because `apply` was inferred generically.

Evidence substitution is counted against the same refinement-work budget and has a
dedicated work counter. Incomparable dependent callable requirements fail closed
rather than inventing an unsafe common contract. This is still not full dependent
typing: symbolic arithmetic transforms, arbitrary user predicates, and general
container-operation summaries are not inferred.

## Functions and abstraction

A function contract is a precondition and a postcondition about normal returns.
The body is checked with its parameter assumption and must establish its result
contract. A call must establish the precondition before using the postcondition.
Function input entailment is contravariant; output entailment is covariant.

An unannotated parameter has a polymorphic refinement-evidence variable over its
inferred structural shape. This permits helpers that merely forward, project, store,
or apply values to remain generic over caller refinements. Unknown callback
preconditions are not assumed away: once a concrete callback is supplied, any
precondition discovered through a symbolic application becomes a deferred checked
obligation. Unsupported dependency shapes are rejected rather than weakened.

Joins of differently refined callable preconditions are deliberately restricted.
A common explicit contract can be checked contextually. The compiler does not
silently manufacture a broad, unsafe callable at a branch or array join.

Scalar summaries preserve constants and bounded arithmetic results. Exact parameter
identity and structural projection now transport a caller's scalar predicate, but
arithmetic summaries are still value-set approximations: `fn x => x + 1` does not
yet publish a symbolic affine relation to an arbitrary caller interval. A
postcondition does not assert termination or freedom from traps.

## Control flow and arithmetic

`if`, `&&`, `||`, and `!` derive facts from direct comparisons between a lexical
binding and an integer literal. Both directions of comparisons are supported.
Conjunction is decomposed in the true branch, disjunction in the false branch;
unsupported combinations conservatively contribute no facts. Branch changes are
journaled and restored. Binding IDs, not variable spellings, own the facts.

Arithmetic abstract transfer uses exact BigInt intermediates. If an operation's
abstract endpoints may overflow, its result evidence is conservatively widened to
Int. Runtime arithmetic traps on signed overflow and zero division. Remainder
uses wide arithmetic, so MIN % -1 is 0; MIN / -1 traps. `get` is bounds-checked but
can trap. A future total indexing API should use a variant or explicit evidence.

Evaluation is strict, left-to-right. Record fields preserve source evaluation
order. `&&` and `||` short-circuit. Dead lets are not erased. These are intentional
differences from some of Blot's demand rules.

## Compilation and artifacts

The backend walks checked syntax directly. Each lambda becomes a Wasm function
with an explicit captured environment; branches use structured Wasm control flow.
Calls use `call_indirect` with a uniform `(i32, i32) -> i32` closure ABI. This is
not a TT bytecode interpreter compiled into Wasm. The old TTBC emitter/VM has been
removed from active sources, and old artifacts are deliberately not accepted.

Wasm validation checks structural and machine-type validity, not a proof of TT's
source refinements. A versioned `tt.abi` custom section describes labels and binds
the module bytes with a digest. The digest detects corruption, not authenticity.
Pure artifacts have no imports. The private heap uses tagged values and a bounded
bump allocator; generic boxing and linear field lookup are deliberately simple
initial choices, not claims of optimized runtime performance. See WASM.md.

## Explicit limits

Source: 4 MiB, 500,000 tokens, 200,000 AST nodes. Parser/checker nesting: 256.
Types: 1,000,000 nodes. Predicate partitions: 256 intervals. Refinement work:
2,000,000 counted steps. Artifact: 64 MiB; static pool: 32 MiB. Each Wasm function
has at most 49,998 generated locals. Linear memory has a 64 MiB maximum, call depth
is bounded at 256, value nesting at 128, individual Text at 4 MiB. Default fuel is
10,000,000 Wasm-runtime tick units; ticks charge source expressions, calls and
runtime loops, not the obsolete TTBC instruction count.

Limits are prototype guardrails, not an end-to-end compiler time/memory guarantee.
Each `main` call resets its allocator/fuel/depth; returned pointers last only until
the next call. No garbage collector or general escaping host-callable closure ABI
is implemented. E_LIMIT is distinct from failure of a typing premise. Untrusted
Wasm can forge metadata or skip fuel checks: this loader is not a hostile-artifact
sandbox and must not run arbitrary uploads in a shared Node process.

## Further experiments

1. Preserve parameter-to-result refinement relationships in compact schemes,
   without rechecking generic bodies or exponentially expanding formulas.
2. Add algebraic data types and recursion with explicit soundness/coverage rules.
3. Compare the existing row-unification core with a reduced subtype-bound core on
   exactly the same programs and interface expectations.
4. Introduce explicit static parameters and stable declaration references with
   real construction evidence. Then add inferred effects and handlers and rebuild
   a small ECS from systems alone.
5. Add ownership only with an independent usage judgment. A predicate saying
   “linear” is not itself a proof that a value was consumed once.

## Research sources

- Rondon, Kawaguchi, Jhala: Liquid Types (PLDI 2008),
  https://goto.ucsd.edu/~rjhala/papers/liquid_types.html
- Blot's current syntax and architectural contracts,
  https://github.com/mewhhaha/blot/blob/main/DOCS.md
  and https://github.com/mewhhaha/blot/tree/main/spec

These motivate experiments; neither is a correctness proof of TT. No third-party
implementation code was copied into this prototype.

The interval algebra now merges canonical runs and tests inclusion directly in
linear passes. Intersection and complement also enforce the partition limit. This
is a bounded-fragment implementation choice, not a whole-compiler complexity claim.

## Wasm specification references

Binary modules and instruction encodings follow the WebAssembly Core specification:
https://webassembly.github.io/spec/core/binary/modules.html
https://webassembly.github.io/spec/core/binary/instructions.html
Node's built-in engine interface is documented at:
https://nodejs.org/en/learn/getting-started/nodejs-with-webassembly
Accessed 2026-09-16. These are encoding/API references, not proof of TT correctness.
