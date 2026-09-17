# Structured predicates, compositional checking and explicit effects

The experiment separates the operations a value supports, the additional facts
proved about it, the effects a computation can perform, and its Wasm representation.
A unified predicate-oriented surface does not make all of these one theorem prover.
The compiler is dependency-free Node.js; executable output is direct Core Wasm only.

## Structural core

Int, Bool, Text, Unit, arrays, unary arrows, records and row extensions are represented
in request-local arenas with inference variables. Inference uses level-based let
polymorphism, occurs checks and row unification. Closed record construction and open
field projection permit structural APIs. Already known fields have a binary-search
path through sorted type rows. No arbitrary impredicativity or general mixed-type
union inference is claimed.

Normal function bodies are inferred once. Calls instantiate checked schemes rather
than rechecking source syntax. Source modules currently share one arena in a bounded
acyclic graph, retaining lexical privacy while exporting returned records. Modules
are not independently compiled or cached interfaces yet.

## Bounded refinements

Integers are signed i64. A predicate is a canonical finite union of sorted disjoint,
nonadjacent closed intervals. Inclusion, union, intersection and complement have
direct set algorithms; at most 256 intervals are allowed. This is not a language of
arbitrary Boolean closures invoked on unknown values. Runtime operations trap on
integer overflow, zero division and invalid indexing rather than silently wrapping.

Refinement checking consumes structural types and separate evidence. null evidence
means the full structural type at that occurrence, not an untyped universal value.
Unannotated parameters can have polymorphic evidence. Compact summaries preserve
parameter identity, projections, record packaging and selected higher-order calls.
Preconditions are contravariant and normal-return postconditions covariant.

Pending executed-call obligations are stored separately from return evidence, so
arithmetic, comparisons or discarding a callback result cannot erase its input
contract. Calls and function subsumption substitute/discharge these summaries;
returning a closure leaves its requirements for its future invocation. Unsupported
joins require an explicit common contract. No optimistic acceptance occurs when
proof work is exhausted. Symbolic arithmetic and container refinement summaries are
still conservative; a generic map callback may require a checked signature.

Direct integer comparisons add branch facts tied to immutable binder identities;
facts are restored when leaving a branch. Arbitrary predicate helpers, general loop
invariants and user proof axioms are not implemented. Postconditions concern normal
returns, not termination or the absence of traps.

## Module/effect extension

The exact surface and compatibility contract is [MODULES_EFFECTS.md](MODULES_EFFECTS.md).
Modules export values; effect declarations introduce nominal operation identities
owned by a canonical module path and declaration. Identity is not inferred from
storage shape. This is not yet full nominal construction/provider metadata for ECS.

A separate effect pass computes a value summary V and performed requirement terms T.
Its key rules are:

```text
operation k a       : result-summary(k) ! effects(a) + {source:k}
fn x => body        : Function(x, V(body), T(body)) ! {}
f a                 : substitute(V(f), a) ! effects(f) + effects(a) + calls(f,a)
handle k with h in b: V(b) ! installation-effects + eliminate(k, T(b), calls(h))
```

Elimination removes only performed source:k terms and adds clause effects outside
that binding. Unresolved higher-order calls retain delayed elimination/check terms;
substitution visits summaries rather than AST bodies. Latent effects in V(b), such
as a returned function, are not discharged by merely constructing it in a handler.
Source and host modes are distinct. Root source requirements must be handled;
explicit host requirements are checked against actual capabilities when executing.

Closed row annotations constrain functions and nested callback interfaces. There
is no claim of principal open-row inference, general effect recursion, continuations,
abort/replay, async suspension, or multishot resumption. This slice supports normal,
synchronous returns through dynamic scoped handlers. Ownership/usage remains a
future separate judgment rather than a predicate that magically prevents duplication.

## Compilation and trust

Each lambda becomes a Wasm function with an explicit capture vector, indexed by
binder identities. Calls use a uniform closure ABI, branches use structured control
flow, and collection primitives are Wasm loops. Strict left-to-right evaluation is
preserved, including discarded lets; no TT interpreter is hidden in the artifact.

Pure artifacts have no imports. Explicit host wrappers import declared scalar
operations only. Callbacks receive copied values, not raw memory or closure authority;
refined integer results are independently validated by generated Wasm. Host callbacks
are trusted synchronous code, not covered by TT fuel or transactional rollback.

Wasm validation proves machine structural validity, not TT refinement preservation.
The provisional ABI/digests detect corruption, not authenticity. Results are bounded,
allocation-checked, immutable detached host snapshots. The heap uses per-main bump
allocation, not GC. Public host-callable closures and hostile-Wasm isolation are not
implemented. The detailed memory/export contract remains in [WASM.md](WASM.md).

## Limits and next experiments

Source 4 MiB, tokens 500,000, AST 200,000, type nodes 1,000,000, parser/checker nesting
256, proof and effect-summary budgets 2,000,000 steps each. Module count 256,
effect count 1,024, effect alternatives 256. Artifact 64 MiB, static pool 32 MiB,
linear memory 64 MiB, call depth 256, value nesting 128, and Text 4 MiB. These are
prototype guardrails, not an end-to-end time/memory guarantee or proof of safety.

Next compare row-unification and subtype-bound kernels under matched semantics;
extend bounded useful refinements, variants/recursion, separate module interfaces,
nominal provider evidence and explicit staging; then complete a systems-only ECS.
General handlers and ownership need specified independent judgments and adversarial
proof obligations, not another language hidden behind the compiler's evaluator.

Research references: Liquid Types (Rondon/Kawaguchi/Jhala),
https://goto.ucsd.edu/~rjhala/papers/liquid_types.html; Koka (Leijen),
https://arxiv.org/abs/1406.2061; Blot's source-language contracts,
https://github.com/mewhhaha/blot/tree/main/spec. These motivate the experiment;
none is a correctness proof of TT or copied implementation code.
