import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, display, execute, TTError } from '../src/compiler.mjs';
import { LIMITS } from '../src/core.mjs';

test('display preserves ordinary values and a maximum-size escapable Text scalar', () => {
  const value = { kind: 'Record', labels: ['x', 'items'], values: [42n, { kind: 'Array', values: [true, 'a\n"b', null] }] };
  assert.equal(display(value), '{ .x = 42; .items = [true, "a\\n\\"b", ()]; }');
  const text = '\\'.repeat(LIMITS.sourceBytes), output = display(text);
  assert.equal(Buffer.byteLength(output), 2 * LIMITS.sourceBytes + 2);
  assert.ok(output.startsWith('"\\\\') && output.endsWith('\\\\"'));
});

test('display rejects repeated shared-DAG expansion at a bounded output size', () => {
  let value = 0n;
  for (let i = 0; i < 22; i++) value = { kind: 'Array', values: [value, value] };
  assert.throws(() => display(value), e => e instanceof TTError && e.code === 'E_LIMIT' && /display limit/.test(e.message));
});

test('display accounts multibyte record labels in UTF-8 bytes', () => {
  const ordinary = { kind: 'Record', labels: ['€x'], values: [1n] };
  assert.equal(display(ordinary), '{ .€x = 1; }');
  assert.equal(Buffer.byteLength(display(ordinary)), 14);
  const label = '€'.repeat(1_300_000);
  assert.ok(Buffer.byteLength(label) <= LIMITS.sourceBytes);
  const record = { kind: 'Record', labels: [label], values: [0n] };
  const value = { kind: 'Array', values: Array(5).fill(record) };
  assert.throws(() => display(value), e => e instanceof TTError && e.code === 'E_LIMIT' && /display limit/.test(e.message));
});

test('execute reports host decode and display as separate timing stages', () => {
  const result = execute(compile('return map (fn x=>x+1) [1,2,3];').wasm);
  assert.equal(result.output, '[2, 3, 4]');
  assert.ok(Number.isFinite(result.metrics.decode_ms) && result.metrics.decode_ms >= 0);
  assert.ok(Number.isFinite(result.metrics.display_ms) && result.metrics.display_ms >= 0);
});
