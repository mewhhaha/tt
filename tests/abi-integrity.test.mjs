import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compile, loadWasm, TTError } from '../src/compiler.mjs';
import { Bytes, uleb } from '../src/wasm-binary.mjs';

const rejects = (fn, message) => assert.throws(fn,
  e => e instanceof TTError && e.code === 'E_WASM' && (!message || message.test(e.message)));

const metadata = abi => ({ schema: abi.schema, version: abi.version, labels: abi.labels,
  heap_start: abi.heap_start, core_bytes: abi.core_bytes, core_sha256: abi.core_sha256 });
const rehash = abi => { abi.metadata_sha256 = createHash('sha256').update(Buffer.from(JSON.stringify(metadata(abi)))).digest('hex'); };
const rewriteAbi = (wasm, mutate, validDigest = false) => {
  const { abi } = loadWasm(wasm), changed = structuredClone(abi); mutate(changed); if (validDigest) rehash(changed);
  const custom = new Bytes().name('tt.abi').add(Buffer.from(JSON.stringify(changed))).finish();
  return Buffer.concat([Buffer.from(wasm).subarray(0, abi.core_bytes), Buffer.from([0, ...uleb(custom.length)]), custom]);
};

test('ABI v2 detects structurally valid metadata corruption outside the Wasm core digest', () => {
  const wasm = compile('return { .alpha=1; .bravo=2; };').wasm, { abi } = loadWasm(wasm);
  assert.equal(abi.version, 2); assert.match(abi.metadata_sha256, /^[0-9a-f]{64}$/);
  const altered = rewriteAbi(wasm, x => { x.labels[0] = 'omega'; });
  assert.equal(WebAssembly.validate(altered), true);
  rejects(() => loadWasm(altered), /metadata integrity/);
});

test('ABI v2 rejects duplicate symbol names and unaligned static heap metadata even with a recomputed metadata digest', () => {
  const wasm = compile('return { .alpha=1; .bravo=2; };').wasm;
  const duplicate = rewriteAbi(wasm, x => { x.labels[1] = x.labels[0]; }, true);
  assert.equal(WebAssembly.validate(duplicate), true); rejects(() => loadWasm(duplicate), /malformed TT Wasm ABI/);
  const unaligned = rewriteAbi(wasm, x => { x.heap_start += 1; }, true);
  assert.equal(WebAssembly.validate(unaligned), true); rejects(() => loadWasm(unaligned), /malformed TT Wasm ABI/);
});

test('ABI version and field set are explicit compatibility boundaries', () => {
  const wasm = compile('return 42;').wasm;
  const oldVersion = rewriteAbi(wasm, x => { x.version = 1; }, true);
  rejects(() => loadWasm(oldVersion), /malformed TT Wasm ABI/);
  const extraField = rewriteAbi(wasm, x => { x.future = true; }, true);
  rejects(() => loadWasm(extraField), /malformed TT Wasm ABI/);
});
