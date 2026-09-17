import test from 'node:test';
import assert from 'node:assert/strict';
import { check, run, compile, execute, TTError } from '../src/compiler.mjs';

const prefix = `const P=Int where self>0; let positive=fn(x :: P)=>x;`;
const reject = source => assert.throws(() => check(source), e =>
  e instanceof TTError && ['E_REFINEMENT', 'E_REFINEMENT_JOIN'].includes(e.code));
const accept = (source, expected) => {
  assert.equal(run(source).output, expected);
  const bytes = compile(source).wasm;
  assert.equal(WebAssembly.validate(bytes), true);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(bytes)).length, 0);
  assert.equal(execute(bytes).output, expected);
};

for (const [name, body, expected] of [
  ['discard', 'do {let ignored=f x; return 7;}', '7'],
  ['arithmetic', 'f x+1', '3'],
  ['comparison', 'f x==2', 'true'],
  ['field-discard', 'do {let row={.value=f x;}; return 7;}', '7'],
  ['array-discard', 'do {let values=[f x]; return 7;}', '7'],
]) {
  test(`deferred call requirements survive ${name}`, () => {
    const helper = `let apply=fn f=>fn x=>${body};`;
    reject(prefix + helper + 'return apply positive (-1);');
    accept(prefix + helper + 'return apply positive 2;', expected);
  });
}

test('discarded calls survive currying, aliases and higher-order forwarding', () => {
  const common = prefix + `
    let discard=fn f=>fn x=>do {let ignored=f x;return 7;};
    let id=fn x=>x;
    let forward=fn f=>fn x=>discard f x;
    let alias=id forward;
    let use=alias positive;
  `;
  reject(common + 'return use (-1);');
  accept(common + 'return use 2;', '7');
  accept(common + 'return use;', '<fn>');
});

test('requirements survive record argument projections and discarded helper calls', () => {
  const common = prefix + `
    let apply=fn r=>do {let ignored=r.f r.x;return 7;};
    let forward=fn r=>do {let ignored=apply r;return 8;};
  `;
  reject(common + 'return forward {.f=positive;.x=(-1);};');
  accept(common + 'return forward {.f=positive;.x=2;};', '8');
});

test('requirements from both potentially executed branch arms are retained', () => {
  const common = prefix + `let apply=fn f=>fn x=>fn b=>if b then do {let ignored=f x;return 7;} else 8;`;
  reject(common + 'return apply positive (-1) true;');
  accept(common + 'return apply positive 2 true;', '7');
  accept(common + 'return apply positive 2 false;', '8');
});

test('dead short-circuit operands do not introduce deferred requirements', () => {
  accept(prefix + 'let f=fn callback=>false && (callback (-1)==0);return f positive;', 'false');
  accept(prefix + 'let f=fn callback=>true || (callback (-1)==0);return f positive;', 'true');
});

test('function annotations cannot erase discarded callback requirements', () => {
  const helper = prefix + 'let discard=fn f=>fn x=>do {let ignored=f x;return 7;};';
  reject(helper + 'let bad :: (P->Int)->Int->Int=discard;return bad positive (-1);');
  accept(helper + 'let good :: (P->Int)->P->Int=discard;return good positive 2;', '7');
  accept(helper + 'let wide :: (Int->Int)->Int->Int=discard;return wide (fn x=>x) (-1);', '7');
});

test('joining distinct pending requirements does not silently erase one branch', () => {
  reject(prefix + `let left=fn f=>fn x=>do {let ignored=f x;return 7;};
    let right=fn f=>fn x=>7;
    let pick=fn b=>if b then left else right;
    return pick true positive (-1);`);
});

test('known runtime traps retain strict demand despite discarded results', () => {
  const source = 'let discard=fn f=>fn x=>do {let ignored=f x;return 7;};return discard (fn x=>1/x) 0;';
  check(source);
  assert.throws(() => run(source), e => e instanceof TTError && e.code === 'E_RUNTIME');
});

test('call summaries preserve lexical identities and independent instantiations', () => {
  const common = prefix + `let apply=fn f=>fn x=>do {let ignored=f x;return 7;};
    let a=apply positive; let b=apply (fn x=>x); let first=a 2;`;
  accept(common + 'return b (-1);', '7');
  reject(common + 'return a (-1);');
});

test('bounded generated inputs cannot hide a known precondition', () => {
  for (let n=-8; n<=8; n++) {
    const s=prefix + `let apply=fn f=>fn x=>do {let ignored=f x;return 7;};return apply positive (${n});`;
    if (n>0) accept(s,'7'); else reject(s);
  }
});

test('many forwarding helpers check summaries with bounded work', () => {
  for (const n of [100, 200, 400]) {
    const source=prefix + 'let f0=fn f=>fn x=>do {let ignored=f x;return 7;};' +
      Array.from({length:n},(_,i)=>`let f${i+1}=fn f=>fn x=>f${i} f x;`).join('') +
      `return f${n} positive 2;`;
    const c=check(source);
    assert.ok(c.metrics.proof_steps < 40*n+100, JSON.stringify(c.metrics));
    assert.ok(c.metrics.refinement_substitutions < 12*n+100, JSON.stringify(c.metrics));
    assert.equal(c.type, 'Int');
  }
});

test('stored closure requirements survive aggregates but uncalled closures are not executed', () => {
  const common = prefix + 'let mk=fn f=>{.call=fn x=>do {let ignored=f x;return 7;};};';
  reject(common + 'return (mk positive).call (-1);');
  accept(common + 'return (mk positive).call 2;', '7');
  accept(common + 'let ignore=fn value=>7;return ignore (mk positive);', '7');
  const array = prefix + 'let mk=fn f=>[fn x=>do {let ignored=f x;return 7;}];';
  reject(array + 'return (get (mk positive) 0) (-1);');
});

test('partial applications cannot hide obligations in an annotated record', () => {
  const common = prefix + 'let discard=fn f=>fn x=>do {let ignored=f x;return 7;};';
  reject(common + 'let bad :: Int->Int=discard positive;return bad (-1);');
  reject(common + 'let bad :: {.call :: Int->Int;}={.call=discard positive;};return bad.call (-1);');
  accept(common + 'let good :: {.call :: P->Int;}={.call=discard positive;};return good.call 2;', '7');
});

test('call-summary collection and subsumption never suppress proof-budget exhaustion', async () => {
  const { Types } = await import('../src/types.mjs');
  const { Refine, pairEvidence } = await import('../src/refine.mjs');
  const { LIMITS } = await import('../src/core.mjs');
  const types = new Types(), refine = new Refine(null, types, { nextBinder: 0, builtins: [] });
  const parameter = { kind: 'Param', binder: 1, base: null };
  const fn = pairEvidence('Function', null, parameter, 1, types.integer);
  types.metrics.proof_steps = LIMITS.proofSteps - 1;
  assert.throws(() => refine.functionEntails(fn, null, { a: types.integer, b: types.integer }, 0),
    e => e instanceof TTError && e.code === 'E_LIMIT');
  types.metrics.proof_steps = LIMITS.proofSteps;
  assert.throws(() => refine.collectDirectRequirements(parameter, 1, []),
    e => e instanceof TTError && e.code === 'E_LIMIT');
});
