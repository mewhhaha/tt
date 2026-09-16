# TT

A refinement-first structural functional language experiment, focused on a small
semantic core, useful abstractions, and fast source compilation. The syntax is
inspired by [Blot](https://github.com/mewhhaha/blot); this is a separate language,
not a compatible implementation or a Blot fork.

**Research prototype. Not production-ready.** Implemented capabilities and gaps
are tracked in [STATUS](docs/STATUS.md). [Readiness gates](docs/PRODUCTION_READINESS.md)
are deliberately stricter than “the examples pass.”

## Build and verify locally

Local execution is the primary workflow. Nothing downloads a CI artifact or calls
a hosted compiler. After installing the local prerequisites, builds, tests, and
benchmarks work without network access. See [local development](docs/LOCAL_DEVELOPMENT.md).

```sh
python3 dev.py doctor
python3 dev.py verify     # build + tests + example round-trips + benchmark work gates
python3 dev.py sanitize   # a separate local ASan/UBSan build and test run
```


GCC or Clang with C++20 support, CMake 3.20+, and Python 3.9+ are needed to build and
test. There are no downloaded language/compiler dependencies. The implementation
uses the GCC/Clang `__int128` extension for checked signed 64-bit arithmetic.

The same steps can be run directly:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2
ctest --test-dir build --output-on-failure

./build/tt check examples/refinements.tt --metrics
./build/tt run examples/records.tt
./build/tt build examples/records.tt -o records.ttbc
./build/tt exec records.ttbc
```

```blot
const Small = Int where self >= 0 && self < 100;
const Positive = Int where self > 0;

let increment :: Small -> Positive = fn value => value + 1;
let getX :: { .x: Small; } -> Small = fn record => record.x;

return increment (getX { .x = 41; .name = "example"; });
```

The record contract admits extra fields. An unannotated `getX` is inferred
structurally and polymorphically (see `examples/records.tt`), but currently loses
scalar refinement information; the explicit contract above preserves the bound.
No per-call body specialization is required. `increment 0` is valid;
`increment (-1)` is rejected. A false contract such as `Int -> Positive` for
`value + 1` is rejected, not trusted. Arithmetic overflow traps instead of wrapping.

## Implemented now

- Let-polymorphic functions, closures, currying, higher-order functions, records
  with inferred row requirements, homogeneous arrays, and lexical shadowing.
- Structured contracts; canonical integer interval sets with conjunction,
  disjunction, exclusion, and implication checks; branch-local literal comparison
  facts; checked function preconditions and postconditions.
- A conservative higher-order contract discipline that rejects loss of callable
  preconditions through generic functions, record fields, or arrays.
- `map`, `fold`, `get`, `length`, `concat`, and `textLength` as the initial primitives.
- Source checking, bytecode compilation, a versioned artifact reader/validator,
  and a fuel- and allocation-budgeted VM.
- Negative tests, independently calculated arithmetic expectations, interval
  algebra properties, malformed artifacts, sanitizer runs, and scaling workloads.

The present `const` form defines a type alias. Arbitrary compile-time evaluation,
first-class type values, algebraic effects/handlers, nominal declaration evidence,
variants, recursion, modules, ownership, incremental compilation, and a native/Wasm
backend are **not implemented yet**. These are explicit research milestones, not
features implicitly claimed by the project description.

## Design and evidence

[Design](docs/DESIGN.md) defines the current fragment and its deliberate
incompleteness. [Syntax](docs/SYNTAX.md) lists the accepted surface.
[Roadmap](docs/ROADMAP.md) specifies the next experiments.
[Performance](docs/PERFORMANCE.md) explains benchmark boundaries and provenance.

```sh
python3 benchmarks/run.py --binary build/tt-bench --output benchmarks/local.json
cmake -S . -B build-sanitize -DTT_SANITIZE=ON \
  -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER=clang++
cmake --build build-sanitize --target tt tt-kernel -j2
ctest --test-dir build-sanitize --output-on-failure
```

## Continued exploration

Hourly development was requested by the repository owner and scheduled through
ChatGPT Tasks. Each iteration should read [AGENTS.md](AGENTS.md), inspect the live
repository, implement a bounded improvement, run it locally, and publish actual
evidence. CI can corroborate a local result but cannot substitute for one.
The task is not a GitHub-hosted autonomous agent; availability of future execution
and repository tools is a dependency. No release or deployment is authorized by
the development schedule alone.
