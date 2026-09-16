# TT

An experimental refinement-first structural functional language, exploring a small type system and fast compilation. Syntax is inspired by Blot; this is a separate language and compiler.

**Status: research prototype, not production-ready.** Implementation, executable tests, benchmark evidence, and explicit readiness gates are being established. No production, soundness, or performance claim should be inferred from this bootstrap commit.

The initial implementation uses dependency-free C++20. The design separates fast structural inference from bounded refinement reasoning, while treating familiar types as structured predicates. Unsupported proof obligations must fail closed; runtime arithmetic must not silently wrap.

Development is authorized directly on `main`. Subsequent iterations must preserve user changes, publish reproducible evidence, and distinguish implemented capabilities from research directions.
