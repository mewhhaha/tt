import test from 'node:test';
import assert from 'node:assert/strict';
import { readValue } from '../src/wasm-host.mjs';
import { TTError } from '../src/core.mjs';

const Tag = { Unit: 0, Int: 1, Bool: 2, Text: 3, Array: 4, Record: 5, Closure: 6 };
const abi = { heap_start: 256, labels: ['x'] };
const fresh = (heapEnd = 512) => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const view = new DataView(memory.buffer);
  view.setUint32(12, heapEnd, true);
  return { memory, view };
};
const header = (view, p, tag, len = 0, aux = 0, depth = 0) => {
  view.setUint32(p, tag, true); view.setUint32(p + 4, len, true);
  view.setUint32(p + 8, aux, true); view.setUint32(p + 12, depth, true);
};
const integer = (view, p, value) => { header(view, p, Tag.Int); view.setBigInt64(p + 16, BigInt(value), true); };
const rejects = (fn, pattern) => assert.throws(fn, e => e instanceof TTError && e.code === 'E_WASM' && pattern.test(e.message));

test('closure captures are validated before a closure is exposed to the host', () => {
  const { memory, view } = fresh(304);
  header(view, 256, Tag.Closure, 1, 7, 1); view.setUint32(272, 280, true); integer(view, 280, 9);
  assert.deepEqual(readValue(memory, 256, abi), { kind: 'Closure' });
  view.setUint32(272, 304, true);
  rejects(() => readValue(memory, 256, abi), /outside live heap/);
});

test('closure capture cycles are rejected even though closures are opaque host values', () => {
  const { memory, view } = fresh(280);
  header(view, 256, Tag.Closure, 1, 7, 1); view.setUint32(272, 256, true);
  rejects(() => readValue(memory, 256, abi), /cyclic result/);
});

test('aggregate nesting metadata must match the recursively decoded graph', () => {
  const { memory, view } = fresh(304);
  header(view, 256, Tag.Array, 1, 0, 0); view.setUint32(272, 280, true); integer(view, 280, 1);
  rejects(() => readValue(memory, 256, abi), /nesting metadata/);
  view.setUint32(268, 1, true);
  assert.deepEqual(readValue(memory, 256, abi), { kind: 'Array', values: [1n] });
});

test('scalar lengths and aggregate reserved header fields are validated', () => {
  const { memory, view } = fresh(296);
  integer(view, 256, 4); view.setUint32(260, 1, true);
  rejects(() => readValue(memory, 256, abi), /Int result header/);
  header(view, 280, Tag.Array, 0, 1, 0);
  rejects(() => readValue(memory, 280, abi), /aggregate result header/);
});

test('aligned interior pointers cannot masquerade as boxed allocation starts', () => {
  const { memory, view } = fresh(280);
  integer(view, 256, 4);
  // The old decoder interpreted the zeroed aux/depth words at +8 as a Unit header.
  rejects(() => readValue(memory, 264, abi), /allocation start/);
  assert.equal(readValue(memory, 256, abi), 4n);
});

test('static pool pointers must also be actual allocation starts', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 }), view = new DataView(memory.buffer);
  const staticAbi = { heap_start: 40, labels: [] };
  integer(view, 16, 7);
  rejects(() => readValue(memory, 24, staticAbi), /allocation start/);
  assert.equal(readValue(memory, 16, staticAbi), 7n);
});

test('allocation-start validation is lazy beyond the reachable result graph', () => {
  const { memory, view } = fresh(296);
  integer(view, 256, 5); header(view, 280, 99);
  assert.equal(readValue(memory, 256, abi), 5n, 'unreachable later allocation bytes are not decoded');
});

test('static heap metadata must fit the instantiated linear memory', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  rejects(() => readValue(memory, 16, { heap_start: 2 * 65536, labels: [] }), /static heap boundary/);
});
