import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lex, Parser } from '../src/syntax.mjs';
import { lex as reference } from './lexer-reference.mjs';
import { compile, compileProject, execute, TTError } from '../src/compiler.mjs';
import { LIMITS } from '../src/core.mjs';
const outcome = (fn, source) => {
  try { return { tokens: fn(source) }; }
  catch (e) { assert.ok(e instanceof TTError || e instanceof TypeError); return { name: e.name, code: e.code, pos: e.pos, message: e.message }; }
};
const parity = source => assert.deepEqual(outcome(lex, source), outcome(reference, source));

test('tokenizer agrees with frozen baseline on fixtures, every ASCII boundary and EOF', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
  for (const fixture of fixtures) parity(fixture.source);
  for (let c = 0; c < 128; c++) for (const prefix of ['', 'a', '9', '@', '/', '"']) {
    parity(prefix + String.fromCharCode(c));
    parity(prefix + String.fromCharCode(c) + 'z 42;');
  }
  for (const source of ['', 'foo', '0', '@slice', '/', '//', '//tail', '//tail\n', '1e9', '===', '....', '&&&', 'é', '🙂', '\u00a0', '\ufeff']) parity(source);
});

test('Text spans preserve all escapes, Unicode, BOM and error offsets', () => {
  for (const body of ['', 'plain', 'é🙂界\ufeff', '\n\r\t', '\\n', '\\r', '\\t', '\\"', '\\\\', 'a\\nb\\tc', '\\\\\\"', '\\x', '\\u1234', '\\🙂']) {
    for (const tail of ['";', '', '\\', '\\"', '"next']) parity('return "' + body + tail);
  }
  for (const source of ['\ud800', '"\udfff"', '//\ud800', '"🙂"', '"\ufeffx"', '"a\\x"', '"abc\\']) parity(source);
  assert.equal(execute(compile('return "é🙂\\n\\t\\\"\\\\";').wasm).value, 'é🙂\n\t"\\');
});

test('5000 seeded mixed source strings preserve tokens or exact rejection diagnostics', () => {
  let seed = 9123; const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const chars = 'abcXYZ_@098 /\t\n\r"\\=><!&|.(){}[];,:+-*%~é🙂';
  for (let n = 0; n < 5000; n++) {
    let source = ''; const size = next() % 200;
    for (let i = 0; i < size; i++) source += chars[next() % chars.length];
    parity(source);
  }
});

test('large escaped/unescaped Text and token/source limits keep baseline decisions', () => {
  for (const text of ['a'.repeat(512 * 1024), 'é🙂'.repeat(16384), 'abc\\n'.repeat(16384)]) parity('return "' + text + '";');
  parity(' '.repeat(LIMITS.sourceBytes + 1));
  // Exactly the limit is admitted; the first excess token preserves its offset.
  const exact = ';'.repeat(LIMITS.tokens);
  assert.equal(lex(exact).length, LIMITS.tokens + 1);
  parity(exact + ';');
  assert.throws(() => lex(42), TypeError);
});

test('absent AST child vectors are shared and immutable; real vectors are isolated', () => {
  const ast = new Parser('let a=[1,2];let b=[3];return {.a=a;.b=b;};').parse();
  const leaf = ast.nodes.find(e => e.kind === 'Int'), arrays = ast.nodes.filter(e => e.kind === 'Array');
  assert.equal(leaf.items, leaf.fields); assert.equal(leaf.fields, leaf.bindings);
  assert.ok(Object.isFrozen(leaf.items));
  assert.throws(() => leaf.items.push(0), TypeError);
  assert.notEqual(arrays[0].items, arrays[1].items);
  assert.equal(arrays[0].items.length, 2); assert.equal(arrays[1].items.length, 1);
  for (const n of [100, 1000, 10000]) {
    const parsed = new Parser('return [' + Array.from({length:n}, (_,i)=>i).join(',') + '];').parse();
    const empty = new Set(parsed.nodes.filter(e => e.kind === 'Int').flatMap(e => [e.items, e.fields, e.bindings]));
    assert.equal(empty.size, 1, 'one absent-vector allocation, not three per AST node');
    assert.equal(parsed.nodes.length, n + 2);
  }
});

test('offset fast path preserves imported parse, runtime, ownership and effect diagnostics', () => {
  const source = 'return "🙂\\n";', a = new Parser(source), b = new Parser(source, {offset:41});
  assert.deepEqual(b.tokens, a.tokens.map(t=>({...t,pos:t.pos+41})));
  const project = new Map([['main.tt','let L=import "./lib.tt";return L.f ();'], ['lib.tt','let f=fn u=>\n 1/0;return {.f=f;};']]);
  assert.throws(()=>execute(compileProject('main.tt',project).wasm),e=>e.code==='E_RUNTIME'&&e.source.name==='lib.tt'&&e.source.line===2);
  project.set('lib.tt','return "bad\\x";');
  assert.throws(()=>compileProject('main.tt',project),e=>e.code==='E_PARSE'&&e.source.name==='lib.tt'&&e.source.column===13);
  for (const source of ['let a=@own [1];let b=@move a;return @take(@move a);', 'effect E :: Unit -> Int;return E ();', 'const P=Int where self>0;let a :: P=-1;return a;'])
    assert.throws(()=>compile(source),e=>['E_OWNERSHIP','E_EFFECT_UNHANDLED','E_REFINEMENT'].includes(e.code));
});
