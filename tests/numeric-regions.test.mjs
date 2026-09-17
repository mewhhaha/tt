import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileProject, execute, TTError } from '../src/compiler.mjs';
import { MIN, MAX } from '../src/core.mjs';

function outcome(wasm, fuel = 10000, host = new Map()) {
  try { const result = execute(wasm, { fuel, host });
    return { value: result.value, output: result.output, remaining: result.remaining_fuel };
  } catch (error) {
    assert.ok(error instanceof TTError, error.stack);
    return { code: error.code, pos: error.pos, message: error.message, source: error.source };
  }
}
const pair = source => [compile(source, { optimize: false }), compile(source)];
const parity = source => {
  const [a, b] = pair(source);
  assert.equal(WebAssembly.validate(b.wasm), true);
  assert.deepEqual(a.effects, b.effects);
  assert.deepEqual(a.effect_functions, b.effect_functions);
  assert.equal(a.type, b.type);
  for (const key of ['proof_steps', 'unify_steps', 'refinement_substitutions', 'effect_steps', 'emitted_expressions'])
    assert.equal(a.metrics[key], b.metrics[key], key);
  assert.deepEqual(outcome(b.wasm), outcome(a.wasm), source);
  return [a, b];
};

test('numeric regions eliminate only internal arithmetic boxes', () => {
  const [a, b] = parity('return (40*3+7)/2-1;');
  assert.equal(execute(a.wasm).value, 62n);
  assert.equal(execute(a.wasm).metrics.heap_bytes, 96);
  assert.equal(execute(b.wasm).metrics.heap_bytes, 24);
  assert.equal(b.metrics.unboxed_intermediates, 3);
  const [c, d] = parity('return (40+2)==42;');
  assert.equal(execute(c.wasm).metrics.heap_bytes, 24);
  assert.equal(execute(d.wasm).metrics.heap_bytes, 0);
});

test('standalone scalar operations and polymorphic boundaries stay boxed', () => {
  for (const source of ['return 1;', 'return 1+2;', 'return fn x=>x+1;', 'return map (fn x=>x+1) [1,2];']) {
    const [a, b] = parity(source); assert.deepEqual(a.wasm, b.wasm);
  }
  parity('let id=fn x=>x;let make=fn x=>fn y=>x*y+1;let f=make 20;return { .a=id (f 2);.b=[f 3,f 4]; };');
  parity('let f=fn x=>x*2+1;return (get [f,f] 1) 20;');
});

test('arithmetic remains checked at every intermediate operation without reassociation', () => {
  for (const expression of [
    `(${MAX}+1)-1`, `(${MIN}-1)+1`, `-(${MIN}+0)`, `(${MIN}/(-1))+1`,
    `(${MIN}%(-1))+42`, '(1/0)+2', '(1%0)*2', `(${MAX}*2)/2`,
    `(${MIN}*1)+0`, `(${MIN}+1)-1`, `(${MAX}-1)+1`, '(7/(-2))*3+1',
    '((1+2)<4)', '((1+2)<=3)', '((1+2)>4)', '((1+2)>=3)', '((1+2)!=3)',
  ]) parity('return '+expression+';');
  assert.equal(outcome(compile(`return (${MAX}+1)-1;`).wasm).code, 'E_RUNTIME');
  assert.equal(execute(compile(`return (${MIN}%(-1))+42;`).wasm).value, 42n);
});

test('fuel exhaustion, source positions and first arithmetic failures match the boxed path', () => {
  for (const source of [
    'return ((40*3+7)/2-1)*5;',
    'let f=fn x=>-(x*3+1);return map f [1,2,3];',
    'return ((9223372036854775807+1)-1)+(1/0);',
    'return (1/0)+(9223372036854775807+1);',
    'return if false then (1/0)+1 else (40+1)*2;',
    'return false && ((1/0)+1==0);',
  ]) {
    const [a, b] = pair(source);
    for (let fuel = 0; fuel < 100; fuel++) assert.deepEqual(outcome(b.wasm, fuel), outcome(a.wasm, fuel), `${fuel}: ${source}`);
  }
});

test('numeric values survive pure and host operations without changing authority or call order', () => {
  const source='effect Step :: Int -> Int;let f=fn x=>(Step x+1)*(Step (x+1)-2);return handle Step with host Step in map f [1,2];';
  const [a, b] = pair(source);
  const trace = (wasm, fuel, throws) => {
    const log=[]; const host=new Map([['main.tt::Step', x=>{log.push(x);if(throws && x===2n)throw new Error('stop');return x*3n; }]]);
    return { result:outcome(wasm, fuel, host),log };
  };
  for (const throws of [false,true]) for(let fuel=0;fuel<120;fuel++)
    assert.deepEqual(trace(b.wasm,fuel,throws),trace(a.wasm,fuel,throws));
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(a.wasm)),WebAssembly.Module.imports(new WebAssembly.Module(b.wasm)));
  parity('effect Step :: Int -> Int; return handle Step with (fn x=>x*3+1) in (Step 2+1)*(Step 3-2);');
});

test('module compilation preserves captures, imported diagnostics and numeric results', () => {
  const sources=new Map([
    ['main.tt','let L=import "./lib.tt";return L.f 3;'],
    ['lib.tt','let bias=40;let f=fn x=>(x*2+bias)/2;return {.f=f;};'],
  ]);
  const a=compileProject('main.tt',sources,{optimize:false}),b=compileProject('main.tt',sources);
  assert.deepEqual(outcome(b.wasm),outcome(a.wasm));assert.equal(execute(b.wasm).value,23n);
  sources.set('lib.tt','let f=fn x=>\n (x/0)+1;\nreturn {.f=f;};');
  assert.deepEqual(outcome(compileProject('main.tt',sources).wasm),outcome(compileProject('main.tt',sources,{optimize:false}).wasm));
});

test('checker rejections cannot be bypassed with either optimization mode', () => {
  for (const source of [
    'const P=Int where self>0;let x :: P=(-1)+0;return x;',
    'effect E :: Unit -> Int;return (E ()+1)*2;',
    'const P=Int where self>0;let f=fn(x::P)=>x;let h=fn f=>fn x=>do{let ignored=f x;return 7;};return h f (-1);',
    'return (true+1)*2;',
  ]) for (const optimize of [false,true]) assert.throws(()=>compile(source,{optimize}),e=>e instanceof TTError&&e.code!=='E_INTERNAL');
  assert.throws(()=>compile('return 1;',{optimize:'yes'}),TypeError);
});

test('800 seeded expression trees match an independent checked-i64 arithmetic model', () => {
  let seed=911;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const leaves=[MIN,MAX,-1n,0n,1n,2n,-3n,3037000500n];
  const tree=depth=>{if(!depth)return{value:leaves[next()%leaves.length]};return{op:['+','-','*','/','%'][next()%5],a:tree(depth-1),b:tree(depth-1)};};
  const source=t=>t.op?`(${source(t.a)}${t.op}${source(t.b)})`:`(${t.value})`;
  const model=t=>{
    if(!t.op)return t.value;const a=model(t.a),b=model(t.b);
    if((t.op==='/'||t.op==='%')&&b===0n)throw new Error('zero');
    const n=t.op==='+'?a+b:t.op==='-'?a-b:t.op==='*'?a*b:t.op==='/'?a/b:a%b;
    if(n<MIN||n>MAX)throw new Error('overflow');return n;
  };
  for(let i=0;i<800;i++){
    const t=tree(3);let expected,error;try{expected=model(t);}catch(e){error=e.message;}
    const [a,b]=pair('return '+source(t)+';');assert.deepEqual(outcome(b.wasm),outcome(a.wasm));
    if(error)assert.throws(()=>execute(b.wasm),e=>e.code==='E_RUNTIME'&&e.message.includes(error));
    else assert.equal(execute(b.wasm).value,expected);
  }
});

test('collection allocation savings scale with executions of internal arithmetic nodes', () => {
  for(const n of [16,64,256]){
    const s=`return map (fn x=>((x*3+7)/2-1)*5+x*2-9) [${Array.from({length:n},(_,i)=>i).join(',')}];`;
    const [a,b]=parity(s),x=execute(a.wasm),y=execute(b.wasm);
    assert.equal(x.metrics.heap_bytes-y.metrics.heap_bytes,7*n*24);
    assert.equal(b.metrics.unboxed_intermediates,7);
    assert.equal(y.remaining_fuel,x.remaining_fuel);
  }
});
