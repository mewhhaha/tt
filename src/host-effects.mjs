/** Explicit synchronous host capabilities. Only copied scalar inputs/results cross this boundary. */
import { LIMITS, MIN, MAX, TTError, fail } from './core.mjs';
import { HOST_MODULE, hostSignature } from './wasm-effects.mjs';
import { performance } from 'node:perf_hooks';
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const bad = message => fail(0, message, 'E_WASM');
const fields = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');
function contract(value, output) {
  if (!value || !['Int', 'Bool', 'Unit', ...(output ? [] : ['Text'])].includes(value.kind)) bad('invalid host operation contract');
  if (value.kind !== 'Int') { if (!fields(value, ['kind'])) bad('invalid host scalar contract'); return; }
  if (!fields(value, ['kind', 'ranges']) || !Array.isArray(value.ranges) || value.ranges.length > LIMITS.intervals) bad('invalid host Int refinement');
  let end = MIN - 2n;
  for (const pair of value.ranges) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(x => typeof x === 'string' && /^-?(0|[1-9][0-9]{0,18})$/.test(x) && x !== '-0')) bad('invalid host Int range');
    const [lo, hi] = pair.map(BigInt);
    if (lo < MIN || hi > MAX || lo > hi || lo <= end + 1n) bad('noncanonical host Int range');
    end = hi;
  }
}
/** Confirm actual import machine signatures, not only their names in custom metadata. */
function importedSignatures(bytes) {
  let at = 8, limit = bytes.length; const types = [], imports = [];
  const byte = () => { if (at >= limit) bad('truncated Wasm import/type metadata'); return bytes[at++]; };
  const u32 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) { const b = byte(); if (i === 4 && b > 15) bad('invalid Wasm index'); value += (b & 127) * 2 ** (7 * i); if (!(b & 128)) return value; }
    bad('invalid Wasm index');
  };
  const name = () => { const n = u32(); if (n > 8192 || at + n > limit) bad('invalid host import name'); const s = utf8.decode(bytes.subarray(at, at + n)); at += n; return s; };
  const vector = () => { const n = u32(); if (n > 1024) bad('unsupported host function arity'); const out = []; for (let i = 0; i < n; i++) { const t = byte(); if (t !== 0x7f && t !== 0x7e) bad('unsupported TT machine type'); out.push(t); } return out; };
  while (at < bytes.length) {
    limit = bytes.length; const id = byte(), size = u32(), end = at + size; if (end > bytes.length) bad('invalid Wasm section'); limit = end;
    if (id === 1) {
      const n = u32(); if (n > 200_000) bad('Wasm type limit exceeded');
      for (let i = 0; i < n; i++) { if (byte() !== 0x60) bad('unsupported TT function type'); types.push({ params: vector(), results: vector() }); }
      if (at !== end) bad('invalid TT type section');
    } else if (id === 2) {
      const n = u32(); if (n > 1024) bad('host import limit exceeded');
      for (let i = 0; i < n; i++) { const module = name(), field = name(); if (byte() !== 0) bad('only function host imports are supported'); const type = types[u32()]; if (!type) bad('unknown import signature'); imports.push({ module, name: field, ...type }); }
      if (at !== end) bad('invalid TT import section');
    } else if (id === 8) bad('TT host artifacts must not have a start function');
    at = end;
  }
  return imports;
}
export function readHostEffects(module, bytes) {
  const sections = WebAssembly.Module.customSections(module, 'tt.effects'), actual = WebAssembly.Module.imports(module);
  if (!sections.length) { if (actual.length) bad('host imports require tt.effects contracts'); return []; }
  if (sections.length !== 1 || sections[0].byteLength > LIMITS.sourceBytes) bad('invalid tt.effects section');
  let metadata; try { metadata = JSON.parse(utf8.decode(sections[0])); } catch { bad('invalid tt.effects metadata'); }
  if (!fields(metadata, ['version', 'operations']) || metadata.version !== 1 || !Array.isArray(metadata.operations) ||
      !metadata.operations.length || metadata.operations.length > 1024) bad('unsupported tt.effects metadata');
  const seen = new Set(), specs = metadata.operations;
  for (const spec of specs) {
    if (!fields(spec, ['key', 'input', 'output']) || typeof spec.key !== 'string' || !spec.key.isWellFormed() ||
        !spec.key.length || Buffer.byteLength(spec.key) > 8192 || /[\u0000-\u001f\u007f]/.test(spec.key) || seen.has(spec.key)) bad('invalid or duplicate host effect key');
    seen.add(spec.key); contract(spec.input, false); contract(spec.output, true);
  }
  const signatures = importedSignatures(bytes);
  if (signatures.length !== specs.length || actual.length !== specs.length) bad('host effect/import count mismatch');
  for (let i = 0; i < specs.length; i++) {
    const a = signatures[i], expected = hostSignature(specs[i]);
    if (a.module !== HOST_MODULE || a.name !== specs[i].key || a.params.join(',') !== expected.params.join(',') || a.results.join(',') !== expected.results.join(',')) bad('host import contract/signature mismatch');
  }
  return specs;
}
function checkScalar(value, c, key) {
  const invalid = () => fail(0, `host effect '${key}' returned a value outside ${c.kind}`, 'E_HOST');
  if (c.kind === 'Unit') { if (value !== undefined && value !== null) invalid(); return undefined; }
  if (c.kind === 'Bool') { if (typeof value !== 'boolean') invalid(); return value ? 1 : 0; }
  if (typeof value !== 'bigint' || value < MIN || value > MAX || !c.ranges.some(([lo, hi]) => BigInt(lo) <= value && value <= BigInt(hi))) invalid();
  return value;
}
export function hostImports(loaded, host, getInstance, locate) {
  if (!(host instanceof Map)) throw new TypeError('host capabilities must be an explicit Map');
  const imports = Object.create(null), table = Object.create(null), metrics = { calls: 0, ms: 0 };
  if (loaded.hostEffects.length) imports[HOST_MODULE] = table;
  for (const spec of loaded.hostEffects) {
    const callback = host.get(spec.key);
    if (typeof callback !== 'function') fail(0, `missing explicit host capability '${spec.key}'`, 'E_HOST_MISSING');
    table[spec.key] = (...args) => {
      const start = performance.now(); metrics.calls++;
      try {
        const instance = getInstance(); if (!instance) throw new Error('host operation before instance initialization');
        let value = null;
        if (spec.input.kind === 'Int') value = args[0];
        else if (spec.input.kind === 'Bool') { if (args[0] !== 0 && args[0] !== 1) throw new Error('invalid Boolean host argument'); value = !!args[0]; }
        else if (spec.input.kind === 'Text') {
          const [pointer, count] = args, memory = instance.exports.memory.buffer;
          if (!Number.isInteger(pointer) || !Number.isInteger(count) || pointer < 16 || count < 0 || count > LIMITS.sourceBytes || pointer + count > memory.byteLength) throw new Error('invalid Text host argument');
          value = utf8.decode(new Uint8Array(memory, pointer, count));
        }
        if (spec.input.kind === 'Int' && !spec.input.ranges.some(([lo, hi]) => BigInt(lo) <= value && value <= BigInt(hi))) throw new Error('host argument violates operation refinement');
        return checkScalar(callback(value), spec.output, spec.key);
      } catch (cause) {
        const instance = getInstance(), pos = instance ? new DataView(instance.exports.memory.buffer).getUint32(8, true) : 0;
        const error = new TTError('E_HOST', pos, `host effect '${spec.key}' failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        error.source = locate(loaded.source, pos); throw error;
      } finally { metrics.ms += performance.now() - start; }
    };
  }
  return { imports, metrics };
}
export function readModuleSources(module, source) {
  const sections = WebAssembly.Module.customSections(module, 'tt.modules');
  if (!sections.length) return source;
  if (!source || sections.length !== 1 || sections[0].byteLength > 24 * LIMITS.sourceBytes) bad('invalid tt.modules section');
  let data; try { data = JSON.parse(utf8.decode(sections[0])); } catch { bad('invalid tt.modules metadata'); }
  if (!fields(data, ['version', 'sources']) || data.version !== 1 || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 256) bad('unsupported tt.modules metadata');
  let next = 0; const names = new Set();
  for (const entry of data.sources) {
    if (!fields(entry, ['name', 'start', 'units', 'sha256', 'lines']) || typeof entry.name !== 'string' ||
        !entry.name.isWellFormed() || Buffer.byteLength(entry.name) > 4096 || /[\u0000-\u001f\u007f]/.test(entry.name) ||
        names.has(entry.name) || entry.start !== next || !Number.isSafeInteger(entry.units) || entry.units < 0 ||
        entry.start + entry.units > source.units || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Array.isArray(entry.lines) ||
        !entry.lines.length || entry.lines.length > entry.units + 1) bad('invalid module source record');
    names.add(entry.name); let previous = -1;
    for (const at of entry.lines) { if (!Number.isSafeInteger(at) || at <= previous || at > entry.units || (previous < 0 && at !== 0)) bad('invalid module line table'); previous = at; }
    next += entry.units + 1;
  }
  if (next !== source.units) bad('module source map length mismatch');
  return { ...source, modules: data.sources };
}
