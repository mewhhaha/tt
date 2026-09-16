/** Wasm loading and bounded result decoding only; no TT evaluation in JavaScript. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fail, LIMITS } from './core.mjs';
import { Errors, Tag } from './wasm-runtime.mjs';
const bad = message => fail(0, message, 'E_WASM');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Check Wasm validity and our versioned ABI. The digest checks integrity, not trust. */
export function loadWasm(input) {
  if (!(input instanceof Uint8Array) || input.length > LIMITS.artifactBytes) bad('invalid Wasm byte buffer or artifact size');
  const bytes = Buffer.from(input); let module;
  try { module = new WebAssembly.Module(bytes); } catch (e) { bad('invalid WebAssembly module: ' + e.message); }
  if (WebAssembly.Module.imports(module).length) bad('TT modules must not require host imports');
  const sections = WebAssembly.Module.customSections(module, 'tt.abi'); if (sections.length !== 1) bad('missing or duplicate tt.abi section');
  let abi; try { abi = JSON.parse(utf8.decode(sections[0])); } catch { bad('invalid tt.abi metadata'); }
  const fields = ['core_bytes', 'core_sha256', 'heap_start', 'labels', 'metadata_sha256', 'schema', 'version'];
  if (abi?.schema !== 'tt-wasm-abi' || abi.version !== 2 || Object.keys(abi).sort().join('\0') !== fields.join('\0') ||
      !Array.isArray(abi.labels) || abi.labels.length > 500_000 ||
      !abi.labels.every(x => typeof x === 'string' && x.isWellFormed() && Buffer.byteLength(x) <= LIMITS.sourceBytes) ||
      new Set(abi.labels).size !== abi.labels.length ||
      !Number.isInteger(abi.heap_start) || abi.heap_start < 16 || abi.heap_start > 32 * 1024 * 1024 || abi.heap_start % 8 !== 0 ||
      !Number.isInteger(abi.core_bytes) || abi.core_bytes < 8 || abi.core_bytes >= bytes.length ||
      !/^[0-9a-f]{64}$/.test(abi.core_sha256) || !/^[0-9a-f]{64}$/.test(abi.metadata_sha256))
    bad('unsupported or malformed TT Wasm ABI');
  const metadata = { schema: abi.schema, version: abi.version, labels: abi.labels, heap_start: abi.heap_start,
    core_bytes: abi.core_bytes, core_sha256: abi.core_sha256 };
  if (createHash('sha256').update(Buffer.from(JSON.stringify(metadata))).digest('hex') !== abi.metadata_sha256)
    bad('TT Wasm ABI metadata integrity mismatch');
  // Check the final custom section boundary, with a bounded u32 decoder.
  let at = abi.core_bytes;
  const u32 = () => { let x = 0; for (let i = 0; i < 5; i++) {
    if (at >= bytes.length) bad('truncated ABI section'); const b = bytes[at++]; if (i === 4 && b > 15) bad('invalid ABI length');
    x += (b & 127) * 2 ** (i * 7); if (!(b & 128)) return x;
  } bad('invalid ABI length'); };
  if (bytes[at++] !== 0) bad('tt.abi must be the final section');
  const size = u32(), end = at + size, len = u32();
  if (end !== bytes.length || len !== 6 || bytes.subarray(at, at + 6).toString() !== 'tt.abi') bad('invalid final ABI section');
  if (createHash('sha256').update(bytes.subarray(0, abi.core_bytes)).digest('hex') !== abi.core_sha256) bad('Wasm integrity mismatch');
  const exports = WebAssembly.Module.exports(module), required = new Map([
    ['main', 'function'], ['set_fuel', 'function'], ['error_code', 'function'], ['fuel_remaining', 'function'], ['memory', 'memory']]);
  if (exports.length !== required.size || !exports.every(e => required.get(e.name) === e.kind)) bad('incompatible Wasm exports');
  return { bytes, module, abi };
}

export function readValue(memory, pointer, abi) {
  const bytes = new Uint8Array(memory.buffer), view = new DataView(bytes.buffer); let visited = 0; const active = new Set();
  const bounds = (p, size) => { if (!Number.isInteger(p) || p < 16 || size < 0 || p + size > bytes.length) bad('invalid result memory range'); };
  const read = (p, depth) => {
    if (++visited > 1_000_000 || depth > 128) fail(0, 'result decoding limit exceeded', 'E_LIMIT');
    bounds(p, 16); if (p % 8) bad('unaligned result'); if (active.has(p)) bad('cyclic result');
    const tag = view.getUint32(p, true), len = view.getUint32(p + 4, true);
    if (tag === Tag.Unit) return null;
    if (tag === Tag.Int) { bounds(p, 24); return view.getBigInt64(p + 16, true); }
    if (tag === Tag.Bool) { const b = view.getUint32(p + 8, true); if (b > 1) bad('invalid Boolean result'); return !!b; }
    if (tag === Tag.Text) { if (len > LIMITS.sourceBytes) bad('oversized text result'); bounds(p, 16 + len);
      try { return utf8.decode(bytes.subarray(p + 16, p + 16 + len)); } catch { bad('invalid UTF-8 result'); } }
    if (tag === Tag.Closure) return { kind: 'Closure' };
    if (tag !== Tag.Record && tag !== Tag.Array) bad('unknown result tag');
    if (len > 1_000_000) bad('oversized aggregate result');
    bounds(p, 16 + len * (tag === Tag.Record ? 8 : 4)); active.add(p);
    try {
      if (tag === Tag.Array) { const values = []; for (let i = 0; i < len; i++) values.push(read(view.getUint32(p + 16 + i * 4, true), depth + 1)); return { kind: 'Array', values }; }
      const labels = [], values = [], seen = new Set();
      for (let i = 0; i < len; i++) { const label = view.getUint32(p + 16 + i * 8, true);
        if (label >= abi.labels.length || seen.has(label)) bad('invalid record label'); seen.add(label);
        labels.push(abi.labels[label]); values.push(read(view.getUint32(p + 20 + i * 8, true), depth + 1)); }
      return { kind: 'Record', labels, values };
    } finally { active.delete(p); }
  };
  return read(pointer >>> 0, 0);
}
export function display(value, depth = 0) {
  if (depth > 64) return '...';
  if (value === null) return '()';
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return '"' + value.replace(/[\n\r\t"\\]/g, c => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t', '"': '\\"', '\\': '\\\\' })[c]) + '"';
  if (value.kind === 'Closure') return '<fn>';
  if (value.kind === 'Array') return '[' + value.values.map(x => display(x, depth + 1)).join(', ') + ']';
  if (value.kind === 'Record') return '{ ' + value.values.map((x, i) => `.${value.labels[i]} = ${display(x, depth + 1)}; `).join('') + '}';
  bad('invalid decoded result');
}
export function execute(wasm, { fuel = 10_000_000 } = {}) {
  if (!Number.isSafeInteger(fuel) || fuel < 0) throw new TypeError('fuel must be a nonnegative safe integer');
  let start = performance.now(); const loaded = loadWasm(wasm); const load_ms = performance.now() - start;
  start = performance.now(); const instance = new WebAssembly.Instance(loaded.module, {}); const instantiate_ms = performance.now() - start;
  instance.exports.set_fuel(BigInt(fuel)); let pointer;
  start = performance.now();
  try { pointer = instance.exports.main(); }
  catch (e) {
    if (!(e instanceof WebAssembly.RuntimeError)) throw e;
    const error = Errors[instance.exports.error_code()];
    if (error) fail(0, error[1], error[0]); fail(0, 'unexpected Wasm trap: ' + e.message, 'E_RUNTIME');
  }
  const execute_ms = performance.now() - start;
  start = performance.now(); const value = readValue(instance.exports.memory, pointer, loaded.abi), output = display(value);
  const decode_ms = performance.now() - start;
  return { value, output, instance, module: loaded.module, metrics: { load_ms, instantiate_ms, execute_ms, decode_ms },
    remaining_fuel: instance.exports.fuel_remaining() };
}
