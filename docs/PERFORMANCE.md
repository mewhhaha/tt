# Node compiler / Wasm performance evidence

`npm run bench -- --sizes 500,1000,2000 --samples 11` measures in-process checking
and compilation. No CI or compiler download is involved. Record-field lookup,
monomorphic scheme reuse, and canonical intervals retain their existing fast paths.

The total includes parse, infer, refinement, binary Wasm emission, engine validation
and type display. The suite also includes a higher-order refinement-relation chain;
its symbolic evidence substitutions are counted separately and remain under the same
proof-work envelope. Individual phase times are recorded for every sample. Artifact
encoding is part of emission, unlike the obsolete TTBC baseline. Node startup,
source generation, Module/Instance construction and execution are outside this clock.
Two warmups precede each workload; GC is incidental. RSS snapshots are not peak
live memory. Workload implementations run at size 20 to check independent expected
values; large wrapper chains are compilation-only and may exceed runtime limits.

Deterministic regression envelopes for these specific workloads:

- type nodes <= 16*n+100;
- scheme instantiation visits <= 12*n+100;
- refinement work <= 50*n+200; refinement substitutions are reported explicitly;
- Wasm functions <= n+64; emitted bytes <= 400*n+10000;
- wide records have exactly n projection steps and zero instantiation visits.

These are not whole-language complexity proofs. Inputs are hashed before and after;
raw samples, runtime executable hash, Node/V8, machine and phases are retained.
The full local benchmark command exercises all workload classes at 500/1,000/2,000.
Older TTBC/Wasm-handoff benchmark files used different snapshots or boundaries and
are historical only; no speedup claim may be inferred by directly comparing their totals.

`benchmarks/helper-linking-1000.json` is compact matched same-machine before/after
evidence for demand-driven runtime-helper linking. It retains every one of the eleven
raw total-time samples at n=1,000, workload provenance/work metrics, plus focused
literal before/after size data. The complete 500/1,000/2,000 raw runs were executed
locally but are not committed because they are not needed by verification. At n=1,000,
the five workloads lose 26-29 Wasm functions and 1,296-1,457 artifact bytes. A tiny
`return 1` artifact drops from 41 functions / 2,275 bytes to 7 / 573 in the focused
regression. Median compiler wall times move in both directions across workloads and
sizes, so this iteration claims a deterministic code-size/work reduction, not a
compile-latency win. The new `runtime_functions` counter makes the linked helper
closure visible to future work gates.

`npm run bench:runtime` separately records WebAssembly.validate, Module creation,
Instance creation, and 100 calls per sample on a 1,000-element map/fold workload.
Checksums use an independent mathematical result. Execution excludes result
decoding, includes allocation/work, resets the bump pointer each call and reuses
grown linear memory. Identical module bytes may hit V8's caches, and lazy engine
compilation may occur at first execution. These are warm-process observations,
not cold-engine latency or a complete runtime benchmark suite.

`benchmarks/helper-linking-runtime.json` records the same runtime harness after
helper linking: that workload falls from 44 to 23 total Wasm functions and from
45,854 to 44,884 bytes. The warm-process execution/engine medians are retained as
observations only because V8 caching, lazy compilation and ordinary noise prevent a
clean runtime-speed attribution from this single run.

Cold process compilation, resident edits, sustained memory growth, other engines,
complex application execution, code-size optimization and adversarial scaling
remain open production gates. No matched comparison with the archived C++ compiler
or proof of a runtime speedup is claimed.
