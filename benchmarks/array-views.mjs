/** Node-only allocation/work gates and isolated Wasm timings for immutable array operations. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { compile, loadWasm, readValue } from '../src/compiler.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const median=xs=>[...xs].sort((a,b)=>a-b)[xs.length>>1];
const inputs=()=>Object.fromEntries(['package.json','benchmarks/array-views.mjs',...readdirSync(resolve(root,'src')).filter(p=>p.endsWith('.mjs')).map(p=>'src/'+p)].sort().map(p=>[p,hash(readFileSync(resolve(root,p)))]));
export function writeWorkload(n,writes){
  let s=`let a0=@own [${Array.from({length:n},(_,i)=>i).join(',')}];`;
  for(let i=0;i<writes;i++)s+=`let a${i+1}=@set(@move a${i},${i%n},${i+100});`;
  return s+`return @borrow a${writes} as xs in @get(xs,0);`;
}
export function viewWorkload(n,materialized=false){
  const half=n>>1;
  return `let a=[${Array.from({length:n},(_,i)=>i).join(',')}];let v=@concat(@slice(a,${half},${n}),@slice(a,0,${half}));let r=${materialized?'@materialize(v)':'v'};return @get(r,${n-1});`;
}
function prepare(source,options){
  const start=performance.now(),built=compile(source,options),compile_ms=performance.now()-start;
  let t=performance.now();const loaded=loadWasm(built.wasm),load_ms=performance.now()-t;
  t=performance.now();const instance=new WebAssembly.Instance(loaded.module,{}),instantiate_ms=performance.now()-t;
  instance.exports.set_fuel(1_000_000_000n);
  return {source,built,loaded,instance,compile_ms,load_ms,instantiate_ms};
}
function state(p){
  const e=p.instance.exports,pointer=e.main(),view=new DataView(e.memory.buffer);
  const t=performance.now(),value=readValue(e.memory,pointer,p.loaded.abi),decode_ms=performance.now()-t;
  return {value:String(value),remaining_fuel:String(e.fuel_remaining()),heap_bytes:view.getUint32(12,true)-p.loaded.abi.heap_start,
    owned_live:e.owned_live_bytes?.()??0,owned_reserved:e.owned_reserved_bytes?.()??0,owned_reuses:e.owned_reuses?.()??0,memory_capacity:e.memory.buffer.byteLength,decode_ms};
}
function compare(a,b,calls,samples){
  const before=state(a),after=state(b);assert.equal(after.value,before.value);assert.equal(after.owned_live,0);
  for(let i=0;i<10;i++){a.instance.exports.main();b.instance.exports.main();}
  const raw={before:[],after:[]};let checksum=0;
  for(let i=0;i<samples;i++)for(const name of i%2?['after','before']:['before','after']){
    const e=(name==='before'?a:b).instance.exports,t=performance.now();
    for(let j=0;j<calls;j++)checksum^=e.main();
    raw[name].push((performance.now()-t)/calls);
  }
  assert.equal(state(a).value,before.value);assert.equal(state(b).value,after.value);
  const details=p=>({source_sha256:hash(p.source),wasm_sha256:hash(p.built.wasm),wasm_bytes:p.built.wasm.length,
    compile_ms:p.compile_ms,load_ms:p.load_ms,instantiate_ms:p.instantiate_ms,compile_metrics:p.built.metrics});
  return {calls_per_sample:calls,raw_ms:raw,median_ms:{before:median(raw.before),after:median(raw.after)},
    before:{...details(a),...before},after:{...details(b),...after},checksum};
}
export function benchmark({samples=11}={}){
  const initial=inputs(),reports=[];
  for(const n of [128,1024,4096]){
    const source=writeWorkload(n,64),a=prepare(source,{optimize:false}),b=prepare(source,{optimize:true});
    const row=compare(a,b,20,samples);assert.equal(row.before.value,'100');assert.equal(row.after.owned_reuses,0);
    assert.equal(row.before.owned_reserved,2*row.after.owned_reserved);reports.push({name:'64-consuming-writes',size:n,...row});
  }
  for(const n of [512,4096,16384]){
    const a=prepare(viewWorkload(n,true)),b=prepare(viewWorkload(n,false)),row=compare(a,b,100,samples);
    assert.equal(row.before.value,String((n>>1)-1));
    assert.equal(row.before.heap_bytes-row.after.heap_bytes,16+4*n);
    reports.push({name:'view-versus-materialization',size:n,...row});
  }
  const scaling=[];
  for(const n of [100,200,400]){
    const source=writeWorkload(32,n),raw=[];let built;
    for(let i=0;i<samples;i++){const t=performance.now();built=compile(source);raw.push(performance.now()-t);}
    assert.ok(built.metrics.ownership_steps<100*n+1000);
    assert.ok(built.metrics.proof_steps<100*n+1000);
    assert.ok(built.metrics.wasm_bytes<300*n+10000);
    scaling.push({writes:n,raw_ms:raw,median_ms:median(raw),metrics:built.metrics});
  }
  assert.deepEqual(inputs(),initial);
  return {schema:1,recorded_at:new Date().toISOString(),node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,
    node_sha256:hash(readFileSync(process.execPath)),inputs:initial,samples,warmups:10,
    boundaries:{runtime:'Alternating already-instantiated Wasm main calls; includes source array/owner construction each call, excludes loading, host decode and display. No raw pointer identity equality claimed.',
      comparison:'Writes compare consuming in-place scalar set with the copying reference lowering on the identical source. Views compare the identical logical result with/without explicit flat materialization.',
      compile:'Scaling includes parse/infer/ownership/effects/refinements/emission/Wasm validation; source generation excluded; no result cache. Other compile/load measurements are single observations, not medians.',
      memory:'Logical allocation counters and memory capacity, not RSS or returned-to-OS pages. GC and reference counting are not present in the TT runtime.'},reports,scaling};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=benchmark();const output=process.argv[2]??resolve(root,'benchmarks/array-views-local.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  for(const r of report.reports)console.log(`${r.name}/${r.size}: ${r.median_ms.before.toFixed(4)} -> ${r.median_ms.after.toFixed(4)} ms; heap ${r.before.heap_bytes} -> ${r.after.heap_bytes}, owners ${r.before.owned_reserved} -> ${r.after.owned_reserved}`);
  console.log('PASS array work and allocation gates:',output);
}
