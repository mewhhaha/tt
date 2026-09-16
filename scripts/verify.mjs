#!/usr/bin/env node
/** Local verification: Node alone, no installs, compiler downloads, or CI artifacts. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { run, compile, execute } from '../src/compiler.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 120_000 });
  if (result.error) throw result.error; if (result.status !== 0) throw new Error(`command failed (${result.status}): node ${args.join(' ')}`);
};
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required');
  console.log(`Local runtime: ${process.version} / V8 ${process.versions.v8} / ${process.platform} ${process.arch}`);
  for (const dir of ['src', 'scripts', 'benchmarks', 'tests'])
    for (const name of readdirSync(join(root, dir)).filter(n => n.endsWith('.mjs')).sort()) child(['--check', join(dir, name)]);
  child(['--test', ...readdirSync(join(root, 'tests')).filter(n => n.endsWith('.test.mjs')).sort().map(n => join('tests', n))]);
  const expected = { 'refinements.tt': '42', 'higher_order.tt': '12', 'branch_proofs.tt': '[0, 0, 42]',
    'records.tt': '[{ .position = 13; .name = "first"; }, { .position = 23; .name = "second"; }]' };
  assert.deepEqual(readdirSync(join(root, 'examples')).filter(n => n.endsWith('.tt')).sort(), Object.keys(expected).sort());
  for (const [name, want] of Object.entries(expected)) {
    const source = readFileSync(join(root, 'examples', name), 'utf8'), result = run(source);
    assert.equal(result.output, want); const wasm = Buffer.from(result.wasm);
    assert.equal(WebAssembly.validate(wasm), true); assert.equal(execute(wasm).output, want); console.log(`Example source/artifact: ${name} passed`);
  }
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const sample = readme.match(/```blot\n([\s\S]*?)```/); assert.ok(sample, 'README must contain an executable example');
  assert.equal(run(sample[1]).output, '42'); console.log('README program passed');
  child(['benchmarks/run.mjs', '--samples', '11']);
  child(['benchmarks/wasm-runtime.mjs']);
  // Run outside the source tree with PATH removed: the compiler needs only its Node runtime and source modules.
  const dir = mkdtempSync(join(tmpdir(), 'tt-standalone-'));
  try {
    const r = spawnSync(process.execPath, [join(root, 'src/cli.mjs'), 'run', join(root, 'examples/refinements.tt')],
      { cwd: dir, env: {}, encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), '42');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(existsSync(join(root, 'node_modules')), false, 'verification must not require installed packages');
  console.log('PASS: local Node compiler, Wasm-only output, examples, work gates, engine stages and standalone execution');
} catch (e) { console.error(`FAIL: ${e.message}`); process.exitCode = 1; }
