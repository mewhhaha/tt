# 2026-09-16 — Node/Wasm-only repository policy

Hypothesis: deleting the dormant C++/Python implementation and making local
verification reject its return reduces implementation ambiguity without changing TT
semantics or Wasm artifacts. Compiler/checker/backend sources are unchanged here.

Removed the 13 legacy implementation/build/test files requested by the owner:
`CMakeLists.txt`, `dev.py`, `benchmarks/bench.cpp`, `benchmarks/run.py`,
`src/bytecode.hpp`, `src/main.cpp`, `src/pipeline.hpp`, `src/refine.hpp`,
`src/syntax.hpp`, `src/types.hpp`, `tests/kernel.cpp`, `tests/test_cli.py`, and
`tests/test_dev.py`. Historical Markdown/JSON evidence remains available without
forming a second executable implementation.

Added `scripts/repository-policy.mjs`, three Node tests, and an early policy check in
`scripts/verify.mjs`. The guard rejects `CMakeLists.txt` and `.cpp`/`.hpp`/`.py`
source anywhere in the repository while ignoring generated `node_modules`/coverage.

Local evidence used the recovered Node/Wasm handoff on Node 22.16.0 / Linux. It has
two fewer demanded-runtime-linking tests than current main, so its aggregate count
is not presented as an exact post-commit checkout:

- `npm test`: 103/103 passed after adding the three policy regressions.
- `npm run verify`: passed those tests, all four examples, README execution,
  standalone Wasm execution, 500/1,000/2,000 compile work gates and the separate
  1,000-element map/fold engine-stage check.
- Positive fixture accepts Node/Wasm source plus historical Markdown.
- Negative fixture rejects nested CMake, C++ and Python implementation files.
- Generated dependency fixture confirms ignored `node_modules` does not make local
  verification depend on third-party/generated content.

No compiler speed, soundness, ABI, or runtime-performance improvement is claimed
from this cleanup. Next work returns to allocator/ABI lifetime auditing,
source-mapped traps and bounded refinement arithmetic/container summaries.
