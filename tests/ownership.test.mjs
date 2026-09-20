import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileProject,check,execute,loadWasm,run,TTError} from '../src/compiler.mjs';
const rejects=source=>assert.throws(()=>check(source),e=>e instanceof TTError&&['E_OWNERSHIP','E_OWNERSHIP_UNSUPPORTED','E_REFINEMENT','E_TYPE'].includes(e.code));
const accept=(source,want)=>{
  for(const optimize of [false,true]){
    const c=compile(source,{optimize});assert.ok(WebAssembly.validate(c.wasm));
    const r=execute(Buffer.from(c.wasm));assert.equal(r.output,want);assert.equal(r.metrics.owned_live_bytes,0);
    assert.ok(r.metrics.owned_reserved_bytes>=r.metrics.owned_peak_bytes);assert.ok(Object.isFrozen(r.value)||r.value===null||typeof r.value!=='object');
  }
};

test('plain values have affine isolated owners and copied scalar read borrows',()=>{
  accept('let a=@own 42;return @borrow a as v in v;','42');
  accept('let a=@own true;return @borrow a as v in v;','true');
  accept('let a=@own ();return @borrow a as v in v;','()');
  accept('let a=@own "é🙂";return @borrow a as v in textLength v;','6');
  accept('let a=@own [1,2,3];return @borrow a as v in fold (fn n=>fn x=>n+x) 0 v;','6');
});
test('explicit moves transfer ownership and consume the old binding',()=>{
  accept('let a=@own [1,2];let b=@move a;return @take (@move b);','[1, 2]');
  rejects('let a=@own [1];let b=@move a;return @take (@move a);');
  rejects('let a=@own [1];let b=@move a;return @borrow a as v in length v;');
  rejects('let a=@own [1];let b=@move a;return @snapshot a;');
});
test('duplicate ownership, double drop, use after drop and raw main escape reject',()=>{
  for(const tail of ['let b=a;return 0;','let x=@drop a;let y=@drop a;return 0;','let x=@drop a;return @borrow a as v in v;','return @move a;'])
    rejects('let a=@own 1;'+tail);
});
test('multiple read borrows share a lexical loan group',()=>{
  accept('let a=@own [20,22];let n=@borrow a as x in @borrow a as y in (get x 0)+(get y 1);let b=@move a;let d=@drop b;return n;','42');
  rejects('let a=@own 1;return @borrow a as x in @take (@move a);');
  rejects('let a=@own 1;return @borrow a as x in do{let d=@drop a;return x;};');
});
test('loans cannot escape inside raw data or a captured closure',()=>{
  for(const body of ['v','[v]','{.x=v;}','fn u=>v','(fn x=>x) v'])
    rejects('let a=@own [1,2];return @borrow a as v in '+body+';');
  rejects('let a=@own "text";return @borrow a as v in v;');
});
test('an independent owner can escape a read scope, but not its borrowed pointer',()=>{
  accept('let a=@own [1,2];let b=@borrow a as v in @own v;let d=@drop a;return @take (@move b);','[1, 2]');
  accept('let a=@own [1];let b=@borrow a as v in @snapshot a;let d=@drop a;return @take (@move b);','[1]');
});
test('snapshots are independent immutable copies across consuming updates',()=>{
  accept('let a=@own [1,2];let old=@snapshot a;let b=@update (@move a) with (fn v=>map (fn x=>x+1) v);return {.old=@take (@move old);.next=@take (@move b);};','{ .old = [1, 2]; .next = [2, 3]; }');
});
test('internal input aliases do not authorize mutation of a shared child',()=>{
  accept('let shared=[1,2];let a=@own {.left=shared;.right=shared;};let old=@snapshot a;let b=@update (@move a) with (fn r=>{.left=map (fn x=>x+10) r.left;.right=r.right;});return {.old=@take (@move old);.next=@take (@move b);};',
    '{ .old = { .left = [1, 2]; .right = [1, 2]; }; .next = { .left = [11, 12]; .right = [1, 2]; }; }');
});
test('owner references cannot be hidden in containers or ordinary captures',()=>{
  for(const expr of ['[@move a]','{.x=@move a;}','fn u=>@take (@move a)','fn u=>@snapshot a','fn u=>@borrow a as x in x'])
    rejects('let a=@own 1;return '+expr+';');
  rejects('return @take (@own (fn x=>x));');
  rejects('let a=@own 1;return @own (@move a);');
});
test('owning function parameters transfer or drop once without body specialization',()=>{
  accept('let pass=fn x=>@move x;let a=@own [1,2];let b=pass (@move a);return @take (@move b);','[1, 2]');
  accept('let forget=fn x=>do{let d=@drop x;return 7;};let a=@own 1;return forget (@move a);','7');
  accept('let size=fn (x::Owned [Int])=>@borrow x as v in length v;let a=@own [1,2];return size (@move a);','2');
  rejects('let dup=fn x=>[x,x];let a=@own 1;return dup (@move a);');
});
test('generic or annotated interfaces cannot invent consuming usage authority',()=>{
  rejects('let id=fn x=>x;let a=@own 1;let b=id (@move a);return @take (@move b);');
  rejects('let id=fn x=>x;let f::Owned Int->Owned Int=id;let a=@own 1;return @take (f (@move a));');
  rejects('let f=fn x=>@move x;let apply=fn f=>fn x=>f x;let a=@own 1;return @take (apply f (@move a));');
  rejects('let a=@own 1;let b::Int=@move a;return b;');
});
test('continuing branch ownership states must agree',()=>{
  accept('let a=@own 1;let b=if true then @move a else @move a;return @take (@move b);','1');
  rejects('let a=@own 1;let d=if true then @drop a else ();return 7;');
  rejects('let a=@own 1;return false && do{let d=@drop a;return true;};');
  accept('let a=@own 42;let n=@borrow a as v in if true then v else 0;let d=@drop a;return n;','42');
});
test('scalar copy-out is detached before an owner block is reused',()=>{
  accept('let a=@own 42;let n=@borrow a as v in v;let d=@drop a;let b=@own 9;let d2=@drop b;return n;','42');
  accept('let a=@own [40,2];let n=@borrow a as v in (get v 0);let d=@drop a;let b=@own [8,9];let d2=@drop b;return n;','40');
});
test('moving a local owner out of a block prevents automatic destruction of that transfer',()=>{
  accept('let b=do{let a=@own [1,2];return @move a;};return @take (@move b);','[1, 2]');
  accept('let n=do{let a=@own [1,2];return @borrow a as v in length v;};return n;','2');
});
test('unused owner bindings and owning function arguments drop at normal lexical exits',()=>{
  const r=run('let ignore=fn(x::Owned Int)=>7;let a=@own 42;let b=@own 43;let n=ignore (@move a);return n;');
  assert.equal(r.value,7n);assert.equal(r.execution_metrics.owned_live_bytes,0);assert.equal(r.execution_metrics.owned_peak_bytes,112);
});
test('own and update preserve input refinements but never assume first-iteration facts forever',()=>{
  accept('const P=Int where self>0;let a::Owned P=@own 42;let n::P=@borrow a as x in x;return n;','42');
  rejects('const P=Int where self>0;let a::Owned P=@own (-1);return 7;');
  rejects('const P=Int where self>0;let a=@own 1;let b=@evolve (@move a) by 2 with (fn(x::P)=>x-1);return @take (@move b);');
});
test('10000 structural updates reuse storage while a prior snapshot remains intact',()=>{
  const source='let step=fn v=>{.x=v.x+1;.items=map (fn x=>x+1) v.items;};let a=@own {.x=0;.items=[1,2];};let old=@snapshot a;let b=@evolve (@move a) by 10000 with step;return {.old=@take (@move old);.next=@take (@move b);};';
  const r=run(source);assert.equal(r.output,'{ .old = { .x = 0; .items = [1, 2]; }; .next = { .x = 10000; .items = [10001, 10002]; }; }');
  assert.equal(r.execution_metrics.owned_live_bytes,0);assert.equal(r.execution_metrics.owned_peak_bytes,480);
  assert.equal(r.execution_metrics.owned_reserved_bytes,480);assert.equal(r.execution_metrics.owned_reuses,9999);
  assert.ok(r.execution_metrics.heap_bytes<1024);
});
test('evolve zero transfers the original owner and negative counts trap',()=>{
  accept('let a=@own 42;let b=@evolve (@move a) by 0 with (fn x=>x/0);return @take (@move b);','42');
  assert.throws(()=>run('let a=@own 1;let b=@evolve (@move a) by (-1) with (fn x=>x);return @take (@move b);'),e=>e.code==='E_RUNTIME'&&/negative/.test(e.message));
});
test('fixed-size owner churn has constant reserved storage independent of iteration count',()=>{
  for(const n of [1,100,1000,10000]){
    const r=run(`let a=@own 0;let b=@evolve (@move a) by ${n} with (fn x=>x+1);return @take (@move b);`);
    assert.equal(r.value,BigInt(n));assert.equal(r.execution_metrics.owned_reserved_bytes,112);
    assert.equal(r.execution_metrics.owned_reuses,n-1);assert.equal(r.execution_metrics.owned_live_bytes,0);
  }
});
test('pure and host effects remain ordered inside the same owning update',()=>{
  const body='effect Step::Int->Int;let a=@own 0;let b=@evolve (@move a) by 4 with (fn x=>Step x);return @take (@move b);';
  const source=body.replace('let a=', 'let step=host Step;let a=').replace('(fn x=>Step x)','step');
  const log=[];const r=run(source,{host:new Map([['main.tt::Step',x=>{log.push(x);return x+1n;}]])});
  assert.equal(r.value,4n);assert.deepEqual(log,[0n,1n,2n,3n]);assert.equal(r.execution_metrics.host_calls,4);assert.equal(r.execution_metrics.owned_live_bytes,0);
  const pure='effect Step::Int->Int;return handle Step with (fn x=>x+1) in do{let a=@own 0;let b=@evolve (@move a) by 4 with (fn x=>Step x);return @take (@move b);};';
  accept(pure,'4');assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(compile(pure).wasm)),[]);
});
test('operation contracts cannot smuggle ownership through handlers or host imports',()=>{
  rejects('effect Transfer::Owned Int->Owned Int;return 1;');
  rejects('effect Store::{.x:Owned Int;}->Unit;return 1;');
});
test('read-only views can be passed through pure handlers but cannot invalidate the owner',()=>{
  accept('effect Read::[Int]->Int;let a=@own [1,2];return handle Read with (fn xs=>length xs) in @borrow a as v in Read v;','2');
  rejects('effect Read::Unit->Int;let a=@own 1;return handle Read with (fn u=>@take (@move a)) in @borrow a as v in Read ();');
});
test('ownership summaries survive direct module exports and aliases',()=>{
  const c=compileProject('main.tt',new Map([
    ['main.tt','let L=import "./lib.tt";let f=L.step;let a=@own 41;let b=f (@move a);return @take (@move b);'],
    ['lib.tt','let step=fn a=>@update (@move a) with (fn x=>x+1);return {.step=step;};'],
  ]));assert.equal(execute(c.wasm).value,42n);assert.equal(execute(c.wasm).metrics.owned_live_bytes,0);
});
test('module diagnostics still identify imported ownership errors',()=>{
  assert.throws(()=>compileProject('main.tt',new Map([
    ['main.tt','let L=import "./lib.tt";return L;'],
    ['lib.tt','let a=@own 1;let b=@move a;\nlet c=@move a;return {};'],
  ])),e=>e.code==='E_OWNERSHIP'&&e.source?.name==='lib.tt'&&e.source.line===2);
});
test('fuel or arithmetic traps reset owning allocations and subsequent main runs start clean',()=>{
  const source='let a=@own [1,2,3];let b=@evolve (@move a) by 3 with (fn xs=>map (fn x=>x+1) xs);return @take (@move b);';
  const loaded=loadWasm(compile(source).wasm),instance=new WebAssembly.Instance(loaded.module,{}),e=instance.exports;
  let failures=0,successes=0;
  for(let fuel=0;fuel<1200;fuel++){
    e.set_fuel(BigInt(fuel));try{e.main();successes++;}catch(error){assert.ok(error instanceof WebAssembly.RuntimeError);assert.equal(e.error_code(),8);failures++;}
    assert.equal(e.owned_live_bytes(),0);if(e.error_code())assert.equal(e.owned_reserved_bytes(),0);
  }
  assert.ok(failures>0&&successes>0);e.set_fuel(10000n);const p=e.main();assert.equal(e.error_code(),0);assert.deepEqual(execute(compile(source).wasm).value.values,[4n,5n,6n]);
  const bad=new WebAssembly.Instance(loadWasm(compile('let a=@own 1;return 1/0;').wasm).module,{});
  assert.throws(()=>bad.exports.main(),WebAssembly.RuntimeError);assert.equal(bad.exports.owned_live_bytes(),0);
});
test('host exceptions abort without retry and high-level execution releases the arena',()=>{
  const c=compile('effect Step::Int->Int;let f=host Step;let a=@own 0;let b=@evolve (@move a) by 10 with f;return @take (@move b);');
  let observed;const Original=WebAssembly.Instance;
  WebAssembly.Instance=function(...args){observed=new Original(...args);return observed;};
  const log=[];
  try{assert.throws(()=>execute(c.wasm,{host:new Map([['main.tt::Step',x=>{log.push(x);if(x===2n)throw new Error('stop');return x+1n;}]])}),e=>e.code==='E_HOST'&&/stop/.test(e.message));}
  finally{WebAssembly.Instance=Original;}
  assert.deepEqual(log,[0n,1n,2n]);assert.equal(observed.exports.owned_live_bytes(),0);assert.equal(observed.exports.owned_reserved_bytes(),0);
});
test('saved owned artifacts run in a standard engine without host imports or TT interpreter',()=>{
  const wasm=Buffer.from(compile('let a=@own [20,22];return @borrow a as v in (get v 0)+(get v 1);').wasm);
  const module=new WebAssembly.Module(wasm);assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const e=new WebAssembly.Instance(module,{}).exports,p=e.main();assert.equal(new DataView(e.memory.buffer).getBigInt64(p+16,true),42n);assert.equal(e.owned_live_bytes(),0);
});
test('ownership checking and lowering cannot be bypassed by disabling optimization',()=>{
  const bad='let a=@own 1;let b=@move a;return @take (@move a);';
  for(const optimize of [false,true])assert.throws(()=>compile(bad,{optimize}),e=>e.code==='E_OWNERSHIP');
});

test('curried plain parameters may precede an explicit final owning parameter',()=>{
  accept('let at=fn i=>fn (a::Owned [Int])=>@borrow a as xs in get xs i;let getSecond=at 1;let a=@own [20,42];return getSecond (@move a);','42');
});
test('typed empty arrays, empty records and repeated scalar snapshots remain valid',()=>{
  accept('let a::Owned [Int]=@own [];return @take (@move a);','[]');
  accept('let a=@own {};let b=@snapshot a;let d=@drop a;return @take (@move b);','{ }');
  accept('let a=@own false;let b=@snapshot a;let d=@drop a;return @take (@move b);','false');
});
test('a callback may manage independent nested owners without leaking scratch storage',()=>{
  const source='let step=fn x=>do{let a=@own (x+1);let b=@snapshot a;let y=@take (@move b);return y;};let a=@own 0;let b=@evolve (@move a) by 1000 with step;return @take (@move b);';
  const r=run(source);assert.equal(r.value,1000n);assert.equal(r.execution_metrics.owned_live_bytes,0);
  assert.ok(r.execution_metrics.owned_reserved_bytes<=4*56);assert.ok(r.execution_metrics.heap_bytes<256);
});
test('detached snapshots survive a larger reallocation and a subsequent same-instance main',()=>{
  const source='let a=@own [1,2];let b=@snapshot a;let d=@drop a;let bigger=@own [3,4,5,6,7,8];let d2=@drop bigger;return @take (@move b);';
  const {module,abi}=loadWasm(compile(source).wasm),e=new WebAssembly.Instance(module,{}).exports;
  const pointer=e.main();const bytes=Buffer.from(e.memory.buffer);const again=e.main();
  assert.equal(pointer,again);assert.equal(e.owned_live_bytes(),0);assert.deepEqual(Buffer.from(e.memory.buffer),bytes);
  assert.equal(execute(compile(source).wasm).output,'[1, 2]');
});
test('generated owning transformations agree with an independent integer model',()=>{
  let seed=42;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let i=0;i<100;i++){
    const n=next()%25,bias=BigInt(next()%7)-3n,start=BigInt(next()%41)-20n;
    const source=`let a=@own {.x=${start};.ys=[${start},${start+1n}];};let old=@snapshot a;let b=@evolve (@move a) by ${n} with (fn r=>{.x=r.x+(${bias});.ys=map (fn x=>x+(${bias})) r.ys;});return {.old=@take (@move old);.next=@take (@move b);};`;
    const r=run(source);const end=start+BigInt(n)*bias;
    assert.equal(r.value.values[0].values[0],start);assert.equal(r.value.values[1].values[0],end);
    assert.deepEqual(r.value.values[1].values[1].values,[end,end+1n]);assert.equal(r.execution_metrics.owned_live_bytes,0);
  }
});
test('owning storage exhaustion deliberately traps and clears the live arena',()=>{
  // Shared input text is tiny relative to the independent expanded copy. This is
  // bounded by fuel/byte limits, not accepted as a request for a collector.
  const text='x'.repeat(1024*1024);
  const source=`let text="${text}";let a=@own [${Array(64).fill('text').join(',')}];return 1;`;
  const loaded=loadWasm(compile(source).wasm),e=new WebAssembly.Instance(loaded.module,{}).exports;
  assert.throws(()=>e.main(),WebAssembly.RuntimeError);assert.equal(e.error_code(),7);assert.equal(e.owned_live_bytes(),0);
});
test('ownership work is bounded and exhaustion cannot become acceptance',async()=>{
  const {Ownership}=await import('../src/ownership.mjs'),{Types}=await import('../src/types.mjs'),{LIMITS}=await import('../src/core.mjs');
  const types=new Types(),check=new Ownership(null,types);check.steps=LIMITS.proofSteps;
  assert.throws(()=>check.contains(types.integer),e=>e.code==='E_LIMIT');
  for(const n of [100,200,400]){
    const s=Array.from({length:n},(_,i)=>`let a${i}=@own ${i};let d${i}=@drop a${i};`).join('')+'return 42;';
    const c=compile(s,{emit:false});assert.ok(c.metrics.ownership_steps<25*n+100,JSON.stringify(c.metrics));
  }
});

test('frame example runs through shared pure and host systems with zero leaked owners',async()=>{
  const {readFileSync}=await import('node:fs');
  const load=p=>readFileSync(new URL('../examples/ownership-frames/'+p,import.meta.url),'utf8');
  const pure=compileProject('pure.tt',load),host=compileProject('host.tt',load);
  const a=execute(pure.wasm),b=execute(host.wasm,{host:new Map([['operations.tt::Step',()=>2n],['operations.tt::Axis',()=>1n]])});
  assert.equal(a.output,b.output);assert.equal(a.value.values[0].values[0],0n);assert.equal(a.value.values[1].values[0],10000n);
  assert.equal(a.value.values[2],40030n);assert.equal(b.metrics.host_calls,40000);
  for(const r of [a,b]){assert.equal(r.metrics.owned_live_bytes,0);assert.equal(r.metrics.owned_reserved_bytes,1008);assert.equal(r.metrics.owned_reuses,9999);}
});

test('a prior owner can be borrowed throughout updates of an independent owner',()=>{
  accept('let a=@own {.x=1;.baseline=0;};let before=@snapshot a;let b=@borrow before as old in @evolve (@move a) by 100 with (fn r=>{.x=r.x+1;.baseline=old.x;});let d=@drop before;return @take (@move b);','{ .x = 101; .baseline = 1; }');
});
test('a saved owned module executes in a fresh process without compiler sources or imports',async t=>{
  const {writeFileSync,mkdtempSync,rmSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'tt-owned-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'only.wasm');writeFileSync(path,compile('let a=@own 0;let b=@evolve (@move a) by 42 with (fn x=>x+1);return @take (@move b);').wasm);
  const script="const b=require('node:fs').readFileSync(process.argv[1]);const m=new WebAssembly.Module(b);if(WebAssembly.Module.imports(m).length)throw Error('imports');const e=new WebAssembly.Instance(m,{}).exports;const p=e.main();console.log(new DataView(e.memory.buffer).getBigInt64(p+16,true).toString(),e.owned_live_bytes());";
  const r=spawnSync(process.execPath,['-e',script,path],{cwd:dir,env:{},encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'42 0');
});

test('large repeated copies spend byte-proportional fuel instead of hiding work in a node count',()=>{
  const source=`let a=@own "${'x'.repeat(4096)}";let b=@evolve (@move a) by 8 with (fn x=>x);return @borrow b as t in textLength t;`;
  assert.throws(()=>run(source,{fuel:10000}),e=>e.code==='E_LIMIT'&&/fuel/.test(e.message));
  const r=run(source,{fuel:100000});assert.equal(r.value,4096n);assert.equal(r.execution_metrics.owned_live_bytes,0);
});
