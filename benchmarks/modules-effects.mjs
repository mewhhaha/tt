#!/usr/bin/env node
/** Local, deterministic module/effect scaling and separately timed host execution. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compile, compileProject, execute } from '../src/compiler.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../', import.meta.url));
const provenance = () => Object.fromEntries(['package.json', 'benchmarks/modules-effects.mjs', ...readdirSync(new URL('../src', import.meta.url)).filter(p=>p.endsWith('.mjs')).map(p=>'src/'+p)].sort().map(p=>[p,sha(readFileSync(new URL('../'+p,import.meta.url)))]));
export function repeatedCalls(n, host = false) {
  return 'effect Read :: Unit -> Int; let discard=fn f=>fn x=>do {let ignored=f x;return 7;}; ' +
    `return handle Read with ${host?'host Read':'(fn u=>42)'} in do {` +
    Array.from({length:n},(_,i)=>`let v${i}=discard Read ();`).join('') + `return v${n-1};};`;
}
export function diamondModules(n) {
  const sources = new Map([['operations.tt','effect Read :: Unit -> Int; return {.Read=Read;};']]);
  let main='let Ops=import "./operations.tt";';
  for(let i=0;i<n;i++) { sources.set(`lib${i}.tt`,'let Ops=import "./operations.tt";let run=fn x=>Ops.Read ()+x;return {.run=run;};');main+=`let L${i}=import "./lib${i}.tt";`; }
  sources.set('main.tt',main+`return handle Ops.Read with (fn u=>40) in L${n-1}.run 2;`);return sources;
}
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
export function benchmark({samples=11}={}) {
  const before=provenance(),reports=[];
  for(const size of [500,1000,2000]) {
    const source=repeatedCalls(size);const build=()=>compile(source);for(let i=0;i<3;i++)build();const raw=[];let last;
    for(let i=0;i<samples;i++){const t=performance.now();last=build();raw.push({total_ms:performance.now()-t,...last.metrics});}
    assert.equal(execute(last.wasm).value,7n);assert.deepEqual(last.effects,[]);
    assert.ok(last.metrics.effect_steps < 100*size+1000, 'effect-summary work grew beyond linear gate');
    assert.ok(last.metrics.emitted_expressions < 20*size+100, 'emitter revisited bodies');
    assert.equal(last.effect_functions.length,3,'ordinary generic bodies are analyzed once');
    reports.push({name:'discarded-effect-calls',size,source_sha256:sha(source),median_compile_ms:median(raw.map(x=>x.total_ms)),work:Object.fromEntries(Object.entries(last.metrics).filter(([name])=>!name.endsWith('_ms'))),raw:raw.map(row=>Object.fromEntries(Object.entries(row).filter(([name])=>name.endsWith('_ms'))))});
  }
  for(const size of [32,64,128]) {
    const sources=diamondModules(size);const source_sha256=sha(JSON.stringify([...sources].sort(([a],[b])=>a.localeCompare(b))));
    for(let i=0;i<3;i++)compileProject('main.tt',sources);const raw=[];let last;
    for(let i=0;i<samples;i++){const t=performance.now();last=compileProject('main.tt',sources);raw.push({total_ms:performance.now()-t,...last.metrics});}
    assert.equal(last.metrics.module_count,size+2);assert.equal(execute(last.wasm).value,42n);
    assert.ok(last.metrics.effect_steps < 200*size+1000);assert.ok(last.metrics.ast_nodes < 40*size+100);
    reports.push({name:'diamond-module-graph',size,source_sha256,median_compile_ms:median(raw.map(x=>x.total_ms)),raw});
  }
  const runtime=[];
  for(const host of [false,true]) {
    const source=repeatedCalls(256,host),built=compile(source),hostMap=new Map([['main.tt::Read',()=>42n]]);
    for(let i=0;i<3;i++)execute(built.wasm,{host:hostMap});const raw=[];
    for(let i=0;i<samples;i++){const r=execute(built.wasm,{host:hostMap});assert.equal(r.value,7n);assert.equal(r.metrics.host_calls,host?256:0);raw.push(r.metrics);}
    runtime.push({mode:host?'explicit-host':'pure-wasm',wasm_sha256:sha(built.wasm),wasm_bytes:built.wasm.length,source_sha256:sha(source),raw});
  }
  assert.deepEqual(provenance(),before,'sources changed during measurement');
  return {schema:1,date:new Date().toISOString(),node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,node_sha256:sha(readFileSync(process.execPath)),sources:before,samples,
    boundary:'Compilation includes parse/infer/effect summaries/refinements/emission/engine validation/type display; individual phases retained. Source generation excluded. Runtime executes already-emitted modules: load (including engine compilation), instantiation, execution, copying and display separate. host_ms is nested within execute_ms. Repeated engine caches/GC may affect samples; not cold-engine or cross-platform qualification.',reports,runtime};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const file=process.argv[2]??resolve(root,'benchmarks/modules-effects-local.json');
  const report=benchmark();writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  for(const r of report.reports)console.log(`${r.name} ${r.size}: ${r.median_compile_ms.toFixed(3)} ms`);
  console.log('Pure/host execution parity and work gates passed:',file);
}
