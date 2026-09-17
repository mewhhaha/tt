# Modules and synchronous pure/host effects — 2026-09-17

The new source-module and effect slice is implemented and locally exercised in
two shared applications: batch processing and a structural simulation step.
Pure handlers remain entirely in Wasm; external operations require explicit typed
host capabilities. This is not general continuation/async effect support.

Baseline main was 09eb97c5a8da7eaf97e039300ba5ab713f64295d. Baseline tests passed
155/155; the changed suite passes 202/202 including 47 new tests. Full local verify,
existing compiler/runtime gates and new module/effect scale gates pass. Nine
existing pure single-source examples emit byte-identical Wasm against the baseline.
No CI result or dependency install substitutes for these local Node runs.

See [the iteration record](../iterations/2026-09-17-modules-effects.md) for exact
commands, provenance, work/timing boundaries and limitations, and
[MODULES_EFFECTS.md](../MODULES_EFFECTS.md) for the accepted semantics. Raw samples
and input hashes are in benchmarks/modules-effects.json and
benchmarks/modules-effects-inputs.json. Production gates remain unchanged.
