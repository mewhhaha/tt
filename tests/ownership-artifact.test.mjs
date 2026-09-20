import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compile, loadWasm, execute } from '../src/compiler.mjs';
import { Bytes, uleb } from '../src/wasm-binary.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function sections(bytes){let at=8;const out=[];const u=()=>{let n=0;for(let i=0;i<5;i++){const b=bytes[at++];n+=(b&127)*2**(7*i);if(!(b&128))return n;}throw new Error('bad LEB');};while(at<bytes.length){const start=at,id=bytes[at++],length=u(),end=at+length;let name='',body=at;if(id===0){const n=u();name=bytes.subarray(at,at+n).toString();body=at+n;}out.push({name,body:bytes.subarray(body,end),bytes:bytes.subarray(start,end)});at=end;}return out;}
function custom(name,value){const body=new Bytes().name(name).add(Buffer.from(JSON.stringify(value))).finish();return{name,body:Buffer.from(JSON.stringify(value)),bytes:Buffer.concat([Buffer.from([0,...uleb(body.length)]),body])};}
function rewrite(bytes,transform){const {abi}=loadWasm(bytes);const body=sections(bytes).filter(s=>s.name!=='tt.abi');const core=Buffer.concat([bytes.subarray(0,8),...transform(body).map(s=>s.bytes)]);const next={schema:abi.schema,version:abi.version,labels:abi.labels,heap_start:abi.heap_start,core_bytes:core.length,core_sha256:hash(core)};next.metadata_sha256=hash(JSON.stringify(next));const out=Buffer.concat([core,custom('tt.abi',next).bytes]);assert.ok(WebAssembly.validate(out));return out;}
const sample=()=>compile('let a=@own 42;return @take (@move a);').wasm;
const reject=bytes=>assert.throws(()=>loadWasm(bytes),e=>e.code==='E_WASM');
test('owned storage metadata and export set form an explicit artifact boundary',()=>{
  const wasm=sample(),loaded=loadWasm(wasm);assert.equal(loaded.ownership.version,1);assert.equal(loaded.abi.version,2);
  assert.equal(loaded.ownership.arena_start%65536,0);assert.equal(loaded.ownership.arena_limit,64*1024*1024);
  assert.equal(execute(wasm).value,42n);
  reject(rewrite(wasm,ss=>ss.filter(s=>s.name!=='tt.ownership')));
  reject(rewrite(wasm,ss=>[...ss,ss.find(s=>s.name==='tt.ownership')]));
});
test('malformed ownership contracts reject even with a recomputed integrity digest',()=>{
  for(const change of [x=>{x.version=2;},x=>{x.arena_start=0;},x=>{x.arena_start++;},x=>{x.arena_start=x.arena_limit;},x=>{x.arena_limit++;},x=>{x.extra=1;}]){
    const changed=rewrite(sample(),ss=>ss.map(s=>{if(s.name!=='tt.ownership')return s;const value=JSON.parse(s.body);change(value);return custom(s.name,value);}));reject(changed);
  }
});
test('pure old ABI modules have no ownership extension or new machine exports',()=>{
  const wasm=compile('return 42;').wasm,loaded=loadWasm(wasm);assert.equal(loaded.ownership,null);
  assert.deepEqual(WebAssembly.Module.exports(loaded.module).map(e=>e.name),['main','set_fuel','error_code','fuel_remaining','memory']);
  assert.equal(execute(wasm).value,42n);assert.equal(Object.hasOwn(execute(wasm).metrics,'owned_live_bytes'),false);
});
test('ordinary movement and delimiter-like identifiers remain ordinary bindings',()=>{
  const source='let move=fn x=>x;let own=fn x=>x;let as=40;let by=2;return own (move as)+by;';
  assert.equal(execute(compile(source).wasm).value,42n);
});
