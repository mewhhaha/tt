import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, check, run, execute, loadWasm, TTError } from '../src/compiler.mjs';
import { MIN, MAX, Ranges, comparison } from '../src/core.mjs';
import { Types } from '../src/types.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const rejects = (f, code) => assert.throws(f, e => e instanceof TTError && e.code === code);
function accept(source, output) {
  check(source);
  if (output !== null && output !== undefined) {
    const c = compile(source);
    assert.equal(execute(c.wasm).output, output);
    const bytes = Buffer.from(c.wasm);
    assert.equal(execute(bytes).output, output);
    assert.deepEqual(compile(source).wasm, bytes);
  }
}
for (const [i, fixture] of fixtures.entries()) test(`baseline ${i + 1}: ${fixture.name}`, () => {
  if (fixture.outcome === 'accept') accept(fixture.source, fixture.output);
  else rejects(() => check(fixture.source), fixture.code);
});

test('191751 structural/refinement kernel property checks (legacy VM checks replaced by Wasm tests)', t => {
  let checks = 0;
  const expect = (ok, message) => { assert.ok(ok, message); checks++; };
  for (let a = -5n; a <= 5n; a++) for (let b = a; b <= 5n; b++)
    for (let c = -5n; c <= 5n; c++) for (let d = c; d <= 5n; d++) {
      const x = Ranges.span(a, b), y = Ranges.span(c, d), u = Ranges.unite(x, y), i = Ranges.intersect(x, y), n = Ranges.complement(x);
      expect(Ranges.unite(x, x).equal(x), 'union idempotence');
      expect(Ranges.intersect(x, x).equal(x), 'intersection idempotence');
      expect(u.equal(Ranges.unite(y, x)), 'union commutativity');
      expect(Ranges.complement(n).equal(x), 'double complement');
      for (let v = -6n; v <= 6n; v++) {
        expect(u.contains(v) === (x.contains(v) || y.contains(v)), 'union meaning');
        expect(i.contains(v) === (x.contains(v) && y.contains(v)), 'intersection meaning');
        expect(n.contains(v) !== x.contains(v), 'complement meaning');
      }
      expect(x.subset(y) === (a >= c && b <= d), 'subset meaning');
    }
  for (const n of [MIN, MIN + 1n, -1n, 0n, 1n, MAX - 1n, MAX]) {
    expect(!comparison('!=', n).contains(n), 'hole at boundary');
    expect(Ranges.complement(Ranges.one(n)).equal(comparison('!=', n)), 'boundary complement');
    for (const v of [MIN, -1n, 0n, 1n, MAX]) {
      expect(comparison('<', n).contains(v) === (v < n), 'less boundary');
      expect(comparison('>', n).contains(v) === (v > n), 'greater boundary');
    }
  }
  const types = new Types(), row = types.fresh(1, true), one = types.record([[0, types.integer]], row);
  types.unify(one, types.record([[0, types.integer], [1, types.boolean]]));
  expect(types.find(types.project(one, 1, 1, 0)) === types.boolean, 'open row projection');
  const v = types.fresh(1); rejects(() => types.unify(v, types.array(v)), 'E_TYPE'); checks++;
  const tail = types.fresh(1, true); rejects(() => types.unify(types.row([[0, types.integer]], tail), types.row([[1, types.boolean]], tail)), 'E_TYPE'); checks++;
  assert.equal(checks, 191751); t.diagnostic(`${checks} kernel checks passed`);
});

test('normal returns and runtime traps preserve full i64 semantics', () => {
  for (const source of ['return 1/0;', 'return 1%0;', `return ${MAX}+1;`, `return ${MIN}/(-1);`, 'return get [1] 5;', 'return get [1] (-1);']) {
    check(source); const bytes = compile(source).wasm;
    rejects(() => execute(bytes), 'E_RUNTIME'); rejects(() => execute(Buffer.from(bytes)), 'E_RUNTIME');
  }
  accept(`return ${MIN}%(-1);`, '0');
  accept('return 9007199254740993 + 2;', '9007199254740995');
  accept(`return ${MAX}-1;`, String(MAX - 1n));
  rejects(() => check(`const P=Int where self>0; let x :: P=${MAX}+1; return x;`), 'E_REFINEMENT');
});

test('Unicode is UTF-8 text, not JS UTF-16 code-unit length', () => {
  accept('return textLength "é🙂";', '6');
  accept('return concat "🙂" "界";', '"🙂界"');
  accept('return "\ufeffx";', '"\ufeffx"');
  rejects(() => check('return "\ud800";'), 'E_PARSE');
});

test('record labels never act as JavaScript object properties', () => {
  accept('let r={ .__proto__=40; .constructor=2; }; return r.__proto__+r.constructor;', '42');
  accept('let __proto__=42; return __proto__;', '42');
});

test('source and nesting limits yield deliberate diagnostics', () => {
  rejects(() => check(' '.repeat(4 * 1024 * 1024 + 1) + 'return 0;'), 'E_LIMIT');
  rejects(() => check('return ' + '('.repeat(300) + '0' + ')'.repeat(300) + ';'), 'E_LIMIT');
  rejects(() => check('return ' + '0'.repeat(50_000) + '9223372036854775808;'), 'E_PARSE');
  rejects(() => check('return ' + '9'.repeat(50_000) + ';'), 'E_PARSE');
  accept('return ' + '0'.repeat(100) + '42;', '42');
});

test('empty records, polymorphic projections, and wrapper chain', () => {
  accept('let f=fn x=>x; return f {};', '{ }');
  accept('let f0=fn x=>x;' + Array.from({ length: 100 }, (_, i) => `let f${i + 1}=fn x=>f${i} x;`).join('') + 'return f100 42;', '42');
});

test('generic refinement evidence is substituted compositionally without body specialization', () => {
  const positive = 'const P=Int where self>0; ';
  accept(positive + 'let id=fn x=>x; let x :: P=id 1; return x;', '1');
  rejects(() => check(positive + 'let id=fn x=>x; let x :: P=id (-1); return x;'), 'E_REFINEMENT');
  accept(positive + 'let getX=fn r=>r.x; let x :: P=getX {.x=1;.tag=true;}; return x;', '1');
  rejects(() => check(positive + 'let getX=fn r=>r.x; let x :: P=getX {.x=(-1);.tag=true;}; return x;'), 'E_REFINEMENT');
  accept(positive + 'let wrap=fn x=>{.value=x;}; let unwrap=fn r=>r.value; let x :: P=unwrap (wrap 1); return x;', '1');
  accept(positive + 'let id=fn x=>x; let apply=fn f=>fn x=>f x; let x :: P=apply id 1; return x;', '1');
  rejects(() => check(positive + 'let id=fn x=>x; let apply=fn f=>fn x=>f x; let x :: P=apply id (-1); return x;'), 'E_REFINEMENT');
  accept(positive + 'let id=fn x=>x; let compose=fn f=>fn g=>fn x=>f (g x); let x :: P=compose id id 1; return x;', '1');

  // A generic higher-order parameter may carry a refined callable. If the helper
  // invokes it, the discovered precondition becomes an obligation on the returned
  // function rather than being erased or causing call-site body rechecking.
  accept(positive + 'let narrow=fn (x :: P)=>x; let apply=fn f=>fn x=>f x; return apply narrow 1;', '1');
  rejects(() => check(positive + 'let narrow=fn (x :: P)=>x; let apply=fn f=>fn x=>f x; return apply narrow 0;'), 'E_REFINEMENT');
  rejects(() => check(positive + 'let narrow=fn (x :: P)=>x; let apply=fn f=>fn x=>f x; let broad :: Int -> Int=apply narrow; return broad 0;'), 'E_REFINEMENT');
  accept(positive + 'let narrow=fn (x :: P)=>x; let ignore=fn f=>42; return ignore narrow;', '42');

  let source = positive + 'let id=fn x=>x; let apply=fn f=>fn x=>f x; let f0=id;';
  for (let i = 1; i <= 200; i++) source += `let f${i}=apply f${i - 1};`;
  source += 'let x :: P=f200 1; return x;';
  const metrics = check(source).metrics;
  assert.ok(metrics.refinement_substitutions <= 7 * 200 + 100, 'symbolic evidence substitution stays linear in wrapper count');
  assert.ok(metrics.proof_steps <= 15 * 200 + 200, 'proof work stays linear in wrapper count');
});

test('truncated artifacts, trailing data, corrupted sections, and legacy bytecode are rejected', () => {
  const bytes = compile('return 42;').wasm;
  for (let n = 0; n < bytes.length; n++) rejects(() => loadWasm(bytes.subarray(0, n)), 'E_WASM');
  rejects(() => loadWasm(Buffer.concat([bytes, Buffer.from('garbage')])), 'E_WASM');
  const corrupt = Buffer.from(bytes); corrupt[0] = 255; rejects(() => loadWasm(corrupt), 'E_WASM');
  rejects(() => loadWasm(Buffer.from('TTBC')), 'E_WASM');
  const utf = compile('return "é";').wasm; const at = utf.indexOf(Buffer.from('é')); utf[at] = 0xff;
  rejects(() => loadWasm(utf), 'E_WASM');
});

function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }; }
test('300 generated arithmetic programs agree with independent integer evaluation', () => {
  const rng = random(72021);
  const tree = depth => {
    if (!depth) { const v = BigInt(rng() % 41) - 20n; return [`(${v})`, v]; }
    const [a, av] = tree(depth - 1), [b, bv] = tree(depth - 1), op = rng() % 3;
    return [`(${a}${['+', '-', '*'][op]}${b})`, op === 0 ? av + bv : op === 1 ? av - bv : av * bv];
  };
  for (let i = 0; i < 300; i++) { const [source, value] = tree(3); accept(`return ${source};`, String(value)); }
});

test('literal refinement decisions match concrete comparisons', () => {
  for (const op of ['<', '<=', '==', '!=', '>=', '>']) for (let v = -4; v <= 4; v++) {
    const ok = ({ '<': v < 1, '<=': v <= 1, '==': v === 1, '!=': v !== 1, '>=': v >= 1, '>': v > 1 })[op];
    const source = `const T=Int where self ${op} 1; let x :: T=${v}; return x;`;
    if (ok) accept(source, String(v)); else rejects(() => check(source), 'E_REFINEMENT');
  }
});

test('1000 seeded malformed source strings never produce internal diagnostics', () => {
  const rng = random(741), chars = 'abc012+-{}[]();=><&|" \\';
  for (let i = 0; i < 1000; i++) {
    const n = rng() % 100; let text = '';
    for (let j = 0; j < n; j++) text += chars[rng() % chars.length];
    try { check(text); } catch (e) { assert.ok(e instanceof TTError); assert.notEqual(e.code, 'E_INTERNAL'); }
  }
});

test('500 malformed byte sequences fail with Wasm diagnostics', () => {
  const rng = random(451);
  for (let i = 0; i < 500; i++) {
    const bytes = Buffer.alloc(rng() % 256); for (let j = 0; j < bytes.length; j++) bytes[j] = rng() & 255;
    rejects(() => loadWasm(bytes), 'E_WASM');
  }
});
