#!/usr/bin/env node
/** Matched, offline baseline comparison. No compiler/runtime work is delegated to CI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as current from '../src/compiler.mjs';
import { workload } from './run.mjs';
import { repeatedCalls, diamondModules } from './modules-effects.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary = raw => ({ median_ms:median(raw), raw_ms:raw });
const sources = directory => Object.fromEntries(readdirSync(directory).filter(n=>n.endsWith('.mjs')).sort()
  .map(n=>[n,sha(readFileSync(join(directory,n)))]));
const phases = metrics => Object.fromEntries(Object.entries(metrics).filter(([n])=>n.endsWith('_ms')));
const work = metrics => Object.fromEntries(Object.entries(metrics).filter(([n])=>!n.endsWith('_ms')));
const samples = 11, warmups = 5;
export function numericSource(n, simple = false, effects = false) {
  const values=Array.from({length:n},(_,i)=>i%97).join(',');
  const expression=simple?'x+1':'((x*3+7)/2-1)*5+x*2-9';
  return (effects?'effect Bias :: Unit -> Int;':'')+
    `let input=[${values}];`+(effects?'return handle Bias with (fn u=>7) in ':'return ')+
    `fold (fn sum=>fn x=>sum+x) 0 (map (fn x=>${effects?'(('+expression+')+Bias ())*2':expression}) input);`;
}
export async function benchmark(baselineDirectory) {
  const old=await import(pathToFileURL(join(baselineDirectory,'compiler.mjs')));
  const beforeSources=sources(baselineDirectory),afterSources=sources(resolve(root,'src'));
  for(const name of Object.keys(beforeSources)) if(!['compiler.mjs','wasm.mjs','wasm-runtime.mjs','wasm-binary.mjs'].includes(name))
    assert.equal(beforeSources[name],afterSources[name],`unmatched source ${name}`);
  const fixtures=JSON.parse(readFileSync(resolve(root,'tests/fixtures.json'),'utf8'));
  let byteParity=0;
  for(const entry of fixtures) if(entry.outcome==='accept') {
    assert.deepEqual(current.compile(entry.source,{optimize:false}).wasm,old.compile(entry.source).wasm);
    byteParity++;
  }
  const compileReports=[];
  const inputs=[...['wrappers','records','polymorphism','refinements','refinement_relations'].map(name=>({name,size:2000,source:workload(name,2000)})),
    {name:'effect-calls',size:2000,source:repeatedCalls(2000)},
    {name:'module-diamond',size:128,project:diamondModules(128)},
    {name:'numeric-collections',size:5000,source:numericSource(5000)},
  ];
  for(const item of inputs) {
    const build=api=>item.project?api.compileProject('main.tt',item.project):api.compile(item.source);
    const sourceHash=sha(item.project?JSON.stringify([...item.project]):item.source);
    const reference=build(old),changed=build(current);
    assert.equal(reference.type,changed.type);assert.deepEqual(reference.effects,changed.effects);
    for(const key of ['unify_steps','proof_steps','effect_steps','refinement_substitutions'])assert.equal(reference.metrics[key],changed.metrics[key]);
    for(let i=0;i<warmups;i++){build(old);build(current);}
    const raw={before:[],after:[]},timings={before:[],after:[]};
    for(let i=0;i<samples;i++)for(const side of i%2?['after','before']:['before','after']) {
      const start=performance.now(),result=build(side==='before'?old:current);
      raw[side].push(performance.now()-start);timings[side].push(phases(result.metrics));
      assert.equal(result.type,reference.type);
    }
    compileReports.push({name:item.name,size:item.size,source_sha256:sourceHash,
      before:summary(raw.before),after:summary(raw.after),phase_ms:timings,
      work:{before:work(reference.metrics),after:work(changed.metrics)}});
  }
  const runtimeReports=[];
  for(const [name,source,calls]of[
    ['numeric-map-fold-1000',numericSource(1000),100],
    ['numeric-map-fold-5000',numericSource(5000),100],
    ['simple-map-fold-control',numericSource(5000,true),100],
    ['pure-effect-numeric-2000',numericSource(2000,false,true),100],
    ['large-text-concat','let t="'+('é🙂'.repeat(16000))+'";return concat t t;',20],
  ]){
    const builds={before:old.compile(source),after:current.compile(source)},state={},measure={};
    for(const side of ['before','after']) {
      const bytes=builds[side].wasm;let start=performance.now();assert.ok(WebAssembly.validate(bytes));const validate_ms=performance.now()-start;
      start=performance.now();const module=new WebAssembly.Module(bytes);const module_ms=performance.now()-start;
      start=performance.now();const instance=new WebAssembly.Instance(module,{});const instantiate_ms=performance.now()-start;
      const checked=current.execute(bytes);state[side]=instance.exports;
      for(let i=0;i<20;i++)instance.exports.main();
      measure[side]={validate_ms,module_ms,instantiate_ms,wasm_bytes:bytes.length,wasm_sha256:sha(bytes),
        heap_bytes:checked.metrics.heap_bytes,remaining_fuel:String(checked.remaining_fuel),
        output_sha256:sha(checked.output),execute:[],decode:[],display:[]};
    }
    assert.equal(measure.before.output_sha256,measure.after.output_sha256);
    assert.equal(measure.before.remaining_fuel,measure.after.remaining_fuel);
    for(let i=0;i<samples;i++)for(const side of i%2?['after','before']:['before','after']){
      const exports=state[side],m=measure[side],abi=current.loadWasm(builds[side].wasm).abi;
      let pointer,start=performance.now();for(let call=0;call<calls;call++)pointer=exports.main();
      m.execute.push((performance.now()-start)/calls);
      start=performance.now();const value=current.readValue(exports.memory,pointer,abi);m.decode.push(performance.now()-start);
      start=performance.now();const output=current.display(value);m.display.push(performance.now()-start);
      assert.equal(sha(output),m.output_sha256);
    }
    for(const m of Object.values(measure))for(const phase of ['execute','decode','display'])m[phase]=summary(m[phase]);
    runtimeReports.push({name,calls_per_sample:calls,source_sha256:sha(source),...measure});
  }
  const cold={before:[],after:[]},dir=mkdtempSync(join(tmpdir(),'tt-cold-'));
  try{
    const source=workload('records',2000),input=join(dir,'sample.tt');writeFileSync(input,source);
    const script="import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';const{compile}=await import(pathToFileURL(process.argv[1]));const source=readFileSync(process.argv[2],'utf8');const start=performance.now();const c=compile(source);console.log(JSON.stringify({compile_ms:performance.now()-start,...c.metrics}));";
    for(let i=0;i<5;i++)for(const side of i%2?['after','before']:['before','after']){
      const file=side==='before'?join(baselineDirectory,'compiler.mjs'):resolve(root,'src/compiler.mjs');
      const start=performance.now(),result=spawnSync(process.execPath,['--input-type=module','-e',script,file,input],{encoding:'utf8',timeout:10000,env:{}});
      const wall_ms=performance.now()-start;assert.equal(result.status,0,result.stderr);cold[side].push({wall_ms,...JSON.parse(result.stdout)});
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.deepEqual(sources(baselineDirectory),beforeSources);assert.deepEqual(sources(resolve(root,'src')),afterSources);
  return{schema:1,date:new Date().toISOString(),baseline_commit:'5e6a9b82c946f31f27fd742f624796da117246c3',
    node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,
    node_sha256:sha(readFileSync(process.execPath)),harness_sha256:sha(readFileSync(fileURLToPath(import.meta.url))),
    sources:{before:beforeSources,after:afterSources},samples,warmups,accepted_fixture_byte_parity:byteParity,
    boundaries:{compile:'Warm parse/type/effects/refinements/emission/validation/type display; excludes source generation and startup. No result cache.',
      runtime:'Compiled modules, 20 main warmups, repeated same-instance main execution; host decode/display outside timed execute loops. Module constructor samples may be engine-cached, not cold-compilation claims.',
      cold:'New Node process for each run; wall_ms includes process startup/import/file read/compile/exit; compile_ms excludes setup. Five alternating samples.',
      memory:'heap_bytes is successful per-main dynamic bump allocation; not RSS, peak memory, or GC live set.',
      compatibility:'Arithmetic boxes removed at internal edges: allocation exhaustion and raw pointer identities can differ. No reassociation, fuel/call skipping or integer wrapping. Concatenation partial-memory/fuel behavior is differential-tested.'},
    claims:'Matched local workload observations, not production qualification, cross-engine claims or whole-compiler complexity guarantees.',
    compile:compileReports,runtime:runtimeReports,cold};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4)throw new Error('usage: node benchmarks/numeric-performance.mjs BASELINE_SRC OUTPUT.json');
  const report=await benchmark(resolve(process.argv[2]));writeFileSync(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
  for(const r of report.compile)console.log(`compile ${r.name}/${r.size}: ${r.before.median_ms.toFixed(3)} -> ${r.after.median_ms.toFixed(3)} ms`);
  for(const r of report.runtime)console.log(`runtime ${r.name}: ${r.before.execute.median_ms.toFixed(3)} -> ${r.after.execute.median_ms.toFixed(3)} ms; heap ${r.before.heap_bytes} -> ${r.after.heap_bytes}`);
}
