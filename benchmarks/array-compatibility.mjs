/** Matched legacy-program compilation. Supply the prior ownership snapshot's src directory. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as current from '../src/compiler.mjs';
import { workload } from './run.mjs';
import { repeatedCalls, diamondModules } from './modules-effects.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const median=values=>values.toSorted((a,b)=>a-b)[values.length>>1];
const hashes=directory=>Object.fromEntries(readdirSync(directory).filter(p=>p.endsWith('.mjs')).sort()
  .map(p=>[p,sha(readFileSync(resolve(directory,p)))]));
export async function benchmark(baselineSource){
  const baselineHashes=hashes(baselineSource),currentHashes=hashes(resolve(root,'src'));
  const baseline=await import(pathToFileURL(resolve(baselineSource,'compiler.mjs')));
  const fixtures=JSON.parse(readFileSync(resolve(root,'tests/fixtures.json'),'utf8')).filter(f=>f.outcome==='accept');
  let byteParity=0;
  const same=(source,options)=>{assert.deepEqual(current.compile(source,options).wasm,baseline.compile(source,options).wasm);byteParity++;};
  for(const f of fixtures)for(const optimize of [false,true])same(f.source,{optimize});
  for(const source of [
    'let a=@own [1,2];return @take (@move a);',
    'let a=@own {.x=1;.y=[2,3];};let b=@snapshot a;return @take (@move b);',
    'let a=@own [1,2];return @borrow a as v in get v 0;',
    'let a=@own 0;let b=@evolve (@move a) by 10 with(fn x=>x+1);return @take (@move b);',
  ])for(const optimize of [false,true])same(source,{optimize});
  for(const folder of ['effects-workflow','effects-simulation','ownership-frames'])for(const entry of ['pure.tt','host.tt']){
    const sources=name=>readFileSync(resolve(root,'examples',folder,name),'utf8');
    assert.deepEqual(current.compileProject(entry,sources).wasm,baseline.compileProject(entry,sources).wasm);byteParity++;
  }
  const rows=[];
  for(const [name,source] of [
    ['records-2000',workload('records',2000)],['polymorphism-2000',workload('polymorphism',2000)],
    ['effects-1000',repeatedCalls(1000)],['modules-64',diamondModules(64)],
  ]){
    const run=c=>source instanceof Map?c.compileProject('main.tt',source):c.compile(source);
    assert.deepEqual(run(current).wasm,run(baseline).wasm);
    for(let i=0;i<5;i++){run(baseline);run(current);}
    const raw={before:[],after:[]},phases={before:[],after:[]};
    for(let i=0;i<11;i++)for(const label of i%2?['after','before']:['before','after']){
      const t=performance.now(),compiled=run(label==='before'?baseline:current);
      raw[label].push(performance.now()-t);
      phases[label].push(Object.fromEntries(Object.entries(compiled.metrics).filter(([k])=>k.endsWith('_ms'))));
    }
    rows.push({name,source_sha256:sha(source instanceof Map?JSON.stringify([...source]):source),
      raw_ms:raw,phases,median_ms:{before:median(raw.before),after:median(raw.after)}});
  }
  assert.deepEqual(hashes(baselineSource),baselineHashes);assert.deepEqual(hashes(resolve(root,'src')),currentHashes);
  return {schema:1,recorded_at:new Date().toISOString(),node:process.version,v8:process.versions.v8,
    platform:process.platform,arch:process.arch,node_sha256:sha(readFileSync(process.execPath)),
    harness_sha256:sha(readFileSync(fileURLToPath(import.meta.url))),baseline_source_sha256:baselineHashes,
    current_source_sha256:currentHashes,byte_parity_comparisons:byteParity,samples:11,warmups:5,
    boundary:'Warm in-process complete compilation: parsing, checking, ownership/effects/refinements, emission, validation and type display; generation/loading/startup excluded. Same old programs, no result cache, alternating implementations. Incidental GC is included; local single-process observations, not universal no-overhead guarantees.',rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==4)throw new Error('usage: node benchmarks/array-compatibility.mjs BASELINE_SRC OUTPUT.json');
    const report=await benchmark(resolve(process.argv[2]));writeFileSync(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
    console.log('Old-program byte-parity comparisons:',report.byte_parity_comparisons);
    for(const r of report.rows)console.log(`${r.name}: ${r.median_ms.before.toFixed(3)} -> ${r.median_ms.after.toFixed(3)} ms`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
