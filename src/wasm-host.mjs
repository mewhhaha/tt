/** Wasm loading and bounded result decoding only; no TT evaluation in JavaScript. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fail, LIMITS, TTError } from './core.mjs';
import { Errors, Tag } from './wasm-runtime.mjs';
const bad = message => fail(0, message, 'E_WASM');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function parseSource(module) {
  const sections = WebAssembly.Module.customSections(module, 'tt.source');
  if (sections.length > 1) bad('duplicate tt.source section'); if (!sections.length) return null;
  const bytes = Buffer.from(sections[0]); let at = 0;
  const u32 = () => { if (at + 4 > bytes.length) bad('truncated tt.source metadata'); const x = bytes.readUInt32LE(at); at += 4; return x; };
  if (bytes.length < 45 || bytes[at++] !== 1) bad('unsupported tt.source metadata');
  const units = u32(); if (units > LIMITS.sourceBytes) bad('invalid tt.source length');
  if (at + 32 > bytes.length) bad('truncated tt.source metadata'); const sha256 = bytes.subarray(at, at + 32).toString('hex'); at += 32;
  const nameLength = u32(); if (nameLength > 4096 || at + nameLength > bytes.length) bad('invalid tt.source name');
  let name; try { name = utf8.decode(bytes.subarray(at, at + nameLength)); } catch { bad('invalid tt.source name'); } at += nameLength;
  if (!name.isWellFormed() || /[\u0000-\u001f\u007f]/.test(name)) bad('invalid tt.source name');
  const lines = u32(); if (!lines || lines > units + 1 || at + lines * 4 !== bytes.length) bad('invalid tt.source line table');
  const starts = bytes.subarray(at); let previous = -1;
  for (let i = 0; i < lines; i++) { const start = starts.readUInt32LE(i * 4); if ((i === 0 && start !== 0) || start <= previous || start > units) bad('invalid tt.source line table'); previous = start; }
  return { name, sha256, units, lines, starts };
}
function sourceLocation(source, pos) {
  if (!source || !Number.isInteger(pos) || pos < 0 || pos > source.units) return null;
  let lo = 0, hi = source.lines;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (source.starts.readUInt32LE(mid * 4) <= pos) lo = mid; else hi = mid; }
  const start = source.starts.readUInt32LE(lo * 4); return { name: source.name, sha256: source.sha256, line: lo + 1, column: pos - start + 1 };
}
/** Check Wasm validity and our versioned ABI. The digest checks integrity, not trust. */
export function loadWasm(input) {
  if (!(input instanceof Uint8Array) || input.length > LIMITS.artifactBytes) bad('invalid Wasm byte buffer or artifact size');
  const bytes = Buffer.from(input); let module; try { module = new WebAssembly.Module(bytes); } catch (e) { bad('invalid WebAssembly module: ' + e.message); }
  if (WebAssembly.Module.imports(module).length) bad('TT modules must not require host imports');
  const sections = WebAssembly.Module.customSections(module, 'tt.abi'); if (sections.length !== 1) bad('missing or duplicate tt.abi section');
  let abi; try { abi = JSON.parse(utf8.decode(sections[0])); } catch { bad('invalid tt.abi metadata'); }
  const fields = ['core_bytes', 'core_sha256', 'heap_start', 'labels', 'metadata_sha256', 'schema', 'version'];
  if (abi?.schema !== 'tt-wasm-abi' || abi.version !== 2 || Object.keys(abi).sort().join('\0') !== fields.join('\0') || !Array.isArray(abi.labels) || abi.labels.length > 500_000 || !abi.labels.every(x => typeof x === 'string' && x.isWellFormed() && Buffer.byteLength(x) <= LIMITS.sourceBytes) || new Set(abi.labels).size !== abi.labels.length || !Number.isInteger(abi.heap_start) || abi.heap_start < 16 || abi.heap_start > 32 * 1024 * 1024 || abi.heap_start % 8 !== 0 || !Number.isInteger(abi.core_bytes) || abi.core_bytes < 8 || abi.core_bytes >= bytes.length || !/^[0-9a-f]{64}$/.test(abi.core_sha256) || !/^[0-9a-f]{64}$/.test(abi.metadata_sha256)) bad('unsupported or malformed TT Wasm ABI');
  const metadata = { schema: abi.schema, version: abi.version, labels: abi.labels, heap_start: abi.heap_start, core_bytes: abi.core_bytes, core_sha256: abi.core_sha256 };
  if (createHash('sha256').update(Buffer.from(JSON.stringify(metadata))).digest('hex') !== abi.metadata_sha256) bad('TT Wasm ABI metadata integrity mismatch');
  let at = abi.core_bytes; const readLeb = () => { let x = 0; for (let i = 0; i < 5; i++) { if (at >= bytes.length) bad('truncated ABI section'); const b = bytes[at++]; if (i === 4 && b > 15) bad('invalid ABI length'); x += (b & 127) * 2 ** (i * 7); if (!(b & 128)) return x; } bad('invalid ABI length'); };
  if (bytes[at++] !== 0) bad('tt.abi must be the final section'); const size = readLeb(), end = at + size, len = readLeb(); if (end !== bytes.length || len !== 6 || bytes.subarray(at, at + 6).toString() !== 'tt.abi') bad('invalid final ABI section');
  if (createHash('sha256').update(bytes.subarray(0, abi.core_bytes)).digest('hex') !== abi.core_sha256) bad('Wasm integrity mismatch');
  const exports = WebAssembly.Module.exports(module), required = new Map([['main', 'function'], ['set_fuel', 'function'], ['error_code', 'function'], ['fuel_remaining', 'function'], ['memory', 'memory']]);
  if (exports.length !== required.size || !exports.every(e => required.get(e.name) === e.kind)) bad('incompatible Wasm exports');
  return { bytes, module, abi, source: parseSource(module) };
}
export function readValue(memory, pointer, abi) {
  const bytes = new Uint8Array(memory.buffer), view = new DataView(bytes.buffer); let visited = 0, lastNesting = 0; const active = new Set();
  const heapEnd = bytes.length >= 16 ? view.getUint32(12, true) : 0;
  if (heapEnd && (heapEnd < abi.heap_start || heapEnd > bytes.length || heapEnd % 8 !== 0)) bad('invalid live heap boundary');
  const dynamicEnd = heapEnd || bytes.length;
  const bounds = (p, size) => {
    if (!Number.isInteger(p) || !Number.isInteger(size) || p < 16 || size < 0 || p % 8 || p + size < p) bad('invalid result memory range');
    const staticValue = p < abi.heap_start, end = staticValue ? abi.heap_start : dynamicEnd;
    if (p + size > end) bad(staticValue ? 'result crosses static heap boundary' : 'result points outside live heap');
  };
  const read = (p, depth) => {
    if (++visited > 1_000_000 || depth > 128) fail(0, 'result decoding limit exceeded', 'E_LIMIT');
    bounds(p, 16); if (active.has(p)) bad('cyclic result');
    const tag = view.getUint32(p, true), len = view.getUint32(p + 4, true);
    if (tag === Tag.Unit) { if (len) bad('invalid Unit result header'); lastNesting = 0; return null; }
    if (tag === Tag.Int) { if (len) bad('invalid Int result header'); bounds(p, 24); lastNesting = 0; return view.getBigInt64(p + 16, true); }
    if (tag === Tag.Bool) { const b = view.getUint32(p + 8, true); if (len || b > 1) bad('invalid Boolean result'); lastNesting = 0; return !!b; }
    if (tag === Tag.Text) { if (len > LIMITS.sourceBytes) bad('oversized text result'); bounds(p, 16 + len); try { const value = utf8.decode(bytes.subarray(p + 16, p + 16 + len)); lastNesting = 0; return value; } catch { bad('invalid UTF-8 result'); } }
    if (tag !== Tag.Record && tag !== Tag.Array && tag !== Tag.Closure) bad('unknown result tag');
    if (len > 1_000_000) bad('oversized aggregate result');
    const aux = view.getUint32(p + 8, true), declaredDepth = view.getUint32(p + 12, true); if (declaredDepth > 128) bad('invalid result nesting metadata'); if (tag !== Tag.Closure && aux) bad('invalid aggregate result header');
    const width = tag === Tag.Record ? 8 : 4; bounds(p, 16 + len * width); active.add(p);
    try {
      let nesting = 0;
      const child = (q, nextDepth) => { const value = read(q, nextDepth); nesting = Math.max(nesting, lastNesting + 1); return value; };
      if (tag === Tag.Closure) {
        for (let i = 0; i < len; i++) child(view.getUint32(p + 16 + i * 4, true), depth + 1);
        if (declaredDepth !== nesting) bad('invalid result nesting metadata'); lastNesting = nesting; return { kind: 'Closure' };
      }
      if (tag === Tag.Array) {
        const values = []; for (let i = 0; i < len; i++) values.push(child(view.getUint32(p + 16 + i * 4, true), depth + 1));
        if (declaredDepth !== nesting) bad('invalid result nesting metadata'); lastNesting = nesting; return { kind: 'Array', values };
      }
      const labels = [], values = [], seen = new Set();
      for (let i = 0; i < len; i++) {
        const label = view.getUint32(p + 16 + i * 8, true); if (label >= abi.labels.length || seen.has(label)) bad('invalid record label'); seen.add(label); labels.push(abi.labels[label]);
        values.push(child(view.getUint32(p + 20 + i * 8, true), depth + 1));
      }
      if (declaredDepth !== nesting) bad('invalid result nesting metadata'); lastNesting = nesting; return { kind: 'Record', labels, values };
    } finally { active.delete(p); }
  };
  return read(pointer >>> 0, 0);
}
export function display(value, depth = 0) { if (depth > 64) return '...'; if (value === null) return '()'; if (typeof value === 'bigint' || typeof value === 'boolean') return String(value); if (typeof value === 'string') return '"' + value.replace(/[\n\r\t"\\]/g, c => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t', '"': '\\"', '\\': '\\\\' })[c]) + '"'; if (value.kind === 'Closure') return '<fn>'; if (value.kind === 'Array') return '[' + value.values.map(x => display(x, depth + 1)).join(', ') + ']'; if (value.kind === 'Record') return '{ ' + value.values.map((x, i) => `.${value.labels[i]} = ${display(x, depth + 1)}; `).join('') + '}'; bad('invalid decoded result'); }
export function execute(wasm, { fuel = 10_000_000 } = {}) {
  if (!Number.isSafeInteger(fuel) || fuel < 0) throw new TypeError('fuel must be a nonnegative safe integer');
  let start = performance.now(); const loaded = loadWasm(wasm); const load_ms = performance.now() - start; start = performance.now(); const instance = new WebAssembly.Instance(loaded.module, {}); const instantiate_ms = performance.now() - start; instance.exports.set_fuel(BigInt(fuel)); let pointer; start = performance.now();
  try { pointer = instance.exports.main(); } catch (e) { if (!(e instanceof WebAssembly.RuntimeError)) throw e; const known = Errors[instance.exports.error_code()]; const position = new DataView(instance.exports.memory.buffer).getUint32(8, true); const error = new TTError(known?.[0] ?? 'E_RUNTIME', position, known?.[1] ?? ('unexpected Wasm trap: ' + e.message)); error.source = sourceLocation(loaded.source, position); throw error; }
  const execute_ms = performance.now() - start; start = performance.now(); const value = readValue(instance.exports.memory, pointer, loaded.abi), output = display(value); const decode_ms = performance.now() - start;
  const heap_end = new DataView(instance.exports.memory.buffer).getUint32(12, true), heap_bytes = heap_end ? heap_end - loaded.abi.heap_start : null;
  return { value, output, instance, module: loaded.module, metrics: { load_ms, instantiate_ms, execute_ms, decode_ms, heap_bytes }, remaining_fuel: instance.exports.fuel_remaining() };
}
