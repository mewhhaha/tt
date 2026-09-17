import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, execute, loadWasm, TTError } from '../src/compiler.mjs';

const machine=wasm=>{const {module}=loadWasm(wasm);return new WebAssembly.Instance(module,{}).exports;};
function step(e,fuel) {
  e.set_fuel(BigInt(fuel));let value=null,trap=false;
  try{value=e.main();}catch(error){assert.ok(error instanceof WebAssembly.RuntimeError);trap=true;}
  return{value,trap,fuel:e.fuel_remaining(),error:e.error_code(),memory:Buffer.from(e.memory.buffer)};
}

test('bulk concat preserves every low-fuel trap, remaining fuel and partial memory write', () => {
  for(const source of [
    'return concat "abc" "defgh";',
    'return concat "" "";',
    'return concat "é🙂" "界";',
    'return concat (concat "hello" "world") "tail";',
  ]){
    const before=compile(source,{optimize:false}).wasm,after=compile(source).wasm;
    for(let fuel=0;fuel<100;fuel++)assert.deepEqual(step(machine(after),fuel),step(machine(before),fuel),`${fuel} ${source}`);
    assert.equal(execute(after).output,execute(before).output);
  }
});

test('bulk concat handles growth, aliasing of source strings, captures and saved artifacts', () => {
  const text='é🙂'.repeat(10000),source=`let text="${text}";let f=fn x=>concat text x;return f text;`;
  const a=execute(compile(source,{optimize:false}).wasm),b=execute(Buffer.from(compile(source).wasm));
  assert.equal(b.value,text+text);assert.equal(b.output,a.output);
  assert.equal(b.remaining_fuel,a.remaining_fuel);assert.equal(b.metrics.heap_bytes,a.metrics.heap_bytes);
});

test('concat preserves effect order and never executes host calls speculatively', () => {
  const source='effect Emit :: Text -> Unit;let emit=host Emit;return do{let before=emit "before";let text=concat "abcdefgh" "ijklmnop";let after=emit text;return text;};';
  for(let fuel=0;fuel<80;fuel++){
    const run=optimize=>{const log=[];let code=null;try{execute(compile(source,{optimize}).wasm,{fuel,host:new Map([['main.tt::Emit',text=>{log.push(text);}]])});}catch(e){assert.ok(e instanceof TTError);code=e.code;}return{log,code};};
    assert.deepEqual(run(true),run(false));
  }
});
