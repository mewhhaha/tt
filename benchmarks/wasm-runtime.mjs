#!/usr/bin/env node
/** Wasm engine stages are timed separately from TT checking/emission. */
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { compile, readValue, loadWasm } from '../src/compiler.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const sources = () => Object.fromEntries(readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.mjs')).sort()
  .map(f => [f, sha(readFileSync(new URL('../src/' + f, import.meta.url)))]));
const before = sources(), n = 1000;
const source = `let xs=[${Array.from({ length: n }, (_, i) => i).join(',')}]; return fold (fn sum=>fn x=>sum+x) 0 (map (fn x=>x+1) xs);`;
const start = performance.now(), c = compile(source), compiler_ms = performance.now() - start;
const { abi } = loadWasm(c.wasm), raw = [], expected = BigInt(n * (n + 1) / 2);
for (let sample = -2; sample < 11; sample++) {
  let time = performance.now(); const valid = WebAssembly.validate(c.wasm), validation_ms = performance.now() - time; assert.ok(valid);
  time = performance.now(); const module = new WebAssembly.Module(c.wasm), module_ms = performance.now() - time;
  time = performance.now(); const instance = new WebAssembly.Instance(module, {}), instantiate_ms = performance.now() - time;
  assert.equal(readValue(instance.exports.memory, instance.exports.main(), abi), expected);
  time = performance.now(); let ptr;
  for (let i = 0; i < 100; i++) ptr = instance.exports.main();
  const execute_100_ms = performance.now() - time;
  assert.equal(readValue(instance.exports.memory, ptr, abi), expected);
  if (sample >= 0) raw.push({ validation_ms, module_ms, instantiate_ms, execute_100_ms });
}
assert.deepEqual(sources(), before);
const report = { schema: 1, recorded_at: new Date().toISOString(), node: process.version, v8: process.versions.v8,
  platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node_sha256: sha(readFileSync(process.execPath)),
  compiler_source_sha256: before, harness_sha256: sha(readFileSync(new URL(import.meta.url))), source_sha256: sha(source), wasm_sha256: sha(c.wasm),
  compiler_ms, compiler_phases: c.metrics, wasm_bytes: c.wasm.length, items: n, warmups: 2, samples: 11, calls_per_sample: 100,
  boundary: 'separate standard engine validate, Module construction, Instance construction and 100 main calls; execution excludes decode/printing; repeated main calls reset per-run allocator/fuel, reuse grown linear memory; V8 may cache previously compiled identical bytes and lazily compile functions; not cold-engine numbers',
  expected_checksum: expected.toString(), raw };
const output = process.argv[2] ?? 'benchmarks/wasm-runtime-local.json'; writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wasm map+fold ${n} elements, checksum ${expected}, ${raw.length} samples, 100 calls each: ${output}`);
