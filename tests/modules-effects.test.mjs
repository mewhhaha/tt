import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compile, compileProject, execute, loadWasm, run, TTError } from '../src/compiler.mjs';
import { fileProject } from '../src/project-files.mjs';
import { MODULE_LIMIT } from '../src/modules.mjs';
import { createHash } from 'node:crypto';
import { Bytes, uleb, WasmModule, I32, I64 } from '../src/wasm-binary.mjs';
const reject = (fn, code) => assert.throws(fn, e => e instanceof TTError && e.code === code);
const evaluate = (source, options) => execute(compile(source).wasm, options);
const E = 'effect Read :: Unit -> Int; ';
const project = files => compileProject('main.tt', new Map(Object.entries(files)));

test('module exports preserve polymorphism, private scope and record interfaces', () => {
  const built = project({ 'main.tt': 'let Lib=import "./lib.tt"; let x=Lib.id 42; let y=Lib.id true; return {.x=x;.y=y;};',
    'lib.tt': 'let private=99; let id=fn x=>x; return {.id=id;};' });
  assert.equal(execute(built.wasm).output, '{ .x = 42; .y = true; }');
  reject(() => project({ 'main.tt':'let Lib=import "./lib.tt"; return private;', 'lib.tt':'let private=7; return {.x=private;};' }), 'E_NAME');
  reject(() => project({ 'main.tt':'let Lib=import "./lib.tt"; return Lib.private;', 'lib.tt':'let private=7; return {.x=private;};' }), 'E_TYPE');
});
test('diamond imports initialize once and effect identity is declaration-owned', () => {
  const built = project({
    'main.tt': 'let L=import "./left.tt"; let R=import "./right.tt"; return handle L.Read with (fn u=>40) in L.read () + R.read ();',
    'left.tt': 'let O=import "./ops.tt"; return {.Read=O.Read;.read=O.Read;};',
    'right.tt': 'let O=import "./ops.tt"; return {.read=O.Read;};',
    'ops.tt': 'effect Read :: Unit -> Int; effect Init :: Unit -> Unit; let initialized=(host Init) (); return {.Read=Read;};',
  });
  let count=0;
  assert.equal(execute(built.wasm, {host:new Map([['ops.tt::Init',()=>{count++;}]])}).value,80n);
  assert.equal(count,1); assert.equal(built.metrics.module_count,4);
});
test('same-shaped same-named declarations in different modules do not merge', () => {
  reject(() => project({ 'main.tt':'let A=import "./a.tt"; let B=import "./b.tt"; return handle A.Read with (fn u=>1) in B.Read ();',
    'a.tt':E+'return {.Read=Read;};', 'b.tt':E+'return {.Read=Read;};' }), 'E_EFFECT_UNHANDLED');
});
test('module cycles, absent files, dynamic imports and path escapes reject deliberately', () => {
  reject(() => project({'main.tt':'let x=import "./b.tt"; return x;', 'b.tt':'let x=import "./main.tt"; return x;'}),'E_MODULE_CYCLE');
  for(const spec of ['./missing.tt','../outside.tt','package','https://example.test/a.tt'])
    reject(()=>project({'main.tt':`let x=import "${spec}"; return x;`}), 'E_MODULE');
  reject(()=>project({'main.tt':'return fn x=>import "./b.tt";', 'b.tt':'return {};'}),'E_MODULE');
  reject(()=>project({'main.tt':'let x=import "./b.tt"; return x;', 'b.tt':'return 42;'}),'E_MODULE');
});
test('module graph budget fails closed', () => {
  const files=new Map();for(let i=0;i<=MODULE_LIMIT;i++) files.set(i?'m'+i+'.tt':'main.tt',`let x=import "./m${i+1}.tt"; return x;`);
  reject(()=>compileProject('main.tt',files),'E_LIMIT');
});
test('deterministic module output does not depend on Map insertion order', () => {
  const entries=[['main.tt','let A=import "./a.tt"; return A.x;'],['a.tt','return {.x=42;};']];
  assert.deepEqual(compileProject('main.tt',new Map(entries)).wasm,compileProject('main.tt',new Map(entries.toReversed())).wasm);
});
test('single-source compile refuses imports with a module diagnostic', () => reject(()=>compile('let L=import "./lib.tt"; return L;'),'E_MODULE'));
test('pure effect handler lowers to zero-import executable Wasm', () => {
  const built=compile(E+'return handle Read with (fn u=>42) in Read ();');
  assert.deepEqual(built.effects,[]);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(built.wasm)),[]);
  assert.equal(execute(built.wasm).value,42n);
});
test('nested handlers restore scope and clauses may forward to outer handlers', () => {
  assert.equal(evaluate(E+'return handle Read with (fn u=>40) in do { let inner=handle Read with (fn u=>Read ()+2) in Read (); return inner+Read (); };').value,82n);
  reject(()=>compile(E+'return handle Read with (fn u=>Read ()) in Read ();'),'E_EFFECT_UNHANDLED');
});
test('constructing a closure under a handler does not handle its later invocation', () => {
  reject(()=>compile(E+'let f=handle Read with (fn u=>1) in (fn u=>Read ()); return f ();'),'E_EFFECT_UNHANDLED');
  const built=compile(E+'return handle Read with (fn u=>1) in (fn u=>Read ());');
  assert.equal(execute(built.wasm).output,'<fn>');
  assert.ok(built.effect_functions.some(f=>f.effects.includes('effect:main.tt::Read')));
});
test('discarding callback results does not erase effects', () => {
  const body='let discard=fn f=>fn x=>do {let ignored=f x; return 7;}; return discard Read ();';
  reject(()=>compile(E+body),'E_EFFECT_UNHANDLED');
  assert.equal(evaluate(E+'let discard=fn f=>fn x=>do {let ignored=f x; return 7;}; return handle Read with (fn u=>42) in discard Read ();').value,7n);
});
test('effect inference composes through generic higher-order handlers and aliases', () => {
  const source=E+'let scoped=fn f=>handle Read with (fn u=>40) in f (); let helper=fn f=>fn x=>f x; return scoped (helper (fn u=>Read ()+2));';
  assert.equal(evaluate(source).value,42n);
});
test('effect inference retains callbacks through records, arrays, projections and get', () => {
  for(const expression of ['r.f ()','(get fs 0) ()']) {
    const prefix=E+'let r={.f=Read;};let fs=[Read];';
    reject(()=>compile(prefix+'return '+expression+';'),'E_EFFECT_UNHANDLED');
    assert.equal(evaluate(prefix+'return handle Read with (fn u=>42) in '+expression+';').value,42n);
  }
});
test('map and scalar fold accumulate callback effects in Wasm', () => {
  const source=E+'let f=fn x=>x+Read (); return handle Read with (fn u=>10) in fold (fn sum=>fn x=>sum+f x) 0 (map f [1,2,3]);';
  assert.equal(evaluate(source).value,66n);
  reject(()=>compile(E+'return map (fn x=>Read ()) [1,2];'),'E_EFFECT_UNHANDLED');
});
test('pure arrow annotations cannot hide effects directly or through generic wrappers', () => {
  for (const value of ['Read','(fn u=>Read ())','id Read'])
    reject(()=>compile(E+`let id=fn x=>x; let f :: Unit -> Int = ${value}; return 1;`),'E_EFFECT');
  assert.equal(evaluate(E+'let f :: Unit -> Int ~ {Read}=fn u=>Read (); return handle Read with (fn u=>42) in f ();').value,42n);
});
test('pure higher-order parameter contracts reject effectful callbacks', () => {
  reject(()=>compile(E+'let apply=fn (f :: Unit -> Int)=>f (); return handle Read with (fn u=>42) in apply Read;'),'E_EFFECT');
});
test('unrelated handlers do not mask a missing effect and host operations are not source effects', () => {
  reject(()=>compile(E+'effect Other :: Unit -> Int; return handle Other with (fn u=>1) in Read ();'),'E_EFFECT_UNHANDLED');
  const c=compile(E+'return handle Read with (fn u=>1) in (host Read) ();');
  assert.deepEqual(c.effects,['host:main.tt::Read']);reject(()=>execute(c.wasm),'E_HOST_MISSING');
});
test('handler input/output shapes and refined contracts are checked', () => {
  reject(()=>compile(E+'return handle Read with (fn u=>true) in Read ();'),'E_TYPE');
  reject(()=>compile('const P=Int where self>0; effect E :: Int -> P; return handle E with (fn x=>0) in E 1;'),'E_REFINEMENT');
  reject(()=>compile('const P=Int where self>0; effect E :: Int -> Int; return handle E with (fn (x::P)=>x) in E 1;'),'E_REFINEMENT');
});
test('host capabilities must be explicit and matched by declaration key', () => {
  const c=compile(E+'return (host Read) ();');
  reject(()=>execute(c.wasm),'E_HOST_MISSING');reject(()=>execute(c.wasm,{host:new Map([['Read',()=>42n]])}),'E_HOST_MISSING');
  assert.equal(execute(c.wasm,{host:new Map([['main.tt::Read',()=>42n]])}).value,42n);
  assert.throws(()=>execute(c.wasm,{host:{'main.tt::Read':()=>42n}}),TypeError);
});
test('host result types, bounds and refined postconditions fail before becoming TT values', () => {
  const c=compile('const P=Int where self>0; effect Read :: Unit -> P; return (host Read) ();');
  for(const value of [0n,-1n,42,NaN,undefined,1n<<63n,Promise.resolve(42n)])
    reject(()=>execute(c.wasm,{host:new Map([['main.tt::Read',()=>value]])}),'E_HOST');
  assert.equal(execute(c.wasm,{host:new Map([['main.tt::Read',()=>42n]])}).value,42n);
});
test('generated Wasm enforces host postconditions even without the Node adapter', () => {
  const c=compile('const P=Int where self>0; effect Read :: Unit -> P; return (host Read) ();');
  const instance=new WebAssembly.Instance(new WebAssembly.Module(c.wasm),{'tt.host':{'main.tt::Read':()=>0n}});
  assert.throws(()=>instance.exports.main(),WebAssembly.RuntimeError);assert.equal(instance.exports.error_code(),14);
});
test('host Text/Bool/Unit copying is explicit and strict', () => {
  const logs=[];
  const c=compile('effect Log :: Text -> Unit; effect Flag :: Unit -> Bool; return do {let x=(host Log) "é🙂"; return (host Flag) ();};');
  const r=execute(c.wasm,{host:new Map([['main.tt::Log',x=>{logs.push(x);}],['main.tt::Flag',()=>true]])});
  assert.deepEqual(logs,['é🙂']);assert.equal(r.value,true);assert.equal(r.metrics.host_calls,2);assert.ok(r.metrics.host_ms>=0);
  reject(()=>execute(c.wasm,{host:new Map([['main.tt::Log',()=>9],['main.tt::Flag',()=>true]])}),'E_HOST');
  reject(()=>execute(c.wasm,{host:new Map([['main.tt::Log',()=>{}],['main.tt::Flag',()=>1]])}),'E_HOST');
});
test('host failures have source positions and abort without retrying the callback', () => {
  let calls=0;const source='effect Log :: Text -> Unit;\nreturn (host Log) "x";',built=compile(source,{sourceName:'host.tt'});
  assert.throws(()=>execute(built.wasm,{host:new Map([['host.tt::Log',()=>{calls++;throw new Error('boom');}]])}),e=>e.code==='E_HOST'&&e.source.line===2&&/boom/.test(e.message));
  assert.equal(calls,1);
});
test('fuel exhaustion precedes host authority and preserves strict host-call order', () => {
  const log=[];const c=compile('effect Emit :: Int -> Unit; let emit=host Emit; return do {let a=emit 1;let b=emit 2; return 42;};');
  const host=new Map([['main.tt::Emit',x=>{log.push(x);}]]);
  reject(()=>execute(c.wasm,{fuel:0,host}),'E_LIMIT');assert.deepEqual(log,[]);
  assert.equal(execute(c.wasm,{host}).value,42n);assert.deepEqual(log,[1n,2n]);
});
test('multi-module workflow uses the same service with pure and host interpreters', () => {
  const load=name=>readFileSync(new URL('../examples/effects-workflow/'+name,import.meta.url),'utf8');
  const pure=compileProject('pure.tt',load),host=compileProject('host.tt',load);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(pure.wasm)),[]);
  const expected='{ .rows = [{ .name = "alpha"; .value = 30; }, { .name = "beta"; .value = 60; }]; .total = 90; .elapsed = 0; }';
  assert.equal(execute(pure.wasm).output,expected);
  let time=1000n;const saved=[],logs=[];
  const result=execute(host.wasm,{host:new Map([['operations.tt::Clock',()=>time++],['operations.tt::Save',x=>{saved.push(x);}],['operations.tt::Emit',x=>{logs.push(x);}]])});
  assert.equal(result.output,expected.replace('.elapsed = 0','.elapsed = 1'));assert.deepEqual(saved,[90n]);assert.deepEqual(logs,['batch processed']);assert.equal(result.metrics.host_calls,4);
});
test('saved module artifacts preserve imported-file runtime provenance without source files', () => {
  const c=project({'main.tt':'let L=import "./lib.tt"; return L.f ();','lib.tt':'let f=fn u=>\n  1/0;\nreturn {.f=f;};'});
  assert.throws(()=>execute(c.wasm),e=>e.code==='E_RUNTIME'&&e.source.name==='lib.tt'&&e.source.line===2);
});
test('module parse and type failures point into their owning source', () => {
  for(const body of ['let x=; return {};','return {.x=missing;};'])
    assert.throws(()=>project({'main.tt':'let L=import "./lib.tt"; return L;','lib.tt':body}),e=>e instanceof TTError&&e.source?.name==='lib.tt');
});
test('file CLI compiles imported modules and saved Wasm runs after files are removed', t => {
  const dir=mkdtempSync(join(tmpdir(),'tt-modules-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const main=join(dir,'main.tt'),lib=join(dir,'lib.tt'),wasm=join(dir,'output.wasm'),cli=new URL('../src/cli.mjs',import.meta.url).pathname;
  writeFileSync(main,'let L=import "./lib.tt"; return L.f 40;');writeFileSync(lib,'let f=fn x=>x+2;return {.f=f;};');
  const built=spawnSync(process.execPath,[cli,'build',main,'-o',wasm],{encoding:'utf8',timeout:10000});assert.equal(built.status,0,built.stderr);
  rmSync(main);rmSync(lib);const ran=spawnSync(process.execPath,[cli,'exec',wasm],{encoding:'utf8',timeout:10000});assert.equal(ran.status,0,ran.stderr);assert.equal(ran.stdout.trim(),'42');
});
test('local file provider rejects a symlink escaping the granted project root', t => {
  const dir=mkdtempSync(join(tmpdir(),'tt-module-path-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'project'));
  writeFileSync(join(dir,'outside.tt'),'return {};');writeFileSync(join(dir,'project/main.tt'),'let L=import "./link.tt"; return L;');
  symlinkSync(join(dir,'outside.tt'),join(dir,'project/link.tt'));
  const p=fileProject(join(dir,'project/main.tt'));reject(()=>compileProject(p.entry,p.read),'E_MODULE');
});
test('effect callback rows cannot be laundered by record or array annotations', () => {
  for(const body of ['let r :: {.f:Unit->Int;}={.f=Read;}; return r.f ();','let xs :: [Unit->Int]=[Read];return (get xs 0) ();'])
    reject(()=>compile(E+body),'E_EFFECT');
});
test('host-free handling does not introduce any engine import or host call', () => {
  const c=compile(E+'return handle Read with (fn u=>42) in Read ();');const r=execute(c.wasm);
  assert.equal(r.metrics.host_calls,0);assert.deepEqual(loadWasm(c.wasm).hostEffects,[]);
});

test('generic handler combinators preserve root handler effects instead of requiring purity', () => {
  const source=E+'let scoped=fn h=>fn f=>handle Read with h in f (); return scoped (host Read) Read;';
  const c=compile(source);assert.deepEqual(c.effects,['host:main.tt::Read']);
  assert.equal(execute(c.wasm,{host:new Map([['main.tt::Read',()=>42n]])}).value,42n);
  assert.equal(evaluate(E+'let scoped=fn h=>fn f=>handle Read with h in f (); return scoped (fn u=>42) Read;').value,42n);
});

test('handler scope is reset by the next main invocation after a trap', () => {
  const source=E+'return handle Read with (fn u=>42) in Read ();';
  const {module,abi}=loadWasm(compile(source).wasm),instance=new WebAssembly.Instance(module,{});
  for(const fuel of [0n,1n,5n]) {
    instance.exports.set_fuel(fuel);assert.throws(()=>instance.exports.main(),WebAssembly.RuntimeError);
    instance.exports.set_fuel(1000n);const pointer=instance.exports.main();
    assert.equal(new DataView(instance.exports.memory.buffer).getBigInt64(pointer+16,true),42n);
    assert.equal(instance.exports.error_code(),0);
  }
});

test('source operation input refinements remain checked across module exports', () => {
  const common={
    'ops.tt':'const P=Int where self>0; effect Positive :: P -> Int; return {.Positive=Positive;};',
  };
  reject(()=>project({...common,'main.tt':'let O=import "./ops.tt"; return handle O.Positive with (fn x=>x) in O.Positive (-1);'}),'E_REFINEMENT');
  assert.equal(execute(project({...common,'main.tt':'let O=import "./ops.tt"; return handle O.Positive with (fn x=>x) in O.Positive 42;'}).wasm).value,42n);
});

test('generic handler requirements cannot erase narrower input or output refinements', () => {
  const common='const P=Int where self>0; effect E :: Int -> Int; let scope=fn h=>handle E with h in E (-1);';
  reject(()=>compile(common+'return scope (fn(x::P)=>x);'),'E_REFINEMENT');
  reject(()=>compile(common+'let bad :: (P->Int)->Int=scope; return 1;'),'E_REFINEMENT');
  assert.equal(evaluate(common+'return scope (fn x=>x);').value,-1n);
  const outputs='const P=Int where self>0; effect E :: Unit -> P; let scope=fn h=>handle E with h in E ();';
  reject(()=>compile(outputs+'return scope (fn u=>0);'),'E_REFINEMENT');
  assert.equal(evaluate(outputs+'return scope (fn u=>42);').value,42n);
});

test('explicit source resolvers are called once per canonical module path', () => {
  const files=new Map([['main.tt','let A=import "./a.tt";let B=import "./sub/../a.tt";return A.value+B.value;'],['a.tt','return {.value=21;};']]);
  const visits=[];const c=compileProject('main.tt',name=>{visits.push(name);return files.get(name);});
  assert.deepEqual(visits,['main.tt','a.tt']);assert.equal(c.metrics.module_count,2);assert.equal(execute(c.wasm).value,42n);
});

test('unused closures retain latent effects without executing host callbacks', () => {
  const c=compile(E+'return fn u=>(host Read) ();');let calls=0;
  const result=execute(c.wasm,{host:new Map([['main.tt::Read',()=>{calls++;return 42n;}]])});
  assert.equal(result.output,'<fn>');assert.equal(calls,0);assert.deepEqual(c.effects,[]);
  assert.ok(c.effect_functions.some(f=>f.effects.includes('host:main.tt::Read')));
});

test('pure and explicit host handlers agree with an independent arithmetic model', () => {
  for(let i=0;i<100;i++) {
    const factor=BigInt(i%7-3),offset=BigInt(i%13-6);
    const body='effect Shift :: Int -> Int; let transform=fn (f :: Int -> Int ~ {Shift})=>map f [-2,-1,0,1,2]; ';
    const source=body+`return handle Shift with (fn x=>x*(${factor})+(${offset})) in transform Shift;`;
    const hostSource=body+'return handle Shift with host Shift in transform Shift;';
    const expected=[-2n,-1n,0n,1n,2n].map(x=>x*factor+offset);
    assert.deepEqual(evaluate(source).value.values,expected);
    assert.deepEqual(evaluate(hostSource,{host:new Map([['main.tt::Shift',x=>x*factor+offset]])}).value.values,expected);
  }
});

// Test manifest claims against the actual Wasm import types, even when digests
// have deliberately been recomputed. Integrity hashes are not authentication.
function rawSections(bytes) {
  let at=8;const out=[];const u32=()=>{let n=0;for(let i=0;i<5;i++){const b=bytes[at++];n+=(b&127)*2**(7*i);if(!(b&128))return n;}throw new Error('LEB');};
  while(at<bytes.length){const start=at,id=bytes[at++],size=u32(),payload=at,end=at+size;let name='';if(id===0){const n=u32();name=bytes.subarray(at,at+n).toString();at+=n;}out.push({id,name,start,payload,body:at,end});at=end;}
  return out;
}
function altered(wasm, transform) {
  const loaded=loadWasm(wasm), sections=rawSections(wasm).filter(s=>s.name!=='tt.abi');
  const chunks=transform(sections.map(s=>({...s,bytes:wasm.subarray(s.start,s.end),data:s.name?wasm.subarray(s.body,s.end):null})));
  const core=Buffer.concat([wasm.subarray(0,8),...chunks.map(s=>s.bytes)]);
  const abi={schema:loaded.abi.schema,version:loaded.abi.version,labels:loaded.abi.labels,heap_start:loaded.abi.heap_start,core_bytes:core.length,core_sha256:createHash('sha256').update(core).digest('hex')};
  abi.metadata_sha256=createHash('sha256').update(JSON.stringify(abi)).digest('hex');
  const payload=new Bytes().name('tt.abi').add(Buffer.from(JSON.stringify(abi))).finish();
  const out=Buffer.concat([core,Buffer.from([0,...uleb(payload.length)]),payload]);assert.ok(WebAssembly.validate(out));return out;
}
function custom(name,value) {
  const payload=new Bytes().name(name).add(Buffer.from(JSON.stringify(value))).finish();
  return {id:0,name,bytes:Buffer.concat([Buffer.from([0,...uleb(payload.length)]),payload])};
}

test('host loader checks actual machine signatures and refuses malformed manifests', () => {
  const wasm=compile(E+'return (host Read) ();').wasm;
  for(const mutate of [
    data=>{data.operations[0].output={kind:'Bool'};},
    data=>{data.operations[0].key='different::Read';},
    data=>{data.operations.push(data.operations[0]);},
    data=>{data.version=2;},
    data=>{data.operations[0].output={kind:'Int',ranges:[['2','1']]};},
    data=>{data.operations[0].input={kind:'Text'};},
  ]) {
    const bytes=altered(wasm,sections=>sections.map(s=>{if(s.name!=='tt.effects')return s;const data=JSON.parse(s.data);mutate(data);return custom('tt.effects',data);}));
    reject(()=>loadWasm(bytes),'E_WASM');
  }
  reject(()=>loadWasm(altered(wasm,sections=>sections.filter(s=>s.name!=='tt.effects'))),'E_WASM');
  reject(()=>loadWasm(altered(wasm,sections=>[...sections,sections.find(s=>s.name==='tt.effects')])),'E_WASM');
});

test('host artifacts cannot run a start function before capability initialization', () => {
  const wasm=compile('effect Emit :: Unit -> Unit; return (host Emit) ();').wasm;
  const bytes=altered(wasm,sections=>{const index=sections.findIndex(s=>s.id>8);const start={id:8,bytes:Buffer.from([8,1,0])};return [...sections.slice(0,index),start,...sections.slice(index)];});
  let calls=0;assert.throws(()=>execute(bytes,{host:new Map([['main.tt::Emit',()=>{calls++;}]])}),e=>e.code==='E_WASM'&&/start/.test(e.message));
  assert.equal(calls,0);
});

test('module provenance validates line tables and complete virtual source coverage', () => {
  const wasm=project({'main.tt':'let L=import "./lib.tt";return L.x;','lib.tt':'return {.x=42;};'}).wasm;
  for(const mutate of [
    data=>{data.sources[0].lines=[1];},
    data=>{data.sources[1].start=0;},
    data=>{data.sources[1].name=data.sources[0].name;},
    data=>{data.sources.pop();},
    data=>{data.sources[0].sha256='wrong';},
  ]) {
    const bytes=altered(wasm,sections=>sections.map(s=>{if(s.name!=='tt.modules')return s;const data=JSON.parse(s.data);mutate(data);return custom('tt.modules',data);}));
    reject(()=>loadWasm(bytes),'E_WASM');
  }
});

test('module and effect summary work stays bounded across growing wrapper/diamond workloads', async () => {
  const {repeatedCalls,diamondModules}=await import('../benchmarks/modules-effects.mjs');
  for(const n of [100,200,400]) {
    const c=compile(repeatedCalls(n),{emit:false});
    assert.ok(c.metrics.effect_steps<100*n+1000);assert.equal(c.effect_functions.length,3);
  }
  for(const n of [16,32,64]) {
    const c=compileProject('main.tt',diamondModules(n),{emit:false});
    assert.equal(c.metrics.module_count,n+2);assert.ok(c.metrics.effect_steps<200*n+1000);
  }
});

test('effect-summary budget exhaustion is a limit, never proof of purity', async () => {
  const {Effects}=await import('../src/effects.mjs');const {LIMITS}=await import('../src/core.mjs');
  const effects=new Effects(null,null,{builtins:[]});effects.steps=LIMITS.proofSteps;
  reject(()=>effects.call({kind:'Signature',contract:{kind:'Function',a:{kind:'Unit'},b:{kind:'Int'},effects:[]}},null,0),'E_LIMIT');
});

test('pure handlers support structured values and effectful callback contracts', () => {
  assert.equal(evaluate('effect Fetch :: Int -> {.value:Int;.name:Text;}; return handle Fetch with (fn x=>{.value=x;.name="item";}) in (Fetch 42).value;').value,42n);
  assert.deepEqual(evaluate('effect Items :: Int -> [Int]; return handle Items with (fn x=>[x,x]) in Items 21;').value.values,[21n,21n]);
  const source='effect Read :: Unit -> Int; effect Apply :: (Unit -> Int ~ {Read}) -> Int; return handle Read with (fn u=>42) in handle Apply with (fn f=>f ()) in Apply Read;';
  assert.equal(evaluate(source).value,42n);
  reject(()=>compile('effect Read :: Unit -> Int; effect Apply :: (Unit -> Int) -> Int; return handle Read with (fn u=>42) in handle Apply with (fn f=>f ()) in Apply Read;'),'E_EFFECT');
});

test('simulation modules share bare systems between pure and refinement-checked host input', () => {
  const load=name=>readFileSync(new URL('../examples/effects-simulation/'+name,import.meta.url),'utf8');
  const pure=compileProject('pure.tt',load),host=compileProject('host.tt',load),reports=[];
  const options={host:new Map([['operations.tt::Step',()=>2n],['operations.tt::Axis',()=>1n],['operations.tt::Report',n=>{reports.push(n);}]])};
  const a=execute(pure.wasm),b=execute(host.wasm,options);
  assert.equal(a.output,b.output);assert.deepEqual(b.value.values.map(r=>r.values[1]),[17n,17n]);assert.deepEqual(reports,[34n]);
  assert.equal(b.metrics.host_calls,5);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(pure.wasm)),[]);
  const bad=new Map(options.host);bad.set('operations.tt::Axis',()=>9n);reject(()=>execute(host.wasm,{host:bad}),'E_HOST');
  assert.deepEqual(reports,[34n],'bad input aborted before reporting a result');
});

test('effect modes cannot be confused with a diagnostic name prefix', () => {
  const c=compile(E+'let read :: Unit -> Int ~ {Read}=Read; return handle Read with (fn u=>42) in read ();',{sourceName:'host:demo.tt'});
  assert.deepEqual(c.effects,[]);assert.equal(execute(c.wasm).value,42n);
  reject(()=>compile(E+'let read :: Unit -> Int ~ {Read}=host Read; return 1;',{sourceName:'host:demo.tt'}),'E_EFFECT');
});

test('README module snippets run as a complete pure project', () => {
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  const blocks=[...readme.matchAll(/```text\n([\s\S]*?)```/g)].map(m=>m[1]);
  const sources=new Map([['operations.tt',blocks.find(s=>s.startsWith('// operations.tt'))],['service.tt',blocks.find(s=>s.startsWith('// service.tt'))],['pure.tt',blocks.find(s=>s.startsWith('// pure.tt'))]]);
  for(const source of sources.values())assert.equal(typeof source,'string');
  assert.equal(execute(compileProject('pure.tt',sources).wasm).value,0n);
});
