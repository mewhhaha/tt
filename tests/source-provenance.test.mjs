import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, execute, loadWasm, TTError } from '../src/compiler.mjs';

test('emitted Wasm carries compact hashed source provenance without source text', () => {
  const source = 'let text="🙂";\nlet zero=0;\nreturn 1 / zero;\n';
  const wasm = compile(source, { sourceName: 'demo/trap.tt' }).wasm, loaded = loadWasm(wasm);
  assert.equal(loaded.source.name, 'demo/trap.tt');
  assert.equal(loaded.source.sha256, createHash('sha256').update(Buffer.from(source)).digest('hex'));
  assert.equal(loaded.source.units, source.length); assert.equal(loaded.source.lines, 4);
  assert.equal(Buffer.from(wasm).includes(Buffer.from(source)), false, 'artifact must not embed full source text');
  assert.throws(() => execute(wasm), e => e instanceof TTError && e.source?.line === 3 && e.source?.column === 10 && e.source?.name === 'demo/trap.tt');
});

test('standalone CLI exec reports embedded source name, line and column after source deletion', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-source-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = 'let text="🙂";\nlet zero=0;\nreturn 1 / zero;\n', file = join(dir, 'trap.tt'), out = join(dir, 'trap.wasm');
  writeFileSync(file, source); const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
  const built = spawnSync(process.execPath, [cli, 'build', file, '-o', out], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(built.status, 0, built.stderr); rmSync(file);
  const result = spawnSync(process.execPath, [cli, 'exec', out], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /trap\.tt:3:10: E_RUNTIME: division by zero/);
  assert.equal(result.stderr.includes(dir), false, 'artifact diagnostics must not embed the build machine path');
});

test('sourceName metadata rejects control characters and excessive labels', () => {
  assert.throws(() => compile('return 1;', { sourceName: 'bad\nname.tt' }), TypeError);
  assert.throws(() => compile('return 1;', { sourceName: 'x'.repeat(4097) }), TypeError);
});
