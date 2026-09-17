# 2026-09-17 — validate Wasm allocation starts

## Hypothesis

Because current TT artifacts use two contiguous object arenas—the compiler-built static pool and a successful invocation's bump heap—the Node host can reject aligned interior pointers without changing the Wasm ABI or generated code. A lazy arena walk using the same tag/count layout as emission should make the check bounded by the highest referenced allocation and keep large flat-result decoding within a small absolute host-side overhead.

## Counterexample and change

Before this iteration, `readValue` checked alignment, region bounds, tags, headers, graph cycles and nesting but not allocation starts. For an Int at address 256, address 264 is 8-byte aligned and its zeroed auxiliary/depth words form `tag=Unit, len=0`; the exact live-main decoder returned `null` for that forged pointer. The same issue existed in static storage.

The host now validates `heap_start` against instantiated memory, maintains one compact bit per 8-byte slot, and lazily scans the static or current live dynamic arena through a requested pointer. Object size is derived exactly from the existing layout: 16 bytes for Unit/Bool, 24 for Int, `16+bytes` for Text, `16+4*count` for Array/Closure, and `16+8*count` for Record, rounded to 8 bytes. Only marked starts are decodable. The scan frontier is monotonic so repeated graph edges do not rescan earlier allocations. It does not inspect later unreachable allocations.

Compatibility is deliberate: current artifacts publish `live_heap_end` after a successful run and get dynamic start validation. Older ABI-2 artifacts leave the watermark zero; their dynamic decoder path retains the previous page-bound behavior rather than changing ABI-2 compatibility retroactively. Static starts remain derivable and checked.

## Regression and local evidence

Pre-change production host: Git blob `0190ad5c51d3ee47c1d4fd5b048467a0da9c793d` from live main `77a13c0d412a11904131b4ff23640b8060adc199`.

Against that exact host, the existing four result-graph tests passed while both new dynamic/static interior-pointer tests failed with `Missing expected exception.` After the patch:

    node --test tests/result-integrity.test.mjs
    # 8/8 passed

    npm test
    # 115/115 passed

    npm run verify
    # 115 tests, four examples, README, standalone Wasm, compile work gates,
    # and 1,000-element map/fold engine-stage check passed

    npm run bench -- --sizes 500,1000,2000 --samples 11 --output benchmarks/run9-compile-optimized.json
    # passed all existing work gates

    npm run bench:runtime
    # checksum 500500; 11 samples, 100 calls/sample

The broad workspace is reconstructed because outbound public DNS prevents a fresh clone. The changed backend baseline and relevant current tests were reconstructed from live GitHub; unchanged older frontend files come from the recovered Node/Wasm handoff. Therefore 115 is not presented as a clean-checkout current-main aggregate or cross-platform qualification.

## Cost observation

A dedicated synthetic benchmark used identical contiguous dynamic Int arenas and alternated the exact old/new `readValue` implementations for 11 samples per size. Median decode times on Node 22.16.0 / Linux x64:

| values | before | after | delta |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.198 ms | 0.209 ms | +0.011 ms |
| 10,000 | 0.360 ms | 0.580 ms | +0.220 ms |
| 100,000 | 5.117 ms | 6.156 ms | +1.039 ms |

The small samples are noisy; no asymptotic or general slowdown claim is made. The implementation does not change checking, emission or Wasm engine stages. Raw alternating samples are retained in `benchmarks/allocation-start-integrity.json`.

## Remaining work

This validates allocation starts under the compiler/runtime's documented arena discipline; it is not a hostile-Wasm proof. It also does not provide reclamation, persistent host values or callable escaping closures. Next continue the ownership/host-callable-closure boundary and memory-management design, while keeping allocation/lifetime evidence separate from type refinements and nominal authority.
