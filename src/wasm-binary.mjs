/** Minimal, deterministic Core Wasm binary writer. No WAT toolchain or npm packages. */
import { fail, LIMITS } from './core.mjs';
export const I32 = 0x7f, I64 = 0x7e, VOID = 0x40;
export function uleb(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('u32 LEB input');
  const out = []; do { const b = value % 128; value = Math.floor(value / 128); out.push(b | (value ? 128 : 0)); } while (value);
  return out;
}
export function sleb(value) {
  value = BigInt(value); const out = [];
  for (;;) { const b = Number(value & 127n); value >>= 7n;
    const done = (value === 0n && !(b & 64)) || (value === -1n && (b & 64));
    out.push(b | (done ? 0 : 128)); if (done) return out;
  }
}
/** Grow geometrically; bulk copy byte spans instead of retaining boxed JS numbers. */
export class Bytes {
  buffer = Buffer.allocUnsafe(128); length = 0;
  get a() { return this.buffer.subarray(0, this.length); }
  reserve(extra) {
    const required = this.length + extra;
    if (!Number.isSafeInteger(extra) || extra < 0 || required > LIMITS.artifactBytes)
      fail(0, 'Wasm byte buffer limit exceeded', 'E_LIMIT');
    if (required <= this.buffer.length) return;
    const next = Buffer.allocUnsafe(Math.min(LIMITS.artifactBytes, Math.max(required, this.buffer.length * 2)));
    next.set(this.a); this.buffer = next;
  }
  add(...parts) {
    for (const part of parts) {
      if (typeof part === 'number') { this.reserve(1); this.buffer[this.length++] = part; }
      else if (part instanceof Uint8Array || Array.isArray(part)) {
        this.reserve(part.length); this.buffer.set(part, this.length); this.length += part.length;
      } else { for (const byte of part) { this.reserve(1); this.buffer[this.length++] = byte; } }
    }
    return this;
  }
  u(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('u32 LEB input');
    this.reserve(5);
    do { const byte = value & 127; value >>>= 7; this.buffer[this.length++] = byte | (value ? 128 : 0); } while (value);
    return this;
  }
  s(value) {
    // i32 indices/offsets need no BigInt or temporary operand array.
    if (Number.isSafeInteger(value)) {
      this.reserve(8);
      for (;;) {
        const byte = value & 127; value = Math.floor(value / 128);
        const done = (value === 0 && !(byte & 64)) || (value === -1 && (byte & 64));
        this.buffer[this.length++] = byte | (done ? 0 : 128); if (done) return this;
      }
    }
    value = BigInt(value);
    for (;;) {
      const byte = Number(value & 127n); value >>= 7n;
      const done = (value === 0n && !(byte & 64)) || (value === -1n && (byte & 64));
      this.reserve(1); this.buffer[this.length++] = byte | (done ? 0 : 128); if (done) return this;
    }
  }
  name(value) { const bytes = Buffer.from(value); return this.u(bytes.length).add(bytes); }
  // Never expose capacity/uninitialized bytes, or an alias changed by later writes.
  finish() { return Buffer.from(this.a); }
}
export class FunctionBody extends Bytes {
  locals = [];
  constructor(module, name, params, results) { super(); this.module = module; this.name = name; this.params = params; this.results = results; }
  local(type = I32) {
    if (this.locals.length >= 49_998) fail(0, 'Wasm function local limit exceeded', 'E_LIMIT');
    const n = this.params.length + this.locals.length; this.locals.push(type); return n;
  }
  get(n) { return this.add(0x20).u(n); }
  set(n) { return this.add(0x21).u(n); }
  tee(n) { return this.add(0x22).u(n); }
  gget(n) { return this.add(0x23).u(n); }
  gset(n) { return this.add(0x24).u(n); }
  i32(n) { return this.add(0x41).s(n); }
  i64(n) { return this.add(0x42).s(n); }
  call(name) { return this.add(0x10).u(this.module.functionId(name)); }
  indirect(type) { return this.add(0x11).u(type).u(0); }
  load(offset = 0) { return this.add(0x28).u(2).u(offset); }
  load64(offset = 0) { return this.add(0x29).u(3).u(offset); }
  load8(offset = 0) { return this.add(0x2d).u(0).u(offset); }
  store(offset = 0) { return this.add(0x36).u(2).u(offset); }
  store64(offset = 0) { return this.add(0x37).u(3).u(offset); }
  store8(offset = 0) { return this.add(0x3a).u(0).u(offset); }
  if(type = VOID) { return this.add(0x04, type); }
  else() { return this.add(0x05); }
  end() { return this.add(0x0b); }
  block() { return this.add(0x02, VOID); }
  loop() { return this.add(0x03, VOID); }
  br(depth) { return this.add(0x0c).u(depth); }
  brIf(depth) { return this.add(0x0d).u(depth); }
  drop() { return this.add(0x1a); }
  ret() { return this.add(0x0f); }
  body() {
    const groups = [];
    for (const type of this.locals) { if (groups.at(-1)?.[1] === type) groups.at(-1)[0]++; else groups.push([1, type]); }
    const out = new Bytes().u(groups.length);
    for (const [count, type] of groups) out.u(count).add(type);
    return out.add(this.a, 0x0b).finish();
  }
}
export class WasmModule {
  types = []; typeIds = new Map(); functions = []; imports = []; names = new Map(); exports = [];
  type(params, results) {
    const key = params.join(',') + '>' + results.join(','); let id = this.typeIds.get(key);
    if (id === undefined) { id = this.types.length; this.types.push({ params, results }); this.typeIds.set(key, id); } return id;
  }
  importFunction(name, module, field, params, results) {
    if (this.functions.length || this.names.has(name)) throw new Error('Wasm imports must be declared first and uniquely');
    const index = this.imports.length, type = this.type(params, results);
    this.imports.push({ name, module, field, type, index }); this.names.set(name, index); return index;
  }
  func(name, params = [], results = [I32]) {
    if (this.names.has(name)) throw new Error('duplicate Wasm function: ' + name);
    const f = new FunctionBody(this, name, params, results); f.type = this.type(params, results);
    f.index = this.imports.length + this.functions.length; this.names.set(name, f.index); this.functions.push(f); return f;
  }
  functionId(name) { const id = this.names.get(name); if (id === undefined) throw new Error('unknown Wasm function: ' + name); return id; }
  export(name, kind, index) { this.exports.push({ name, kind, index }); }
  finish(data, heapStart, globals) {
    const pieces = [Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])];
    const section = (id, body) => { const bytes = body instanceof Bytes ? body.finish() : body; pieces.push(Buffer.from([id, ...uleb(bytes.length)]), bytes); };
    const types = new Bytes().u(this.types.length);
    for (const t of this.types) { types.add(0x60).u(t.params.length).add(t.params).u(t.results.length).add(t.results); } section(1, types);
    if (this.imports.length) {
      const imports = new Bytes().u(this.imports.length);
      for (const item of this.imports) imports.name(item.module).name(item.field).add(0).u(item.type);
      section(2, imports);
    }
    const funcs = new Bytes().u(this.functions.length); for (const f of this.functions) funcs.u(f.type); section(3, funcs);
    const totalFunctions = this.functions.length + this.imports.length;
    section(4, new Bytes().u(1).add(0x70, 1).u(totalFunctions).u(totalFunctions));
    section(5, new Bytes().u(1).add(1).u(Math.max(1, Math.ceil(heapStart / 65536))).u(1024));
    const gs = new Bytes().u(globals.length);
    for (const [type, value] of globals) gs.add(type, 1, type === I64 ? 0x42 : 0x41, sleb(value), 0x0b); section(6, gs);
    const exports = new Bytes().u(this.exports.length); for (const e of this.exports) exports.name(e.name).add(e.kind).u(e.index); section(7, exports);
    const elements = new Bytes().u(1).add(0, 0x41, 0, 0x0b).u(totalFunctions);
    for (const f of [...this.imports, ...this.functions]) elements.u(f.index); section(9, elements);
    const code = new Bytes().u(this.functions.length); for (const f of this.functions) { const body = f.body(); code.u(body.length).add(body); } section(10, code);
    section(11, new Bytes().u(1).add(0, 0x41, 0, 0x0b).u(data.length).add(data));
    const out = Buffer.concat(pieces); if (out.length > LIMITS.artifactBytes) fail(0, 'Wasm artifact size limit exceeded', 'E_LIMIT'); return out;
  }
}
