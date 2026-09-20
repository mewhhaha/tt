#!/usr/bin/env node
/** Node-only ownership work/memory gates; timings keep engine and host stages apart. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {compile,loadWasm,readValue,display} from '../src/compiler.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const median=xs=>[...xs].sort((a,b)=>a-b)[xs.length>>1];
const root=fileURLToPath(new URL('../',import.meta.url));
const inputHashes=()=>Object.fromEntries(['package.json','benchmarks/ownership.mjs',...readdirSync(resolve(root,'src')).filter(x=>x.endsWith('.mjs')).map(x=>'src/'+x)].sort().map(p=>[p,sha(readFileSync(resolve(root,p)))]));
export const declarations=n=>Array.from({length:n},(_,i)=>`let a${i}=@own ${i};let d${i}=@drop a${i};`).join('')+'return 42;';
export function frames(n,owned=true){
  const setup='let step=fn r=>{.x=r.x+1;.items=map (fn x=>x+1) r.items;};'+
    `let indices=[${Array(n).fill('0').join(',')}];`;
  return owned?setup+'let a=@own {.x=0;.items=[1,2];};let b=@evolve (@move a) by length indices with step;return @take (@move b);':
    setup+'return fold (fn r=>fn ignored=>step r) {.x=0;.items=[1,2];} indices;';
}
export async function benchmark(output,baselineDir=null){
  const inputs=inputHashes(),compileRows=[],runtime=[];
  const baseline=baselineDir?await import(pathToFileURL(resolve(baselineDir,'compiler.mjs'))):null;
  for(const n of [500,1000,2000]){
    const source=declarations(n),raw=[];for(let i=0;i<3;i++)compile(source);
    for(let i=0;i<11;i++){const start=performance.now(),c=compile(source);raw.push({total_ms:performance.now()-start,...c.metrics});}
    const metrics=raw.at(-1);assert.ok(metrics.ownership_steps<25*n+100);assert.ok(metrics.emitted_expressions<10*n+100);assert.ok(metrics.wasm_bytes<200*n+10000);
    compileRows.push({n,source_sha256:sha(source),median_ms:median(raw.map(x=>x.total_ms)),raw});
  }
  for(const n of [100,1000,10000]){
    const programs=[['owned',compile,frames(n,true)]];
    if(baseline)programs.unshift(['invocation_arena',baseline.compile,frames(n,false)]);
    const states=programs.map(([mode,build,source])=>{
      const built=build(source),t=performance.now(),loaded=loadWasm(built.wasm),load_ms=performance.now()-t;
      const start=performance.now(),instance=new WebAssembly.Instance(loaded.module,{}),instantiate_ms=performance.now()-start;
      for(let i=0;i<5;i++)instance.exports.main();
      return {mode,source_sha256:sha(source),wasm_sha256:sha(built.wasm),wasm_bytes:built.wasm.length,load_ms,instantiate_ms,loaded,instance,raw_ms:[]};
    });
    for(let i=0;i<11;i++)for(const s of i%2?states.toReversed():states){const start=performance.now();for(let call=0;call<10;call++)s.pointer=s.instance.exports.main();s.raw_ms.push((performance.now()-start)/10);}
    let expected;
    for(const s of states){
      let start=performance.now();const value=readValue(s.instance.exports.memory,s.pointer,s.loaded.abi),decode_ms=performance.now()-start;
      start=performance.now();const text=display(value),display_ms=performance.now()-start;
      assert.equal(value.values[0],BigInt(n));assert.deepEqual(value.values[1].values,[BigInt(n+1),BigInt(n+2)]);
      if(expected)assert.equal(text,expected);else expected=text;
      const e=s.instance.exports,heap=new DataView(e.memory.buffer).getUint32(12,true)-s.loaded.abi.heap_start;
      let owned={};if(s.mode==='owned'){
        owned={live_bytes:e.owned_live_bytes(),peak_bytes:e.owned_peak_bytes(),reserved_bytes:e.owned_reserved_bytes(),reuses:e.owned_reuses()};
        assert.equal(owned.live_bytes,0);assert.equal(owned.reserved_bytes,320);assert.equal(owned.reuses,n-1);
      }
      runtime.push({mode:s.mode,n,source_sha256:s.source_sha256,wasm_sha256:s.wasm_sha256,wasm_bytes:s.wasm_bytes,
        raw_execute_ms:s.raw_ms,median_execute_ms:median(s.raw_ms),load_ms:s.load_ms,instantiate_ms:s.instantiate_ms,
        decode_ms,display_ms,output_sha256:sha(text),heap_bytes:heap,owned,memory_capacity_bytes:e.memory.buffer.byteLength});
    }
  }
  let unchanged_artifacts=null;
  if(baseline){const fixtures=JSON.parse(readFileSync(resolve(root,'tests/fixtures.json'),'utf8'));unchanged_artifacts=0;
    for(const f of fixtures)if(f.outcome==='accept'&&f.output!==null&&f.output!==undefined){assert.deepEqual(compile(f.source).wasm,baseline.compile(f.source).wasm);unchanged_artifacts++;}}
  assert.deepEqual(inputHashes(),inputs,'inputs changed during measurement');
  const report={schema:1,date:new Date().toISOString(),node:process.version,v8:process.versions.v8,cpu:cpus()[0]?.model,
    platform:process.platform,arch:process.arch,node_sha256:sha(readFileSync(process.execPath)),inputs,unchanged_artifacts,
    samples:11,compile_warmups:3,runtime_warmups:5,calls_per_runtime_sample:10,
    boundary:'Compile includes parsing/shape/ownership/effects/refinements/emission/validation/type display, no result cache. Runtime measures repeated same-instance main after warmup; module load and instantiation, host decode and display are outside the execution loop. Engine construction may be cached.',
    comparison:'Owned evolve and ordinary fold are different source-level lifetime choices with matching returned values and shared index-array input. They are not identical machine work/fuel or an automatic optimization speedup. Whole-block copies can cost more CPU. No GC or reference counting runs in either TT module.',
    memory:'heap_bytes is the successful lower invocation prefix, not peak allocations. Owned live/peak/reserved bytes include 32-byte block headers. Freed high-arena capacity is reusable but not returned to the OS. Actual Wasm capacity includes the fixed scratch reserve. Incidental Node GC is outside the TT memory-management contract.',
    compile:compileRows,runtime};
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  for(const r of compileRows)console.log(`ownership declarations ${r.n}: ${r.median_ms.toFixed(3)} ms`);
  for(const r of runtime)console.log(`${r.mode} frames=${r.n}: ${r.median_execute_ms.toFixed(3)} ms, invocation=${r.heap_bytes}, owned=${JSON.stringify(r.owned)}, memory capacity=${r.memory_capacity_bytes}`);
  console.log('PASS ownership work and allocation gates:',output);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await benchmark(resolve(process.argv[2]??resolve(root,'benchmarks/ownership-local.json')),process.argv[3]?resolve(process.argv[3]):null);
