# Design experiment 0: structured predicates, cheap shape inference

## Hypothesis

A unified semantic account of types as requirements need not use a universal
prover for ordinary code. Start with a compositional shape inference engine plus
an explicitly bounded predicate fragment. Measure the fragment before broadening
it. This is a candidate implementation, not a settled design for all of Blot.

The executable slice deliberately separates three questions:

1. Which operations does a value support? Structural inference answers this.
2. Which additional properties are established? A refinement pass answers this.
3. How is checked code represented and executed? Closure conversion, bytecode,
   structural artifact validation, and a VM answer this.

The annotation API presents normal scalar, record, array, and function contracts
alongside refinements. Not every predicate has been reduced to userland primitive
calls yet; CK and TK in the implementation are trusted constructors. Claiming that
all language features have already been derived from a single predicate would be
incorrect.

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
full *structural type at this occurrence*, not an untyped universal value. Typed
function/record/array evidence is interpreted using the instantiated structural
shape. Generic identity currently loses scalar precision but must reject erasure
of a function precondition. This is conservative, not a complete inference of all
valid higher-order refinements.

## Functions and abstraction

A function contract is a precondition and a postcondition about normal returns.
The body is checked with its parameter assumption and must establish its result
contract. A call must establish the precondition before using the postcondition.
Function input entailment is contravariant; output entailment is covariant.

An unannotated parameter has its full inferred structural contract. Calling a
positive-only function through an unannotated callback parameter is not justified
just because the callback was passed as a value. Current higher-order abstraction
may reject valid programs that a dependent/qualified scheme could express. Use an
explicit callback contract rather than dropping the obligation.

Joins of differently refined callable preconditions are deliberately restricted.
A common explicit contract can be checked contextually. The compiler does not
silently manufacture a broad, unsafe callable at a branch or array join.

Scalar summaries preserve constants and bounded arithmetic results but are not
symbolic relations to parameters. `fn x => x` does not currently transport a
caller's arbitrary scalar predicate. A postcondition does not assert termination
or freedom from traps.

## Control flow and arithmetic

`if`, `&&`, `||`, and `!` derive facts from direct comparisons between a lexical
binding and an integer literal. Both directions of comparisons are supported.
Conjunction is decomposed in the true branch, disjunction in the false branch;
unsupported combinations conservatively contribute no facts. Branch changes are
journaled and restored. Binding IDs, not variable spellings, own the facts.

Arithmetic abstract transfer uses checked wide intermediates. If an operation's
abstract endpoints may overflow, its result evidence is conservatively widened to
Int. Runtime arithmetic traps on signed overflow and zero division. Remainder
uses wide arithmetic, so MIN % -1 is 0; MIN / -1 traps. `get` is bounds-checked but
can trap. A future total indexing API should use a variant or explicit evidence.

Evaluation is strict, left-to-right. Record fields preserve source evaluation
order. `&&` and `||` short-circuit. Dead lets are not erased. These are intentional
differences from some of Blot's demand rules.

## Compilation and artifacts

The compiler emits a stack bytecode with explicit function bodies, capture
vectors, locals, jumps, records, arrays, and checked primitives. Closures retain
values rather than revisiting source bodies at calls. Records currently use a
simple runtime field lookup; runtime optimization is separate from inference.

TTBC version 1 has a fixed magic, little-endian integers, length-delimited pools,
and explicit function headers. The reader bounds all lengths, rejects trailing
bytes, and validates operands, targets, stack heights, and returns. Runtime kind
checks remain at artifact boundaries. This is a structural bytecode validator,
**not** a serialized proof that arbitrary supplied bytecode was typechecked.
There is no stable ABI or claim that the VM is an audited hostile-code sandbox.

## Explicit limits

Source: 4 MiB, 500,000 tokens, 200,000 AST nodes. Parser/checker traversal nesting:
256. Types: 1,000,000 nodes. Predicate partitions: 256 intervals. Refinement work:
2,000,000 counted steps. Artifact: 64 MiB and 2,000,000 instructions. Default VM:
10,000,000 fuel units, 1,000,000 allocated value/local cells per category, 32 MiB
cumulative text allocation, 4 MiB per text, and 128 nested value containers.

Limits intentionally distinguish E_LIMIT from a failed typing premise. They are
prototype guardrails, not an established end-to-end memory/time bound. Limits,
invalid input behavior, and amplification need further auditing before untrusted
use. Allocation and execution limits are cumulative, not live-set estimates.

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
