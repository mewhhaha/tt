#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, release } from 'node:os';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, execute } from '../src/compiler.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function workload(name, n) {
  let s = '';
  if (name === 'wrappers') {
    s = 'let f0=fn x=>x;\n';
    for (let i = 1; i <= n; i++) s += `let f${i}=fn x=>f${i - 1} x;\n`;
    return s + `return f${n} 42;\n`;
  }
  if (name === 'records') {
    s = 'let r={ '; for (let i = 0; i < n; i++) s += `.f${i}=${i};`;
    s += '};\n'; for (let i = 0; i < n; i++) s += `let x${i}=r.f${i};\n`;
    return s + `return x${n - 1};\n`;
  }
  if (name === 'polymorphism') {
    s = 'let id=fn x=>x; let getX=fn r=>r.x;\n';
    for (let i = 0; i < n; i++) s += `let x${i}=id (getX { .x=${i}; .tag=true; });\n`;
    return s + `return x${n - 1};\n`;
  }
  if (name === 'refinements') {
    s = 'const Small=Int where self>=0 && self<100; const Pos=Int where self>0; let f :: Small -> Pos=fn x=>x+1;\n';
    for (let i = 0; i < n; i++) s += `let x${i} :: Pos=f ${i % 100};\n`;
    return s + `return x${n - 1};\n`;
  }
  if (name === 'refinement_relations') {
    s = 'const Pos=Int where self>0; let id=fn x=>x; let apply=fn f=>fn x=>f x; let f0=id;\n';
    for (let i = 1; i <= n; i++) s += `let f${i}=apply f${i - 1};\n`;
    return s + `let out :: Pos=f${n} 1; return out;\n`;
  }
  throw new Error('unknown workload');
}
export function assertWork(name, size, work) {
  assert.ok(work.type_nodes <= 16 * size + 100, `${name}: type node growth`);
  assert.ok(work.instantiate_visits <= 12 * size + 100, `${name}: instantiation growth`);
  assert.ok(work.proof_steps <= 50 * size + 200, `${name}: proof work growth`);
  assert.ok(work.wasm_functions <= size + 64, `${name}: Wasm function growth`);
  assert.ok(work.wasm_bytes <= 400 * size + 10000, `${name}: Wasm byte growth`);
  if (name === 'records') { assert.equal(work.projection_steps, size); assert.equal(work.instantiate_visits, 0); }
}
const sha = data => createHash('sha256').update(data).digest('hex');
function provenance() {
  const paths = [resolve(root, 'package.json'), fileURLToPath(import.meta.url),
    ...readdirSync(resolve(root, 'src')).filter(p => p.endsWith('.mjs')).map(p => resolve(root, 'src', p))];
  return Object.fromEntries(paths.sort().map(p => [relative(root, p).replaceAll('\\', '/'), sha(readFileSync(p))]));
}
export function benchmark({ sizes = [500, 1000, 2000], samples = 11 } = {}) {
  assert.ok(Number.isInteger(samples) && samples >= 3 && samples <= 100, 'samples must be 3..100');
  assert.ok(sizes.length > 0 && sizes.every(n => Number.isInteger(n) && n >= 1 && n <= 10_000), 'sizes must be 1..10000');
  const before = provenance(), reports = [];
  for (const size of sizes) {
    const entries = [];
    for (const name of ['wrappers', 'records', 'polymorphism', 'refinements', 'refinement_relations']) {
      const small = compile(workload(name, 20));
      assert.equal(execute(small.wasm).value, name === 'wrappers' ? 42n : name === 'refinements' ? 20n : name === 'refinement_relations' ? 1n : 19n);
      const source = workload(name, size);
      for (let i = 0; i < 2; i++) compile(source);
      const raw = [], rss = [], phases = []; let observed = 0;
      for (let i = 0; i < samples; i++) {
        const start = performance.now(); const result = compile(source);
        observed += result.metrics.type_nodes + result.metrics.wasm_functions;
        raw.push(performance.now() - start); phases.push({ parse_ms: result.metrics.parse_ms, type_ms: result.metrics.type_ms, refine_ms: result.metrics.refine_ms, emit_ms: result.metrics.emit_ms, validation_ms: result.metrics.validation_ms }); rss.push(process.memoryUsage().rss);
      }
      assert.ok(observed > 0); const work = compile(source).metrics; assertWork(name, size, work);
      const sorted = [...raw].sort((a, b) => a - b);
      entries.push({ name, source_bytes: Buffer.byteLength(source), source_sha256: sha(source),
        median_ms: sorted[Math.floor(samples / 2)], raw_ms: raw, phase_ms: phases, rss_after_sample_bytes: rss, work });
    }
    reports.push({ size, samples, workloads: entries });
  }
  assert.deepEqual(provenance(), before, 'inputs changed during measurement');
  return {
    schema: 3, implementation: 'node-js-wasm-only', recorded_at: new Date().toISOString(),
    node: process.version, v8: process.versions.v8, exec_argv: process.execArgv,
    node_binary_sha256: sha(readFileSync(process.execPath)),
    platform: platform(), arch: arch(), kernel: release(), cpu: cpus()[0]?.model, logical_cpus: cpus().length,
    source_sha256: before,
    boundary: 'in-process parse+infer+refine+Wasm binary emission+WebAssembly.validate+type display; phases separately recorded; excludes source generation, startup, engine compilation/instantiation and runtime execution; includes incidental GC, not forced final collection',
    parity: 'each workload executes at size 20 before timing; large wrapper artifacts can exceed Wasm call/value nesting limits and are compiler-only workloads',
    claims: 'Local observations and deterministic work regressions, not production qualification or a matched speedup over the archived C++ implementation. RSS snapshots are not peak/live-set measurements.',
    reports,
  };
}
export function main(args = process.argv.slice(2)) {
  let sizes = [500, 1000, 2000], samples = 11, output = resolve(root, 'benchmarks/local.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sizes' && args[i + 1]) sizes = args[++i].split(',').map(Number);
    else if (args[i] === '--samples' && args[i + 1]) samples = Number(args[++i]);
    else if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
    else throw new Error(`unknown or incomplete option ${args[i]}`);
  }
  const result = benchmark({ sizes, samples }); mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  for (const r of result.reports) console.log(r.size + ': ' + r.workloads.map(w => `${w.name}=${w.median_ms.toFixed(3)} ms`).join(', '));
  console.log(`Evidence: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
