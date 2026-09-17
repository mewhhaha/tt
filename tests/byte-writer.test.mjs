import test from 'node:test';
import assert from 'node:assert/strict';
import { Bytes, uleb, sleb, WasmModule, I64 } from '../src/wasm-binary.mjs';
import { LIMITS, TTError } from '../src/core.mjs';

test('direct integer encoders are byte-identical to reference LEB across boundaries', () => {
  const values=[0,1,63,64,127,128,255,16383,16384,2147483647,2147483648,4294967295];
  let seed=97;for(let i=0;i<4000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;values.push(seed);}
  for(const v of values){assert.deepEqual([...new Bytes().u(v).finish()],uleb(v));for(const n of [v,-v])assert.deepEqual([...new Bytes().s(n).finish()],sleb(n));}
  for(const v of [-(1n<<63n),(1n<<63n)-1n,-(1n<<100n),1n<<100n,BigInt(Number.MAX_SAFE_INTEGER)])
    assert.deepEqual([...new Bytes().s(v).finish()],sleb(v));
  for(const v of [-1,1.2,NaN,Infinity,4294967296])assert.throws(()=>new Bytes().u(v),RangeError);
});

test('writer growth respects subarray offsets and does not expose capacity or mutable snapshots', () => {
  const b=new Bytes(),expected=[];
  for(let i=0;i<500;i++){
    const input=Uint8Array.from([11,i&255,12]);b.add(99,input.subarray(1,2),[98,97]);expected.push(99,i&255,98,97);
  }
  assert.deepEqual([...b.finish()],expected);
  const snapshot=b.finish();b.add(Buffer.alloc(5000,44));assert.deepEqual([...snapshot],expected);
  const current=b.finish();current[0]=0;assert.equal(b.finish()[0],99);
  assert.equal(b.length,expected.length+5000);assert.equal(b.finish().length,b.length);
});

test('writer bounds oversized requests before allocation', () => {
  assert.throws(()=>new Bytes().reserve(LIMITS.artifactBytes+1),e=>e instanceof TTError&&e.code==='E_LIMIT');
  const m=new WasmModule(),f=m.func('answer',[],[I64]);f.i64(-(1n<<63n));m.export('answer',0,f.index);
  const bytes=m.finish(Buffer.alloc(16),16,[]);assert.ok(WebAssembly.validate(bytes));
  assert.equal(new WebAssembly.Instance(new WebAssembly.Module(bytes),{}).exports.answer(),-(1n<<63n));
});
