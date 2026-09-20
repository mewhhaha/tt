#!/usr/bin/env node
/** Matched frontend comparison; give an exact local pre-change src directory. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, compileProject, execute } from '../src/compiler.mjs';
import { workload } from './run.mjs';
import { repeatedCalls, diamondModules } from './modules-effects.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const median = xs => [...xs].sort((a,b)=>a-b)[xs.length >> 1];
const sourceHashes = directory => Object.fromEntries(readdirSync(directory).filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,hash(readFileSync(join(directory,n)))]));
const work = r => Object.fromEntries(Object.entries(r.metrics).filter(([k])=>!k.endsWith('_ms')));
const phases = r => Object.fromEntries(Object.entries(r.metrics).filter(([k])=>k.endsWith('_ms')));
export function sources() {
  return [
    ...['records','wrappers','polymorphism','refinements','refinement_relations'].map(name=>({name,size:2000,source:workload(name,2000)})),
    {name:'effect_calls',size:2000,source:repeatedCalls(2000)},
    {name:'modules',size:128,project:diamondModules(128)},
    {name:'owner_bindings',size:1000,source:Array.from({length:1000},(_,i)=>`let o${i}=@own [${i}];let d${i}=@drop o${i};`).join('')+'return 42;'},
    {name:'owned_writes',size:256,source:'let a0=@own [1,2,3,4];'+Array.from({length:256},(_,i)=>`let a${i+1}=@set(@move a${i},${i%4},${i});`).join('')+'return @take(@move a256);'},
    {name:'plain_text',size:512*1024,source:'return "'+'a'.repeat(512*1024)+'";'},
    {name:'escaped_text',size:16384,source:'return "'+String.raw`abc\né🙂`.repeat(16384)+'";'},
    {name:'comment',size:512*1024,source:'//'+'a'.repeat(512*1024)+'\nreturn 42;'},
  ];
}
export async function benchmark(baselineDirectory) {
  const before = await import(pathToFileURL(join(baselineDirectory,'compiler.mjs')));
  const baselineHashes = sourceHashes(baselineDirectory), currentHashes = sourceHashes(join(root,'src'));
  assert.deepEqual(Object.keys(currentHashes),Object.keys(baselineHashes));
  for(const name of Object.keys(currentHashes))if(name!=='syntax.mjs')assert.equal(currentHashes[name],baselineHashes[name],`unmatched production input ${name}`);
  const after = {compile,compileProject}, rows=[]; let fixtureParity=0;
  const compare=(a,b)=>{assert.deepEqual(b.wasm,a.wasm);assert.equal(b.type,a.type);assert.deepEqual(b.effects,a.effects);assert.deepEqual(b.effect_functions,a.effect_functions);assert.deepEqual(work(b),work(a));};
  for(const fixture of JSON.parse(readFileSync(join(root,'tests/fixtures.json')))) {
    const outcome=compiler=>{try{return compiler(fixture.source);}catch(e){return {code:e.code,pos:e.pos,message:e.message};}};
    const a=outcome(before.compile),b=outcome(compile);
    if(a.code)assert.deepEqual(b,a);else compare(a,b);fixtureParity++;
  }
  let projectParity=0;
  for(const name of ['effects-workflow','effects-simulation','ownership-frames','array-views'])for(const entry of ['pure.tt','host.tt']){
    const provider=p=>readFileSync(join(root,'examples',name,p),'utf8');
    compare(before.compileProject(entry,provider),compileProject(entry,provider));projectParity++;
  }
  for(const job of sources()) {
    const build=c=>job.project?c.compileProject('main.tt',job.project):c.compile(job.source);
    const a=build(before),b=build(after);compare(a,b);
    // Large wrapper chains are compile-only (existing call/value depth limits).
    if(!['wrappers','refinement_relations'].includes(job.name)){ const x=execute(a.wasm),y=execute(b.wasm);assert.deepEqual(y.value,x.value);assert.equal(y.output,x.output);assert.equal(y.remaining_fuel,x.remaining_fuel); }
    const raw={before:[],after:[]},rawPhases={before:[],after:[]};
    for(let i=0;i<5;i++){build(before);build(after);}
    for(let i=0;i<21;i++)for(const label of i%2?['after','before']:['before','after']){
      const start=performance.now(),r=build(label==='before'?before:after);raw[label].push(performance.now()-start);rawPhases[label].push(phases(r));
    }
    rows.push({name:job.name,size:job.size,source_sha256:hash(job.source??JSON.stringify([...job.project])),source_bytes:job.source?Buffer.byteLength(job.source):[...job.project.values()].reduce((n,s)=>n+Buffer.byteLength(s),0),wasm_bytes:b.wasm.length,wasm_sha256:hash(b.wasm),identical_wasm:true,work:work(b),raw_ms:raw,phase_ms:rawPhases,
      median_ms:{before:median(raw.before),after:median(raw.after)},median_parse_ms:{before:median(rawPhases.before.map(r=>r.parse_ms)),after:median(rawPhases.after.map(r=>r.parse_ms))}});
    console.log(job.name,rows.at(-1).median_ms, 'parse',rows.at(-1).median_parse_ms);
  }
  const cold=[],dir=mkdtempSync(join(tmpdir(),'tt-frontend-cold-'));
  try {
    for(const name of ['records','plain_text']){
      const job=sources().find(x=>x.name===name),file=join(dir,'input.tt');writeFileSync(file,job.source);
      const raw={before:[],after:[]};
      const script=`import{readFileSync}from'node:fs';import{performance}from'node:perf_hooks';const{compile}=await import(process.argv[1]);const source=readFileSync(process.argv[2],'utf8');const start=performance.now(),r=compile(source);console.log(JSON.stringify({compile_ms:performance.now()-start,parse_ms:r.metrics.parse_ms,wasm_bytes:r.wasm.length}));`;
      for(let i=0;i<9;i++)for(const label of i%2?['after','before']:['before','after']){
        const url=pathToFileURL(join(label==='before'?baselineDirectory:join(root,'src'),'compiler.mjs')).href;
        const start=performance.now(),r=spawnSync(process.execPath,['--input-type=module','-e',script,url,file],{encoding:'utf8',timeout:30000,env:{}});
        const wall_ms=performance.now()-start;assert.equal(r.status,0,r.stderr);raw[label].push({wall_ms,...JSON.parse(r.stdout)});
      }
      cold.push({name,raw,median_wall_ms:{before:median(raw.before.map(r=>r.wall_ms)),after:median(raw.after.map(r=>r.wall_ms))},median_compile_ms:{before:median(raw.before.map(r=>r.compile_ms)),after:median(raw.after.map(r=>r.compile_ms))}});
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.deepEqual(sourceHashes(baselineDirectory),baselineHashes);assert.deepEqual(sourceHashes(join(root,'src')),currentHashes);
  return {schema:1,date:new Date().toISOString(),node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,
    node_sha256:hash(readFileSync(process.execPath)),driver_sha256:hash(readFileSync(fileURLToPath(import.meta.url))),baseline_source_sha256:baselineHashes,current_source_sha256:currentHashes,
    samples:21,warmups:5,fixture_parity:fixtureParity,project_parity:projectParity,
    boundary:'Warm full compilation: parse, shape, ownership, effects, refinement, emission, WebAssembly.validate and type display; no compiler-result cache, source generation excluded. Phases recorded separately. Cold records use fresh Node processes (9 alternating samples), wall includes startup/import/read/compile/exit. No runtime speedup is implied: artifacts are byte-identical. Node GC and scheduling noise can affect observations.',rows,cold};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4)throw new Error('usage: node benchmarks/frontend-performance.mjs BASELINE_SRC OUTPUT.json');
  const report=await benchmark(resolve(process.argv[2]));writeFileSync(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
}
