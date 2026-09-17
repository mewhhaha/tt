#!/usr/bin/env node
/** Matched frontend-only comparison. Supply a local pre-change src directory. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check, compile, execute } from '../src/compiler.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const prefix = 'const P=Int where self>0;let positive=fn(x :: P)=>x;';
export function workload(name, n) {
  if (name === 'forwarded_discard') return prefix +
    'let f0=fn f=>fn x=>do {let ignored=f x;return 7;};' +
    Array.from({ length: n }, (_, i) => `let f${i + 1}=fn f=>fn x=>f${i} f x;`).join('') +
    `return f${n} positive 2;`;
  if (name === 'repeated_discard') return prefix +
    'let discard=fn f=>fn x=>do {let ignored=f x;return 7;};let f=discard positive;' +
    Array.from({ length: n }, (_, i) => `let x${i}=f 2;`).join('') + `return x${n - 1};`;
  if (name === 'identity_relations') return prefix +
    'let id=fn x=>x;let apply=fn f=>fn x=>f x;let f0=id;' +
    Array.from({ length: n }, (_, i) => `let f${i + 1}=apply f${i};`).join('') +
    `let answer :: P=f${n} 2;return answer;`;
  if (name === 'ordinary_refined_calls') return prefix +
    Array.from({ length: n }, (_, i) => `let x${i}=positive 2;`).join('') + `return x${n - 1};`;
  throw new Error(`unknown workload ${name}`);
}
const sourceHashes = directory => Object.fromEntries(readdirSync(directory)
  .filter(name => name.endsWith('.mjs')).sort().map(name => [name, hash(readFileSync(resolve(directory, name)))]));

export async function benchmark(baselineDirectory) {
  const beforeHashes = sourceHashes(baselineDirectory), afterHashes = sourceHashes(root);
  assert.deepEqual(Object.keys(beforeHashes), Object.keys(afterHashes));
  for (const name of Object.keys(afterHashes)) if (name !== 'refine.mjs')
    assert.equal(beforeHashes[name], afterHashes[name], `unmatched production input ${name}`);
  const baseline = await import(pathToFileURL(resolve(baselineDirectory, 'compiler.mjs')));
  const rows = [];
  for (const [name, sizes] of [
    ['forwarded_discard', [100, 200, 400]], ['repeated_discard', [1000]],
    ['identity_relations', [1000]], ['ordinary_refined_calls', [1000]],
  ]) for (const size of sizes) {
    const source = workload(name, size), small = workload(name, 10);
    const oldBytes = baseline.compile(source).wasm, newBytes = compile(source).wasm;
    assert.deepEqual(newBytes, oldBytes, 'checker-only fix must not alter accepted-program Wasm');
    const expected = name.includes('discard') ? 7n : 2n;
    assert.equal(execute(baseline.compile(small).wasm).value, expected);
    assert.equal(execute(compile(small).wasm).value, expected);
    for (let i = 0; i < 3; i++) { baseline.check(source); check(source); }
    const raw = { before: [], after: [] }, phases = { before: [], after: [] };
    for (let i = 0; i < 11; i++) for (const label of i % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now(), result = label === 'before' ? baseline.check(source) : check(source);
      raw[label].push(performance.now() - start);
      phases[label].push({ parse_ms: result.metrics.parse_ms, type_ms: result.metrics.type_ms, refine_ms: result.metrics.refine_ms });
      assert.equal(result.type, 'Int');
    }
    const oldWork = baseline.check(source).metrics, newWork = check(source).metrics;
    assert.ok(newWork.proof_steps < 40 * size + 100);
    assert.ok(newWork.refinement_substitutions < 12 * size + 100);
    const work = metrics => Object.fromEntries(Object.entries(metrics).filter(([name]) => !name.endsWith('_ms')));
    rows.push({ name, size, source_sha256: hash(source), wasm_sha256: hash(newBytes), wasm_bytes: newBytes.length,
      identical_wasm: true, raw_ms: raw, phases, median_ms: { before: median(raw.before), after: median(raw.after) },
      work: { before: work(oldWork), after: work(newWork) } });
  }
  assert.deepEqual(sourceHashes(baselineDirectory), beforeHashes);
  assert.deepEqual(sourceHashes(root), afterHashes);
  return { schema: 1, recorded_at: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, node_binary_sha256: hash(readFileSync(process.execPath)),
    harness_sha256: hash(readFileSync(fileURLToPath(import.meta.url))), before_source_sha256: beforeHashes,
    after_source_sha256: afterHashes, samples: 11, warmups: 3,
    boundary: 'warm in-process check: parsing, structural inference, refinement checking and type display; excludes Wasm emission/validation/execution/host decode/display and source generation; includes incidental GC',
    parity: 'all timed programs produce byte-identical Wasm before/after; size-10 counterparts execute through real Wasm; deep wrapper artifacts are compiler-only tests',
    claims: 'local correctness and work evidence; no whole-compiler complexity or general speed claim', rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('usage: node benchmarks/deferred-calls.mjs BASELINE_SRC OUTPUT.json');
  const report = await benchmark(resolve(process.argv[2]));
  writeFileSync(resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n');
  for (const r of report.rows) console.log(`${r.name}/${r.size}: ${r.median_ms.before.toFixed(3)} -> ${r.median_ms.after.toFixed(3)} ms; proof ${r.work.before.proof_steps} -> ${r.work.after.proof_steps}`);
}
