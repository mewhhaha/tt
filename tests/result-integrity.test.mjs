import test from 'node:test';
import assert from 'node:assert/strict';
import { readValue } from '../src/wasm-host.mjs';
import { TTError } from '../src/core.mjs';

const Tag = { Unit: 0, Int: 1, Bool: 2, Text: 3, Array: 4, Record: 5, Closure: 6 };
const abi = { heap_start: 256, labels: ['x'] };
const fresh = () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const view = new DataView(memory.buffer);
  view.setUint32(12, 512, true);
  return { memory, view };
};
const header = (view, p, tag, len = 0, aux = 0, depth = 0) => {
  view.setUint32(p, tag, true); view.setUint32(p + 4, len, true);
  view.setUint32(p + 8, aux, true); view.setUint32(p + 12, depth, true);
};
const integer = (view, p, value) => { header(view, p, Tag.Int); view.setBigInt64(p + 16, BigInt(value), true); };
const rejects = (fn, pattern) => assert.throws(fn, e => e instanceof TTError && e.code === 'E_WASM' && pattern.test(e.message));

test('closure captures are validated before a closure is exposed to the host', () => {
  const { memory, view } = fresh();
  header(view, 256, Tag.Closure, 1, 7, 1); view.setUint32(272, 320, true); integer(view, 320, 9);
  assert.deepEqual(readValue(memory, 256, abi), { kind: 'Closure' });
  view.setUint32(272, 512, true);
  rejects(() => readValue(memory, 256, abi), /outside live heap/);
});

test('closure capture cycles are rejected even though closures are opaque host values', () => {
  const { memory, view } = fresh();
  header(view, 256, Tag.Closure, 1, 7, 1); view.setUint32(272, 256, true);
  rejects(() => readValue(memory, 256, abi), /cyclic result/);
});

test('aggregate nesting metadata must match the recursively decoded graph', () => {
  const { memory, view } = fresh();
  header(view, 256, Tag.Array, 1, 0, 0); view.setUint32(272, 320, true); integer(view, 320, 1);
  rejects(() => readValue(memory, 256, abi), /nesting metadata/);
  view.setUint32(268, 1, true);
  assert.deepEqual(readValue(memory, 256, abi), { kind: 'Array', values: [1n] });
});

test('scalar lengths and aggregate reserved header fields are validated', () => {
  const { memory, view } = fresh();
  integer(view, 256, 4); view.setUint32(260, 1, true);
  rejects(() => readValue(memory, 256, abi), /Int result header/);
  header(view, 320, Tag.Array, 0, 1, 0);
  rejects(() => readValue(memory, 320, abi), /aggregate result header/);
});
