import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const command = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000 });
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'tt-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function source(dir, text, name = 'input.tt') { const path = join(dir, name); writeFileSync(path, text); return path; }
const ok = r => { assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stderr); return r; };

test('CLI check, run, metrics, build, exec; no source or working-directory dependency', t => {
  const dir = temp(t), path = source(dir, 'let make=fn x=>fn y=>x+y; return make 40 2;'), out = join(dir, 'out.wasm');
  assert.match(ok(command('check', path)).stdout, /Int/);
  const result = ok(command('run', path, '--metrics')); assert.equal(result.stdout.trim(), '42');
  const metrics = JSON.parse(result.stderr); assert.ok(metrics.ast_nodes > 0); assert.ok(metrics.type_ms >= 0);
  ok(command('build', path, '-o', out)); rmSync(path);
  const restored = spawnSync(process.execPath, [cli, 'exec', out], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
  assert.equal(ok(restored).stdout.trim(), '42');
});

test('CLI usage, missing file, invalid UTF-8 and locations', t => {
  const dir = temp(t);
  assert.equal(command().status, 2); ok(command('--help')); assert.match(ok(command('--version')).stdout, /Node.js/);
  assert.equal(command('other', 'file').status, 2);
  assert.match(command('check', join(dir, 'absent')).stderr, /E_IO/);
  assert.match(command('check', dir).stderr, /E_IO/);
  assert.match(command('check', source(dir, Buffer.from([0xff]))).stderr, /E_PARSE/);
  const bad = command('check', source(dir, 'let x=1;\nreturn missing;'));
  assert.match(bad.stderr, /:2:8: E_NAME/);
});

test('failed compilation or rename preserves output and cleans staging file', t => {
  const dir = temp(t), out = join(dir, 'out.wasm'); writeFileSync(out, 'previous');
  assert.notEqual(command('build', source(dir, 'return missing;'), '-o', out).status, 0);
  assert.equal(readFileSync(out, 'utf8'), 'previous');
  const directory = join(dir, 'directory.wasm'); mkdirSync(directory);
  const good = source(dir, 'return 42;'); assert.match(command('build', good, '-o', directory).stderr, /E_IO/);
  assert.ok(existsSync(directory)); assert.equal(readdirSync(dir).filter(p => p.includes('.tmp.')).length, 0);
  assert.match(command('build', good, '-o', good).stderr, /E_USAGE/); assert.equal(readFileSync(good, 'utf8'), 'return 42;');
  const same = source(dir, 'return 43;', 'same.wasm');
  assert.match(command('build', same, '-o', same).stderr, /E_USAGE/); assert.equal(readFileSync(same, 'utf8'), 'return 43;');
  assert.match(command('build', good, '-o', join(dir, 'forbidden.js')).stderr, /E_USAGE/);
});

test('concurrent builds publish complete artifacts atomically', async t => {
  const dir = temp(t), out = join(dir, 'shared.wasm'), a = source(dir, 'return 42;', 'a.tt'), b = source(dir, 'return 43;', 'b.tt');
  const build = path => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'build', path, '-o', out], { timeout: 10_000 });
    let stderr = ''; child.stderr.on('data', d => { stderr += d; }); child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([build(a), build(b)]);
  assert.ok(['42', '43'].includes(ok(command('exec', out)).stdout.trim()));
  assert.equal(readdirSync(dir).filter(p => p.includes('.tmp.')).length, 0);
});

test('repeated CLI builds are byte-for-byte deterministic', t => {
  const dir = temp(t), path = source(dir, 'return map (fn x=>x+1) [1,2,3];'), a = join(dir, 'a.wasm'), b = join(dir, 'b.wasm');
  ok(command('build', path, '-o', a)); ok(command('build', path, '-o', b)); assert.deepEqual(readFileSync(a), readFileSync(b));
});
