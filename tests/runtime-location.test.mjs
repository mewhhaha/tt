import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, execute, run, TTError } from '../src/compiler.mjs';

const trapped = (source, code = 'E_RUNTIME') => {
  try { run(source); assert.fail('expected TT runtime failure'); }
  catch (e) { assert.ok(e instanceof TTError); assert.equal(e.code, code); return e; }
};

test('Wasm traps retain the precise source operation that caused the failure', () => {
  for (const [source, needle, message] of [
    ['let x=1; let y=0; return x / y;', '/', /division by zero/],
    ['return get [1,2] 9;', 'get', /bounds/],
    ['return map (fn x=>1/(x-x)) [1];', '/', /division by zero/],
  ]) {
    const error = trapped(source); assert.match(error.message, message); assert.equal(error.pos, source.indexOf(needle));
  }
});

test('runtime-loop fuel traps restore the higher-order call site after callback execution', () => {
  const source = 'return map (fn x=>x+1) [1,2,3];', wasm = compile(source).wasm;
  const wanted = new Set([source.indexOf('map'), source.indexOf('+')]), seen = new Set();
  for (let fuel = 0; fuel < 80 && seen.size < wanted.size; fuel++) {
    try { execute(wasm, { fuel }); }
    catch (e) {
      if (!(e instanceof TTError) || e.code !== 'E_LIMIT') throw e;
      if (wanted.has(e.pos)) seen.add(e.pos);
    }
  }
  assert.deepEqual(seen, wanted);
});

test('CLI run converts Wasm trap offsets into source line and column diagnostics', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-location-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = 'let text="🙂";\nlet zero=0;\nreturn 1 / zero;\n', file = join(dir, 'trap.tt'); writeFileSync(file, source);
  const result = spawnSync(process.execPath, [new URL('../src/cli.mjs', import.meta.url).pathname, 'run', file],
    { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  const pos = source.indexOf('/'), before = source.slice(0, pos), line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
  assert.match(result.stderr, new RegExp(`${line}:${column}: E_RUNTIME: division by zero`));
});
