import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, check, execute, loadWasm, run, readValue, TTError } from '../src/compiler.mjs';
import { MIN, MAX } from '../src/core.mjs';
import { uleb, sleb } from '../src/wasm-binary.mjs';
const rejects = (fn, code, message) => assert.throws(fn, e => e instanceof TTError && e.code === code && (!message || message.test(e.message)));

test('real standalone Wasm: standard magic, no imports, no source/interpreter needed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-wasm-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bytes = compile('let make=fn x=>fn y=>x+y; return make 40 2;').wasm;
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]); assert.ok(WebAssembly.validate(bytes));
  const module = new WebAssembly.Module(bytes); assert.deepEqual(WebAssembly.Module.imports(module), []);
  const file = join(dir, 'only.wasm'); writeFileSync(file, bytes);
  const script = `const fs=require('node:fs'); const b=fs.readFileSync(process.argv[1]);
    const m=new WebAssembly.Module(b); const i=new WebAssembly.Instance(m, {});
    const p=i.exports.main(); console.log(new DataView(i.exports.memory.buffer).getBigInt64(p+16,true).toString());`;
  const result = spawnSync(process.execPath, ['-e', script, file], { cwd: dir, env: {}, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), '42');
});

test('no active custom-bytecode target, VM or TT source interpreter remains', () => {
  const files = readdirSync(new URL('../src/', import.meta.url));
  assert.ok(!files.includes('vm.mjs')); assert.ok(!files.includes('bytecode.mjs'));
  const source = readFileSync(new URL('../src/compiler.mjs', import.meta.url), 'utf8');
  assert.match(source, /WasmEmit/); assert.doesNotMatch(source, /new VM|\beval\s*\(/);
  assert.equal(check('return 42;').wasm, null);
});

test('Wasm runtime helpers and native closures are linked only when demanded', () => {
  const tiny = compile('return 1;');
  assert.equal(tiny.metrics.runtime_functions, 5, 'fuel/error/tick support is the irreducible closed-program runtime');
  assert.equal(tiny.metrics.wasm_functions, 7, 'tiny program adds only entry and main');
  assert.ok(tiny.metrics.wasm_bytes < 1000, `tiny artifact unexpectedly large: ${tiny.metrics.wasm_bytes}`);

  const arithmetic = compile('return 1+2;');
  assert.ok(arithmetic.metrics.runtime_functions > tiny.metrics.runtime_functions);
  assert.ok(arithmetic.metrics.wasm_bytes > tiny.metrics.wasm_bytes);
  assert.equal(execute(arithmetic.wasm).output, '3');

  const cases = [
    ['return length [1,2,3];', '3'],
    ['return get [40,2] 1;', '2'],
    ['return map (fn x=>x+1) [1,2];', '[2, 3]'],
    ['return fold (fn a=>fn x=>a+x) 0 [1,2,3];', '6'],
    ['return concat "a" "b";', '"ab"'],
    ['return textLength "é";', '2'],
  ];
  for (const [source, output] of cases) {
    const built = compile(source);
    assert.ok(built.metrics.runtime_functions < 39, `${source} linked the complete historical runtime`);
    assert.equal(execute(built.wasm).output, output);
  }

  // A native may be returned rather than called. Its indirect target must still
  // be retained even though no source Call node reaches it in this program.
  assert.equal(execute(compile('return map;').wasm).output, '<fn>');
});

test('Wasm integer arithmetic matches BigInt at boundaries and across generated i64 pairs', () => {
  const values = [MIN, MIN + 1n, -(1n << 32n), -3037000500n, -1n, 0n, 1n, 2n, 3037000500n, 1n << 32n, MAX - 1n, MAX];
  let seed = 41n; for (let i = 0; i < 20; i++) { seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n); values.push(BigInt.asIntN(64, seed)); }
  let cases = 0;
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
    // Full boundary cross product; generated values paired by a fixed coprime stride.
    if (i >= 12 && j !== (i * 7 + 3) % values.length) continue;
    const a = values[i], b = values[j];
    for (const op of ['+', '-', '*', '/', '%']) {
      const bytes = compile(`return (${a}) ${op} (${b});`).wasm; cases++;
      if ((op === '/' || op === '%') && b === 0n) { rejects(() => execute(bytes), 'E_RUNTIME', /zero/); continue; }
      const expected = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b;
      if (expected < MIN || expected > MAX) rejects(() => execute(bytes), 'E_RUNTIME', /overflow/);
      else assert.equal(execute(bytes).value, expected, `${a} ${op} ${b}`);
    }
  }
  assert.equal(cases, 2020);
});

test('strict evaluation and short circuiting are Wasm control flow, including trap order', () => {
  assert.equal(run('return if false then 1/0 else 42;').output, '42');
  assert.equal(run('return false && (1/0 == 0);').output, 'false');
  assert.equal(run('return true || (1/0 == 0);').output, 'true');
  for (const src of ['let unused=1/0; return 42;', 'return { .a=1/0; .b=9223372036854775807+1; };', 'return [1/0,9223372036854775807+1];'])
    rejects(() => run(src), 'E_RUNTIME', /division by zero/);
});

test('distinct static and dynamic captures, aliases, curried builtins, and collection closures', () => {
  const cases = [
    ['let mk=fn x=>fn y=>x-y; let a=mk 50; let b=mk 9; return a 8 + b 9;', '42'],
    ['let a=get [1,42]; let b=get [9,10]; return a 1;', '42'],
    ['let fs=map (fn x=>fn y=>x+y) [40,41,42]; return (get fs 0) 2;', '42'],
    ['let fs=map (fn x=>fn y=>x+y) [1,2,3]; return fold (fn a=>fn f=>a+f 10) 0 fs;', '36'],
    ['let f=fn x=>{ .left=fn y=>x-y; .right=fn y=>y-x; }; let r=f 10; return r.left 4+r.right 4;', '0'],
    ['return concat (concat "é" "🙂") "界";', '"é🙂界"'],
    ['return map (fn r=>r.x) [{.x=1;.y=2;},{.y=3;.x=42;}];', '[1, 42]'],
  ];
  for (const [source, output] of cases) assert.equal(run(source).output, output);
});

test('engine fuel checks work and instance entry resets heap, depth and fuel', () => {
  const bytes = compile('return map (fn x=>x+1) [1,2,3];').wasm;
  rejects(() => execute(bytes, { fuel: 0 }), 'E_LIMIT', /fuel/);
  rejects(() => execute(bytes, { fuel: 10 }), 'E_LIMIT', /fuel/);
  const { module, abi } = loadWasm(bytes), instance = new WebAssembly.Instance(module, {});
  const e = instance.exports; e.set_fuel(1000n);
  const first = e.main(), a = readValue(e.memory, first, abi), remaining = e.fuel_remaining();
  const second = e.main(), b = readValue(e.memory, second, abi); assert.equal(first, second); assert.deepEqual(a, b); assert.equal(e.fuel_remaining(), remaining);
  e.set_fuel(0n); assert.throws(() => e.main(), WebAssembly.RuntimeError); assert.equal(e.error_code(), 8);
  e.set_fuel(1000n); e.main(); assert.equal(e.error_code(), 0);
});

test('Wasm memory growth preserves contents and checked allocation stays within a fixed maximum', () => {
  const values = Array.from({ length: 4000 }, (_, i) => String(i)).join(',');
  assert.equal(run(`let a=map (fn x=>x+1) [${values}]; return get a 3999;`).output, '4000');
  const { instance } = run('return 42;');
  assert.throws(() => instance.exports.memory.grow(1024), RangeError);
});

test('artifact integrity, TT ABI and decoding are checked independently of Wasm type validity', () => {
  const bytes = compile('return "hello";').wasm, altered = Buffer.from(bytes), at = altered.indexOf(Buffer.from('hello'));
  altered[at] = 0xff; assert.equal(WebAssembly.validate(altered), true); rejects(() => loadWasm(altered), 'E_WASM', /integrity/);
  const { module, abi } = loadWasm(bytes), i = new WebAssembly.Instance(module, {}), p = i.exports.main();
  new Uint8Array(i.exports.memory.buffer)[p + 16] = 0xff; rejects(() => readValue(i.exports.memory, p, abi), 'E_WASM', /UTF-8/);
  rejects(() => readValue(i.exports.memory, 1, abi), 'E_WASM');
  rejects(() => loadWasm(Buffer.from([0,97,115,109,1,0,0,0])), 'E_WASM', /tt.abi/);
});

test('unsigned/signed LEB boundary encodings are exact', () => {
  assert.deepEqual(uleb(0), [0]); assert.deepEqual(uleb(128), [128,1]); assert.deepEqual(uleb(0xffffffff), [255,255,255,255,15]);
  assert.deepEqual(sleb(-1), [127]); assert.deepEqual(sleb(64), [192,0]); assert.deepEqual(sleb(-65), [191,127]);
  assert.equal(sleb(MIN).length, 10); assert.equal(sleb(MAX).length, 10);
  for (const n of [-1, 0x100000000, NaN, Infinity, 1.5]) assert.throws(() => uleb(n), RangeError);
});
