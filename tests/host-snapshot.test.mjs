import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, execute, loadWasm, readValue } from '../src/compiler.mjs';

test('execute returns deeply immutable detached aggregate snapshots', () => {
  const result = execute(compile('return [{.x=1;.items=[2,3];},{.x=4;.items=[5,6];}];').wasm);
  assert.equal(result.output, '[{ .x = 1; .items = [2, 3]; }, { .x = 4; .items = [5, 6]; }]');
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.metrics));
  assert.ok(Object.isFrozen(result.value)); assert.ok(Object.isFrozen(result.value.values));
  const record = result.value.values[0];
  assert.ok(Object.isFrozen(record)); assert.ok(Object.isFrozen(record.labels)); assert.ok(Object.isFrozen(record.values));
  const nested = record.values[1]; assert.ok(Object.isFrozen(nested)); assert.ok(Object.isFrozen(nested.values));
  assert.throws(() => nested.values.push(9n), TypeError);
  assert.throws(() => { record.labels[0] = 'forged'; }, TypeError);
  assert.throws(() => { result.value.values[0] = null; }, TypeError);
});

test('execute does not expose a live Wasm instance or memory authority', () => {
  const result = execute(compile('return 1+2;').wasm);
  assert.equal(result.value, 3n);
  assert.equal(Object.hasOwn(result, 'instance'), false);
  assert.equal(Object.hasOwn(result, 'memory'), false);
  assert.ok(result.module instanceof WebAssembly.Module);
});

test('returned closures are frozen opaque descriptors without pointer or callable authority', () => {
  const result = execute(compile('let make=fn x=>fn y=>x+y; return make 40;').wasm);
  assert.equal(result.output, '<fn>'); assert.ok(Object.isFrozen(result.value));
  assert.deepEqual(Object.keys(result.value), ['kind']); assert.equal(result.value.kind, 'Closure');
  for (const key of ['pointer', 'address', 'index', 'captures', 'instance', 'memory', 'call']) assert.equal(Object.hasOwn(result.value, key), false);
  assert.notEqual(typeof result.value, 'function');
});

test('decoded snapshots remain unchanged after the underlying Wasm memory is overwritten', () => {
  const wasm = compile('return [{.x=40;}, {.x=2;}];').wasm;
  const { module, abi } = loadWasm(wasm), instance = new WebAssembly.Instance(module, {});
  const pointer = instance.exports.main(), snapshot = readValue(instance.exports.memory, pointer, abi);
  assert.equal(snapshot.values[0].values[0], 40n); assert.ok(Object.isFrozen(snapshot));
  new Uint8Array(instance.exports.memory.buffer).fill(0);
  assert.equal(snapshot.values[0].values[0], 40n); assert.equal(snapshot.values[1].values[0], 2n);
  assert.throws(() => snapshot.values.pop(), TypeError);
});
