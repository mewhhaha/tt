import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileProject, execute, loadWasm, readValue, TTError } from '../src/compiler.mjs';
import { Tag } from '../src/wasm-runtime.mjs';
import { MAX_VIEW_HEIGHT, MAX_ARRAY_LENGTH } from '../src/wasm-arrays.mjs';
const reject=(fn,code)=>assert.throws(fn,e=>e instanceof TTError && e.code===code);
const run=(source,options={})=>execute(compile(source,options).wasm,options);
const values=source=>run(source).value.values;
const machine=source=>{
  const built=compile(source),loaded=loadWasm(built.wasm),instance=new WebAssembly.Instance(loaded.module,{});
  const pointer=instance.exports.main(),view=new DataView(instance.exports.memory.buffer);
  return {built,loaded,instance,pointer,view};
};
const field=(view,p,abi,name)=>{
  for(let i=0;i<view.getUint32(p+4,true);i++)if(abi.labels[view.getUint32(p+16+i*8,true)]===name)return view.getUint32(p+20+i*8,true);
  assert.fail('missing field '+name);
};

test('direct indexing, half-open slicing and concatenation preserve immutable values',()=>{
  assert.equal(run('return @get([40,2],1);').value,2n);
  assert.deepEqual(values('return @slice([1,2,3,4],1,3);'),[2n,3n]);
  assert.deepEqual(values('return @concat([1,2],[3,4]);'),[1n,2n,3n,4n]);
  assert.deepEqual(values('let a=[1,2,3];return @concat(@slice(a,1,3),@slice(a,0,2));'),[2n,3n,1n,2n]);
  assert.deepEqual(values('return @slice([1,2,3],2,2);'),[]);
  assert.deepEqual(values('return @concat([],[1,2]);'),[1n,2n]);
  assert.deepEqual(values('return @concat([1,2],[]);'),[1n,2n]);
});
test('existing get/length/map/fold primitives operate on views without flattening them',()=>{
  const pre='let a=@concat(@slice([1,2,3,4],1,4),[5,6]);';
  assert.equal(run(pre+'return get a 2;').value,4n);
  assert.equal(run(pre+'return length a;').value,5n);
  assert.deepEqual(values(pre+'return map(fn x=>x*2) a;'),[4n,6n,8n,10n,12n]);
  assert.equal(run(pre+'return fold(fn sum=>fn x=>sum+x) 0 a;').value,20n);
});
test('slices and nonadjacent concatenation copy no elements and use fixed-size descriptors',()=>{
  for(const n of [16,128,1024]){
    const prefix=`let xs=[${Array.from({length:n},(_,i)=>i).join(',')}];`;
    const source=prefix+`let s=@slice(xs,1,${n-1});let t=@slice(xs,0,1);return {.x=xs;.s=s;.c=@concat(s,t);};`;
    const {view,pointer,loaded}=machine(source);
    const x=field(view,pointer,loaded.abi,'x'),s=field(view,pointer,loaded.abi,'s'),c=field(view,pointer,loaded.abi,'c');
    assert.equal(view.getUint32(s,true),Tag.Slice);assert.equal(view.getUint32(s+16,true),x);assert.equal(view.getUint32(s+20,true),1);
    assert.equal(view.getUint32(c,true),Tag.Concat);assert.equal(view.getUint32(c+16,true),s);
    assert.equal(run(source).metrics.heap_bytes-run(prefix+'return {.x=xs;.s=xs;.c=xs;};').metrics.heap_bytes,96);
  }
});
test('adjacent windows merge back to the original memory and nested slices collapse',()=>{
  const {view,pointer,loaded}=machine('let a=[1,2,3,4];let l=@slice(a,0,2);let r=@slice(a,2,4);return {.base=a;.joined=@concat(l,r);.inner=@slice(@slice(a,1,4),1,2);};');
  const base=field(view,pointer,loaded.abi,'base');assert.equal(field(view,pointer,loaded.abi,'joined'),base);
  const inner=field(view,pointer,loaded.abi,'inner');assert.equal(view.getUint32(inner+16,true),base);assert.equal(view.getUint32(inner+20,true),2);assert.equal(view.getUint32(inner+24,true),1);
  let source=`let a0=[${Array.from({length:150},(_,i)=>i).join(',')}];`;
  for(let i=0;i<70;i++)source+=`let a${i+1}=@slice(a${i},1,${150-i});`;
  assert.equal(run(source+'return @get(a70,0);').value,70n);
});
test('explicit materialization provides a flat pointer array and preserves element sharing',()=>{
  const {view,pointer,loaded}=machine('let a=[{.x=1;},{.x=2;}];let v=@concat(a,a);return {.source=a;.flat=@materialize(v);};');
  const a=field(view,pointer,loaded.abi,'source'),flat=field(view,pointer,loaded.abi,'flat');
  assert.equal(view.getUint32(flat,true),Tag.Array);assert.equal(view.getUint32(flat+4,true),4);
  assert.equal(view.getUint32(flat+16,true),view.getUint32(a+16,true));assert.equal(view.getUint32(flat+24,true),view.getUint32(a+16,true));
});
test('views preserve nested data, closure captures and immutable detached host snapshots',()=>{
  const result=run('let make=fn x=>fn y=>x+y;let fs=[make 40,make 1];return (@get(@slice(fs,0,1),0)) 2;');assert.equal(result.value,42n);
  const {view,pointer,loaded,instance}=machine('let a=[[1],[2,3]];return {.before=@slice(a,0,1);};');
  const result2=readValue(instance.exports.memory,pointer,loaded.abi);assert.ok(Object.isFrozen(result2.values[0]));
  new Uint8Array(instance.exports.memory.buffer).fill(0);assert.equal(result2.values[0].values[0].values[0],1n);
});
test('view depth bounds are distinct from logical array nesting and survive normalization',()=>{
  assert.equal(run('let a=[[],[1]];return @get(@slice(a,0,1),0);').output,'[]');
  const s='let xs=[[],[1]];let a=@own {.x=@slice(xs,0,1);};return @take (@move a);';
  assert.equal(run(s).output,'{ .x = [[]]; }');
});
test('view indexes and ranges reject signed and i64-extreme boundaries deliberately',()=>{
  for(const src of ['@get([1],-1)','@get([1],1)','@get([1],9223372036854775807)','@slice([1],-1,0)','@slice([1],1,0)','@slice([1],0,2)','@slice([1],0,9223372036854775807)','@get(@concat([1],[2]),2)'])reject(()=>run('return '+src+';'),'E_RUNTIME');
});
test('scalar sets consume ownership, reuse cell storage, and leave independent snapshots unchanged',()=>{
  const source='let a=@own [1,2,3];let before=@snapshot a;let b=@set(@move a,1,42);return {.before=@take (@move before);.after=@take (@move b);};';
  assert.equal(run(source).output,'{ .before = [1, 2, 3]; .after = [1, 42, 3]; }');
  const s='let a=@own [1,1];let b=@set(@move a,0,9);return @take (@move b);';
  assert.deepEqual(values(s),[9n,1n],'equal scalar source pointers become independent owned cells');
  const fast=run(s),reference=run(s,{optimize:false});assert.equal(fast.output,reference.output);
  assert.equal(fast.metrics.owned_reserved_bytes*2,reference.metrics.owned_reserved_bytes);assert.equal(fast.metrics.owned_live_bytes,0);
  assert.deepEqual(values('let a=@own [false,true];let b=@set(@move a,0,true);return @take (@move b);'),[true,true]);
  assert.deepEqual(values('let a=@own [(),()];let b=@set(@move a,1,());return @take (@move b);'),[null,null]);
});
test('constant write work and owner storage do not scale with array length',()=>{
  let cost;
  for(const n of [16,128,1024]){
    const prefix=`let a=@own [${Array.from({length:n},(_,i)=>i).join(',')}];`;
    const before=run(prefix+'return @borrow a as v in @get(v,0);');
    const after=run(prefix+'let b=@set(@move a,6,42);return @borrow b as v in @get(v,0);');
    assert.equal(after.metrics.owned_reserved_bytes,before.metrics.owned_reserved_bytes);assert.equal(after.metrics.owned_reuses,0);
    const work=before.remaining_fuel-after.remaining_fuel;if(cost===undefined)cost=work;assert.equal(work,cost);
  }
});
test('active loans, sliced aliases and concatenated aliases prohibit writes or drop',()=>{
  for(const body of [
    'let b=@set(@move a,0,9);return @get(v,0);',
    'let s=@slice(v,0,1);let b=@set(@move a,0,9);return @get(s,0);',
    'let s=@concat(v,v);let ignored=@drop a;return @get(s,0);',
  ])reject(()=>compile('let a=@own [1,2];return @borrow a as v in do{'+body+'};'),'E_OWNERSHIP');
  reject(()=>compile('let a=@own [1,2];let b=@set(@move a,0,9);return @borrow a as v in @get(v,0);'),'E_OWNERSHIP');
});
test('views cannot escape a borrow through containers, closures or materialization',()=>{
  for(const body of ['@slice(v,0,1)','@concat(v,v)','{.part=@slice(v,0,1);}','fn x=>@get(v,x)','@materialize(@slice(v,0,1))'])
    reject(()=>compile('let a=@own [1,2];return @borrow a as v in '+body+';'),'E_OWNERSHIP');
  const s='let a=@own [1,2,3];let copy=@borrow a as v in @own (@concat(@slice(v,1,3),v));let ignored=@drop a;return @take (@move copy);';
  assert.deepEqual(values(s),[2n,3n,1n,2n,3n]);
});
test('owning a view normalizes and unshares its data before in-place writes',()=>{
  const src='let a=[1,2];let b=@own (@concat(a,a));let c=@set(@move b,0,9);return {.ordinary=a;.owned=@take (@move c);};';
  assert.equal(run(src).output,'{ .ordinary = [1, 2]; .owned = [9, 2, 1, 2]; }');
  assert.deepEqual(values('let a=@own [1,2,3];let b=@update (@move a) with (fn xs=>@concat(@slice(xs,1,3),@slice(xs,0,1)));return @take (@move b);'),[2n,3n,1n]);
});
test('array updates cannot preserve stale refined element guarantees',()=>{
  const p='const P=Int where self>0;';
  reject(()=>compile(p+'let a :: Owned [P]=@own [1,2];let b :: Owned [P]=@set(@move a,0,-1);return 0;'),'E_REFINEMENT');
  assert.deepEqual(values(p+'let a :: Owned [P]=@own [1,2];let b :: Owned [P]=@set(@move a,0,3);return @take (@move b);'),[3n,2n]);
  reject(()=>compile(p+'let xs :: [P]=@concat([1],[-1]);return xs;'),'E_REFINEMENT');
  reject(()=>compile(p+'let x :: P=@get(@slice([-1,2],0,2),0);return x;'),'E_REFINEMENT');
  assert.equal(run(p+'let x :: P=@get(@slice([1,2],0,2),0);return x;').value,1n);
});
test('unsupported variable-size cell updates and borrowed ordinary writes reject',()=>{
  for(const [a,x]of [['["a"]','"b"'],['[[1]]','[2]'],['[{.x=1;}]','{.x=2;}']])
    reject(()=>compile(`let a=@own ${a};let b=@set(@move a,0,${x});return 0;`),'E_OWNERSHIP_UNSUPPORTED');
  reject(()=>compile('return @set([1,2],0,9);'),'E_TYPE');
});
test('array operations retain host effects, strict argument order and trap cleanup',()=>{
  const prefix='effect Input :: Int -> Int;let input=host Input;';
  const source=prefix+'let a=@own [1,2];let b=@set(@move a,input 0,input 9);return @take (@move b);';
  for(const optimize of [false,true]){
    const seen=[];const r=run(source,{optimize,host:new Map([['main.tt::Input',x=>{seen.push(x);return x;}]])});
    assert.deepEqual(seen,[0n,9n]);assert.deepEqual(r.value.values,[9n,2n]);assert.equal(r.metrics.owned_live_bytes,0);
  }
  const built=compile(prefix+'let a=@own [1,2];let b=@set(@move a,input 10,input 9);return 0;');
  let instance;const seen=[];instance=new WebAssembly.Instance(new WebAssembly.Module(built.wasm),{'tt.host':{'main.tt::Input':x=>{seen.push(x);return x;}}});
  assert.throws(()=>instance.exports.main(),WebAssembly.RuntimeError);assert.deepEqual(seen,[10n,9n]);assert.equal(instance.exports.owned_live_bytes(),0);
  reject(()=>compile('effect E :: Unit -> Int;return @get([1],E ());'),'E_EFFECT_UNHANDLED');
});
test('sliced effectful callbacks keep both source requirements and callable preconditions',()=>{
  const pre='effect E :: Unit -> Int;let fs=[fn x=>E ()+x];let chosen=@get(@slice(fs,0,1),0);';
  reject(()=>compile(pre+'return chosen 1;'),'E_EFFECT_UNHANDLED');
  assert.equal(run(pre+'return handle E with(fn u=>40) in chosen 2;').value,42n);
  const refined='const P=Int where self>0;let fs=[fn(x::P)=>x];let f=@get(@slice(fs,0,1),0);';
  reject(()=>compile(refined+'return f (-1);'),'E_REFINEMENT');assert.equal(run(refined+'return f 2;').value,2n);
});
test('module functions transport owned arrays and view operations without merging identities',()=>{
  const sources=new Map([
    ['main.tt','let L=import "./lib.tt";let a=@own [1,2,3];let b=L.set (@move a);return @borrow b as xs in L.read xs;'],
    ['lib.tt','let set=fn a=>@set(@move a,1,42);let read=fn xs=>@get(@slice(xs,1,2),0);return {.set=set;.read=read;};'],
  ]);
  assert.equal(execute(compileProject('main.tt',sources).wasm).value,42n);
  sources.set('lib.tt','let set=fn a=>@set(@move a,9,42);let read=fn xs=>@get(xs,0);return {.set=set;.read=read;};');
  assert.throws(()=>execute(compileProject('main.tt',sources).wasm),e=>e instanceof TTError&&e.code==='E_RUNTIME'&&e.source.name==='lib.tt');
});
test('view length and height bounds fail closed; materialization can reset representation height',()=>{
  let source='let a0=[1];';for(let i=0;i<MAX_VIEW_HEIGHT+2;i++)source+=`let a${i+1}=@concat(a${i},[1]);`;
  reject(()=>run(source+`return length a${MAX_VIEW_HEIGHT+2};`),'E_LIMIT');
  source='let a0=[1];';for(let i=0;i<21;i++)source+=`let a${i+1}=@concat(a${i},a${i});`;
  reject(()=>run(source+'return length a21;'),'E_LIMIT');assert.equal(MAX_ARRAY_LENGTH,1_000_000);
  source='let a0=[1];';for(let i=0;i<100;i++)source+=`let a${i+1}=${i%32===31?'@materialize(':''}@concat(a${i},[1])${i%32===31?')':''};`;
  assert.equal(run(source+'return length a100;').value,101n);
});
test('100 generated aliasing/slicing/set programs agree with independent immutable array operations',()=>{
  let seed=7451;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let j=0;j<100;j++){
    const n=1+next()%8,initial=Array.from({length:n},()=>BigInt(next()%100)-50n),lo=next()%(n+1),hi=lo+next()%(n-lo+1),i=next()%n,x=BigInt(next()%100)-50n;
    const changed=initial.with(i,x),expected=changed.slice(lo,hi).concat(changed);
    const source=`let a=@own [${initial.map(String)}];let before=@snapshot a;let b=@set(@move a,${i},(${x}));let c=@borrow b as v in @own (@concat(@slice(v,${lo},${hi}),v));return {.before=@take (@move before);.after=@take (@move c);};`;
    for(const optimize of [false,true]){const r=run(source,{optimize});assert.deepEqual(r.value.values[0].values,initial);assert.deepEqual(r.value.values[1].values,expected);assert.equal(r.metrics.owned_live_bytes,0);}
  }
});

test('view decoding rejects forged offsets, counts, height, reserved words and interior/cyclic pointers',()=>{
  const source='let a=[1,2,3];return @slice(a,1,2);';
  for(const change of [
    (v,p)=>v.setUint32(p+20,99,true),
    (v,p)=>v.setUint32(p+4,99,true),
    (v,p)=>v.setUint32(p+24,0,true),
    (v,p)=>v.setUint32(p+24,2,true),
    (v,p)=>v.setUint32(p+28,1,true),
    (v,p)=>v.setUint32(p+16,p,true),
    (v,p)=>v.setUint32(p+16,v.getUint32(p+16,true)+8,true),
  ]){
    const {instance,loaded,pointer,view}=machine(source);change(view,pointer);
    reject(()=>readValue(instance.exports.memory,pointer,loaded.abi),'E_WASM');
  }
  for(const change of [(v,p)=>v.setUint32(p+4,1,true),(v,p)=>v.setUint32(p+24,2,true),(v,p)=>v.setUint32(p+20,p,true)]){
    const {instance,loaded,pointer,view}=machine('return @concat([1],[2]);');change(view,pointer);
    reject(()=>readValue(instance.exports.memory,pointer,loaded.abi),'E_WASM');
  }
});
test('hidden view backing graphs are validated, even for a zero-length result',()=>{
  const {instance,loaded,pointer,view}=machine('let a=[[1],[2]];return @slice(a,0,0);');
  const base=view.getUint32(pointer+16,true),hidden=view.getUint32(base+20,true);
  view.setUint32(hidden+16,hidden,true);
  reject(()=>readValue(instance.exports.memory,pointer,loaded.abi),'E_WASM');
});
test('view snapshot expansion still charges the existing host decoding budget',()=>{
  const source='let a=[0];'+Array.from({length:18},(_,i)=>`let b${i}=@concat(${i?'b'+(i-1):'a'},${i?'b'+(i-1):'a'});`).join('')+'return @concat(b17,b17);';
  // Only 20 descriptors in Wasm; materializing every shared view is not free host work.
  reject(()=>run(source),'E_LIMIT');
});
test('bounds failures preserve array expression source locations and cleanup at every fuel cutoff',()=>{
  const source='let a=@own [1,2,3];\nlet b=@set(@move a,1,42);\nreturn @borrow b as xs in @get(@slice(xs,1,3),0);';
  const bytes=compile(source,{sourceName:'arrays.tt'}).wasm,loaded=loadWasm(bytes),instance=new WebAssembly.Instance(loaded.module,{});
  let successes=0,failures=0;
  for(let fuel=0;fuel<400;fuel++){
    instance.exports.set_fuel(BigInt(fuel));
    try{const p=instance.exports.main();assert.equal(readValue(instance.exports.memory,p,loaded.abi),42n);successes++;}
    catch(e){assert.ok(e instanceof WebAssembly.RuntimeError);assert.equal(instance.exports.error_code(),8);failures++;}
    assert.equal(instance.exports.owned_live_bytes(),0);
  }
  assert.ok(successes>0&&failures>0);
  const bad='let a=[1,2];\nreturn @get(@slice(a,0,1),2);';
  assert.throws(()=>run(bad,{sourceName:'bad.tt'}),e=>e.code==='E_RUNTIME'&&e.pos===bad.indexOf('@get')&&e.source.line===2);
});
test('array function borrowing remains read-only across nested handlers and copies',()=>{
  const source='effect E :: Int -> Int; let a=@own [1,2];let b=@borrow a as xs in handle E with(fn i=>@get(@slice(xs,0,2),i)) in @own [E 0,E 1];let c=@set(@move a,0,9);return {.old=@take (@move b);.new=@take (@move c);};';
  assert.equal(run(source).output,'{ .old = [1, 2]; .new = [9, 2]; }');
});

test('shared multi-module example agrees under pure and explicit host inputs',async()=>{
  const {readFileSync}=await import('node:fs');
  const load=name=>readFileSync(new URL('../examples/array-views/'+name,import.meta.url),'utf8');
  const pure=compileProject('pure.tt',load),host=compileProject('host.tt',load);
  const result=execute(host.wasm,{host:new Map([['operations.tt::IndexInput',()=>1n],['operations.tt::ValueInput',()=>99n]])});
  assert.equal(result.output,execute(pure.wasm).output);
  assert.equal(result.output,'{ .before = [10, 20, 30, 40]; .after = [10, 99, 30, 40]; .rotatedFirst = 30; .joinedLength = 4; }');
  assert.equal(result.metrics.host_calls,2);assert.equal(result.metrics.owned_live_bytes,0);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(pure.wasm)).length,0);
  reject(()=>execute(host.wasm,{host:new Map([['operations.tt::IndexInput',()=>9n],['operations.tt::ValueInput',()=>99n]])}),'E_HOST');
});

test('computed set arguments are reclaimed while earlier values and closures stay live',()=>{
  for(const writes of [1,32,256]){
    let source='let saved=40+2;let f=fn x=>x+saved;let a0=@own [0,1];';
    for(let i=0;i<writes;i++)source+=`let a${i+1}=@set(@move a${i},0,f ${i});`;
    source+=`let out=@borrow a${writes} as xs in @get(xs,0);return {.saved=f 0;.last=out;};`;
    const result=run(source);assert.equal(result.value.values[0],42n);assert.equal(result.value.values[1],42n+BigInt(writes-1));
    // saved Int (24), captured closure (24), copied borrow scalar (24),
    // f 0 result (24), and the two-field record (32): no per-write residue.
    assert.equal(result.metrics.heap_bytes,128);assert.equal(result.metrics.owned_live_bytes,0);
  }
});
test('consuming sets support nested owner construction and synchronous handler arguments',()=>{
  const source='effect E :: Unit -> Int;let make=fn x=>@own [x,x+1];let a=@set(make 5,0,handle E with(fn u=>42) in E ());return @take (@move a);';
  assert.deepEqual(values(source),[42n,6n]);
});

test('array operations execute from saved Wasm without TT source or a JavaScript evaluator',async t=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'tt-array-wasm-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const bytes=compile('let a=@own [1,2,3];let b=@set(@move a,2,42);return @borrow b as v in @get(@concat(@slice(v,2,3),@slice(v,0,2)),0);').wasm;
  assert.equal(WebAssembly.validate(bytes),true);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)),[]);
  const path=join(dir,'program.wasm');writeFileSync(path,bytes);
  const code="const b=require('node:fs').readFileSync(process.argv[1]);const e=new WebAssembly.Instance(new WebAssembly.Module(b),{}).exports;const p=e.main();console.log(new DataView(e.memory.buffer).getBigInt64(p+16,true).toString());";
  const result=spawnSync(process.execPath,['-e',code,path],{cwd:dir,env:{},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'42');
});
test('array format metadata rejects unsupported versions and oversized declarations even when rehashed',async()=>{
  const {createHash}=await import('node:crypto');const {Bytes,uleb}=await import('../src/wasm-binary.mjs');
  const wasm=compile('return @slice([1,2],0,1);').wasm,{abi}=loadWasm(wasm);
  const section=(name,data)=>{const p=new Bytes().name(name).add(Buffer.from(JSON.stringify(data))).finish();return Buffer.concat([Buffer.from([0,...uleb(p.length)]),p]);};
  const replace=spec=>{
    let at=8;const pieces=[wasm.subarray(0,8)];const u32=()=>{let n=0;for(let i=0;i<5;i++){const b=wasm[at++];n+=(b&127)*2**(7*i);if(!(b&128))return n;}throw Error('LEB');};
    while(at<abi.core_bytes){const start=at,id=wasm[at++],size=u32(),end=at+size;let name='';if(id===0){const n=u32();name=wasm.subarray(at,at+n).toString();}pieces.push(name==='tt.arrays'?section(name,spec):wasm.subarray(start,end));at=end;}
    const core=Buffer.concat(pieces),meta={schema:abi.schema,version:abi.version,labels:abi.labels,heap_start:abi.heap_start,core_bytes:core.length,core_sha256:createHash('sha256').update(core).digest('hex')};
    meta.metadata_sha256=createHash('sha256').update(JSON.stringify(meta)).digest('hex');return Buffer.concat([core,section('tt.abi',meta)]);
  };
  for(const value of [{version:2},{version:1,unknown:true},{version:1,padding:'x'.repeat(256)}]){const bytes=replace(value);assert.equal(WebAssembly.validate(bytes),true);reject(()=>loadWasm(bytes),'E_WASM');}
});
