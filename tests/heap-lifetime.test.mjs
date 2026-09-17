import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, execute, loadWasm, readValue, TTError } from '../src/compiler.mjs';

const rejectsWasm = (fn, message) => assert.throws(fn, e => e instanceof TTError && e.code === 'E_WASM' && message.test(e.message));

test('decoder rejects pointers beyond the current run live heap', () => {
  const bytes = compile('return [1];').wasm;
  const { module, abi } = loadWasm(bytes), instance = new WebAssembly.Instance(module, {});
  const pointer = instance.exports.main(), view = new DataView(instance.exports.memory.buffer);
  const heapEnd = view.getUint32(12, true);
  assert.ok(heapEnd > abi.heap_start); assert.equal(heapEnd % 8, 0);
  assert.ok(heapEnd < instance.exports.memory.buffer.byteLength, 'test needs unused grown-page tail');
  view.setUint32(pointer + 16, heapEnd, true);
  rejectsWasm(() => readValue(instance.exports.memory, pointer, abi), /outside live heap/);
});

test('decoder rejects values that straddle the static/dynamic heap boundary', () => {
  const bytes = compile('return 1;').wasm;
  const { module, abi } = loadWasm(bytes), instance = new WebAssembly.Instance(module, {});
  instance.exports.main(); assert.ok(abi.heap_start >= 24 && abi.heap_start % 8 === 0);
  rejectsWasm(() => readValue(instance.exports.memory, abi.heap_start - 8, abi), /static heap boundary/);
});

test('live heap watermark belongs to one successful main invocation', () => {
  const bytes = compile('return 1+2;').wasm;
  const { module, abi } = loadWasm(bytes), instance = new WebAssembly.Instance(module, {}), view = new DataView(instance.exports.memory.buffer);
  instance.exports.set_fuel(1000n); instance.exports.main();
  const first = view.getUint32(12, true); assert.ok(first > abi.heap_start);
  instance.exports.set_fuel(0n); assert.throws(() => instance.exports.main(), WebAssembly.RuntimeError);
  assert.equal(view.getUint32(12, true), 0, 'failed run must not advertise the prior allocation lifetime');
  instance.exports.set_fuel(1000n); instance.exports.main(); assert.equal(view.getUint32(12, true), first);
});

test('execute reports dynamic heap bytes separately from memory capacity', () => {
  assert.equal(execute(compile('return 1;').wasm).metrics.heap_bytes, 0);
  const dynamic = execute(compile('return 1+2;').wasm);
  assert.ok(dynamic.metrics.heap_bytes > 0); assert.equal(dynamic.metrics.heap_bytes % 8, 0);
  assert.ok(dynamic.metrics.heap_bytes < dynamic.instance.exports.memory.buffer.byteLength);
});
