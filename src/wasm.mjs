/** Direct AST -> Wasm. Source lambdas become functions; calls use a Wasm table. */
import { createHash } from 'node:crypto';
import { NONE, LIMITS, fail, enter } from './core.mjs';
import { WasmModule, Bytes, I32, I64, uleb } from './wasm-binary.mjs';
import { installRuntime, NativeEntry, Tag, G } from './wasm-runtime.mjs';
import { declareOwnership, installOwnership, emitOwnership, OWNED_EXPORTS } from './wasm-ownership.mjs';
import { declareArrays, installArrays, emitArray, ARRAY_KINDS } from './wasm-arrays.mjs';
import { isComparison } from './wasm-integers.mjs';
import { hostSpecifications, declareEffectImports, installEffectOperations, emitHandler } from './wasm-effects.mjs';
const binary = new Map([['+', 'add'], ['-', 'sub'], ['*', 'mul'], ['/', 'div'], ['%', 'mod'], ['==', 'eq'], ['!=', 'ne'], ['<', 'lt'], ['<=', 'le'], ['>', 'gt'], ['>=', 'ge']]);
const arithmetic = e => e?.kind === 'Unary' ? e.text === '-' :
  e?.kind === 'Binary' && ['+', '-', '*', '/', '%'].includes(e.text);
function numericRegions(ast, enabled) {
  const nodes = new Set();
  if (!enabled) return nodes;
  // Adjacent numeric operations are the only region edges. Calls, handlers,
  // bindings and container boundaries retain the ordinary boxed representation.
  for (let id = 0; id < ast.nodes.length; id++) {
    const e = ast.nodes[id];
    if (!(arithmetic(e) || (e.kind === 'Binary' && binary.has(e.text)))) continue;
    for (const child of e.kind === 'Unary' ? [e.a] : [e.a, e.b]) {
      if (arithmetic(ast.nodes[child])) { nodes.add(id); nodes.add(child); }
    }
  }
  return nodes;
}
function sourceSection(source, name) {
  if (typeof name !== 'string' || !name.isWellFormed() || Buffer.byteLength(name) > 4096 || /[\u0000-\u001f\u007f]/.test(name))
    throw new TypeError('sourceName must be a well-formed control-free string of at most 4096 UTF-8 bytes');
  const nameBytes = Buffer.from(name), starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const payload = Buffer.alloc(1 + 4 + 32 + 4 + nameBytes.length + 4 + starts.length * 4); let at = 0;
  payload[at++] = 1; payload.writeUInt32LE(source.length, at); at += 4;
  createHash('sha256').update(Buffer.from(source)).digest().copy(payload, at); at += 32;
  payload.writeUInt32LE(nameBytes.length, at); at += 4; nameBytes.copy(payload, at); at += nameBytes.length;
  payload.writeUInt32LE(starts.length, at); at += 4; for (const start of starts) { payload.writeUInt32LE(start, at); at += 4; }
  const custom = new Bytes().name('tt.source').add(payload).finish(); return Buffer.concat([Buffer.from([0, ...uleb(custom.length)]), custom]);
}
class StaticData {
  chunks = [Buffer.alloc(16)]; size = 16; values = new Map();
  add(key, tag, count = 0, aux = 0, payload = Buffer.alloc(0)) { if (this.values.has(key)) return this.values.get(key); const p = this.size, size = Math.ceil((16 + payload.length) / 8) * 8, bytes = Buffer.alloc(size); bytes.writeInt32LE(tag, 0); bytes.writeUInt32LE(count, 4); bytes.writeUInt32LE(aux, 8); payload.copy(bytes, 16); this.size += size; if (this.size > 32 * 1024 * 1024) fail(0, 'static data size limit exceeded', 'E_LIMIT'); this.chunks.push(bytes); this.values.set(key, p); return p; }
  integer(value) { const b = Buffer.alloc(8); b.writeBigInt64LE(value); return this.add('int:' + value, Tag.Int, 0, 0, b); }
  text(value) { const b = Buffer.from(value); return this.add('text:' + value, Tag.Text, b.length, 0, b); }
  finish() { return Buffer.concat(this.chunks); }
}
export class WasmEmit {
  depth = 0; serial = 0; sourceNodes = 0; unboxedIntermediates = 0;
  constructor(ast, inference, source, sourceName = '', effects = { operations: [], hosts: [] }, sources = null, optimize = true) { this.ast = ast; this.optimize = optimize; this.numericNodes = numericRegions(ast, optimize); this.source = source; this.sourceName = sourceName; this.data = new StaticData(); this.m = new WasmModule(); this.effects = effects; this.sources = sources; this.hosts = hostSpecifications(effects); declareEffectImports(this.m, this.hosts); this.arrays = ast.arrays ? declareArrays(this.m, Boolean(ast.ownership)) : null; this.ownership = ast.ownership ? declareOwnership(this.m, effects) : null; this.constants = { unit: this.data.add('unit', Tag.Unit), false: this.data.add('false', Tag.Bool), true: this.data.add('true', Tag.Bool, 0, 1) }; const byBinder = new Map(inference.builtins.map(b => [b.binder, b])); const used = new Set(this.ast.nodes.filter(e => e.kind === 'Var' && byBinder.has(e.binder)).map(e => e.binder)); const roots = this.runtimeRoots(); for (const binder of used) roots.add(NativeEntry[byBinder.get(binder).name]); const targets = installRuntime(this.m, this.constants, roots, optimize, this.ownership, this.arrays); this.runtimeFunctions = targets.size; this.natives = new Map([...used].map(binder => { const b = byBinder.get(binder), target = targets.get(NativeEntry[b.name]); if (target === undefined) fail(0, 'missing demanded native runtime entry', 'E_INTERNAL'); return [binder, this.data.add('native:' + b.name, Tag.Closure, 0, target)]; })); installEffectOperations(this, effects); if (this.ownership) installOwnership(this); if (this.arrays) installArrays(this); }
  runtimeRoots() {
    const roots = new Set(['tick', 'set_fuel', 'error_code', 'fuel_remaining']);
    if (this.arrays) for (const n of ['alloc','object','put','tick','trap','integer','kind']) roots.add(n);
    if (this.ownership) for (const n of ['alloc', 'trap', 'tick', 'integer', 'invoke']) roots.add(n);
    if (this.effects.operations.length) for (const n of ['invoke', 'object', 'put', 'trap', 'box', 'bool', 'kind', 'integer', 'boolean']) roots.add(n);
    for (let id = 0; id < this.ast.nodes.length; id++) {
      const e = this.ast.nodes[id];
      if (this.numericNodes.has(id)) {
        const name = e.kind === 'Unary' ? 'neg' : binary.get(e.text);
        roots.add('raw:' + name); roots.add('integer'); roots.add(isComparison(name) ? 'bool' : 'box');
      } else {
        if (e.kind === 'Unary') roots.add(e.text === '-' ? 'neg' : 'not');
        if (e.kind === 'Binary') roots.add(e.text === '&&' || e.text === '||' ? 'boolean' : binary.get(e.text));
      }
      if (e.kind === 'Lambda' || e.kind === 'Record' || e.kind === 'Array') { roots.add('object'); roots.add('put'); }
      if (e.kind === 'Call') roots.add('invoke');
      if (e.kind === 'Field') roots.add('field');
      if (e.kind === 'If') roots.add('boolean');
    }
    return roots;
  }
  integerOperand(id, f, scope) {
    if (!this.numericNodes.has(id)) { this.expression(id, f, scope); f.call('integer'); return; }
    const e = this.ast.nodes[id]; enter(this, e.pos); this.sourceNodes++; this.unboxedIntermediates++;
    try { f.i32(e.pos).gset(G.position).call('tick'); this.numericBody(e, f, scope); }
    finally { this.depth--; }
  }
  numericBody(e, f, scope) {
    this.integerOperand(e.a, f, scope);
    if (e.kind === 'Binary') this.integerOperand(e.b, f, scope);
    f.i32(e.pos).gset(G.position).call('raw:' + (e.kind === 'Unary' ? 'neg' : binary.get(e.text)));
  }
  free(id, bound, out) { const e = this.ast.nodes[id]; enter(this, e.pos); try { if (e.kind === 'Var') { if (!bound.has(e.binder) && !this.natives.has(e.binder)) out.add(e.binder); return; } if (e.kind === 'Borrow') { this.free(e.a, bound, out); bound.add(e.binder); this.free(e.b, bound, out); bound.delete(e.binder); return; } if (e.kind === 'Lambda') { bound.add(e.binder); this.free(e.a, bound, out); bound.delete(e.binder); return; } if (e.kind === 'Block') { for (const b of e.bindings) { this.free(b.expr, bound, out); bound.add(b.binder); } this.free(e.a, bound, out); for (const b of e.bindings) bound.delete(b.binder); return; } for (const child of [e.a, e.b, e.c]) if (child !== NONE) this.free(child, bound, out); for (const child of e.items) this.free(child, bound, out); for (const [, child] of e.fields) this.free(child, bound, out); } finally { this.depth--; } }
  load(binder, f, scope) { if (this.natives.has(binder)) { f.i32(this.natives.get(binder)); return; } const loc = scope.get(binder); if (!loc) fail(0, 'unresolved closure binding', 'E_INTERNAL'); if (loc.capture) f.get(0).load(16 + loc.index * 4); else f.get(loc.index); }
  object(f, tag, count, bytes) { f.i32(bytes).i32(tag).i32(count).call('object'); }
  expression(id, f, scope) { const e = this.ast.nodes[id]; enter(this, e.pos); this.sourceNodes++; try { f.i32(e.pos).gset(G.position).call('tick');
    if (this.numericNodes.has(id)) {
      this.numericBody(e, f, scope);
      f.call(e.kind === 'Binary' && isComparison(binary.get(e.text)) ? 'bool' : 'box');
      return;
    }
    if (this.arrays && ARRAY_KINDS.has(e.kind)) { emitArray(this,e,f,scope); return; }
    switch (e.kind) {
    case 'Own': case 'Move': case 'Drop': case 'Snapshot': case 'Take': case 'Borrow': case 'Update': case 'Evolve': emitOwnership(this, e, f, scope); break;
    case 'Int': f.i32(this.data.integer(e.number)); break; case 'Bool': f.i32(e.number ? this.constants.true : this.constants.false); break; case 'Unit': f.i32(this.constants.unit); break; case 'Text': f.i32(this.data.text(e.text)); break; case 'Var': this.load(e.binder, f, scope); break;
    case 'Effect': f.i32(this.effectPointers.get(e.key)); break;
    case 'Host': this.expression(e.a, f, scope); f.drop().i32(this.hostPointers.get(e.effectKey)); break;
    case 'Handle': emitHandler(this, e, f, scope); break;
    case 'Lambda': { const captures = new Set(); this.free(e.a, new Set([e.binder]), captures); const ordered = [...captures].sort((a, b) => a - b), child = this.m.func('lambda:' + this.serial++, [I32, I32]); const inner = new Map([[e.binder, { capture: false, index: 1 }]]); ordered.forEach((cap, i) => inner.set(cap, { capture: true, index: i })); this.expression(e.a, child, inner); if (e.ownedParam) { const returned = child.local(); child.set(returned).get(1).call('owner_drop').get(returned); } const p = f.local(); this.object(f, Tag.Closure, ordered.length, 16 + 4 * ordered.length); f.set(p); f.get(p).i32(child.index).store(8); ordered.forEach((cap, i) => { f.get(p).i32(16 + 4 * i); this.load(cap, f, scope); f.call('put'); }); f.get(p); break; }
    case 'Call': this.expression(e.a, f, scope); this.expression(e.b, f, scope); f.i32(e.pos).gset(G.position).call('invoke'); break;
    case 'Record': case 'Array': { const fields = e.kind === 'Record' ? e.fields : e.items.map((x, i) => [i, x]); const values = fields.map(([, x]) => { this.expression(x, f, scope); const local = f.local(); f.set(local); return local; }); const record = e.kind === 'Record', width = record ? 8 : 4, p = f.local(); f.i32(e.pos).gset(G.position); this.object(f, record ? Tag.Record : Tag.Array, fields.length, 16 + width * fields.length); f.set(p); fields.forEach(([label], i) => { if (record) f.get(p).i32(label).store(16 + 8 * i); f.get(p).i32(16 + width * i + (record ? 4 : 0)).get(values[i]).call('put'); }); f.get(p); break; }
    case 'Field': this.expression(e.a, f, scope); f.i32(e.pos).gset(G.position).i32(e.name).call('field'); break;
    case 'Unary': this.expression(e.a, f, scope); f.i32(e.pos).gset(G.position).call(e.text === '-' ? 'neg' : 'not'); break;
    case 'Binary': this.expression(e.a, f, scope); if (e.text === '&&' || e.text === '||') { f.i32(e.pos).gset(G.position).call('boolean').if(I32); if (e.text === '&&') this.expression(e.b, f, scope); else f.i32(this.constants.true); f.else(); if (e.text === '&&') f.i32(this.constants.false); else this.expression(e.b, f, scope); f.end(); } else { this.expression(e.b, f, scope); f.i32(e.pos).gset(G.position).call(binary.get(e.text)); } break;
    case 'If': this.expression(e.a, f, scope); f.i32(e.pos).gset(G.position).call('boolean').if(I32); this.expression(e.b, f, scope); f.else(); this.expression(e.c, f, scope); f.end(); break;
    case 'Block': {
      const owners=[];
      for (const b of e.bindings) { this.expression(b.expr, f, scope); const local=f.local(); f.set(local); scope.set(b.binder,{capture:false,index:local}); if(b.owned)owners.push(local); }
      this.expression(e.a,f,scope);
      if(owners.length){const returned=f.local();f.set(returned);for(const local of owners.toReversed())f.get(local).call('owner_drop');f.get(returned);}
      break;
    }
    default: fail(e.pos, 'unsupported Wasm expression ' + e.kind, 'E_INTERNAL'); }
  } finally { this.depth--; } }
  run() {
    const entry = this.m.func('entry'); this.expression(this.ast.root, entry, new Map());
    const heap = this.data.size, main = this.m.func('main'), result = main.local();
    main.i32(heap).gset(G.heap).i32(0).gset(G.error).i32(0).gset(G.depth).i32(0).gset(G.position)
      .i32(8).i32(0).store().i32(12).i32(0).store().gget(G.limit).gset(G.fuel);
    for (const global of this.effectGlobals.values()) main.i32(this.constants.unit).gset(global);
    if(this.ownership){const h=this.ownership.globals;main.call('owner_reset').i32(0).gset(h.peak).i32(0).gset(h.reuses);}
    main.call('entry').set(result).i32(12).gget(G.heap).store().get(result);
    for (const name of ['main', 'set_fuel', 'error_code', 'fuel_remaining']) this.m.export(name, 0, this.m.functionId(name));
    this.m.export('memory', 2, 0);
    const ownerStart=Math.ceil(Math.max(4*1024*1024,heap+4*1024*1024)/65536)*65536;
    if(this.ownership)for(const [name,fn] of Object.entries(OWNED_EXPORTS))this.m.export(name,0,this.m.functionId(fn));
    const machine = this.m.finish(this.data.finish(), heap,
      [[I32, heap], [I32, 0], [I64, 10_000_000], [I64, 10_000_000], [I32, 0], [I32, 0],
        ...this.effects.operations.map(() => [I32, this.constants.unit]),
        ...(this.ownership ? [ownerStart,ownerStart,0,0,0,0,0,0].map(n=>[I32,n]) : [])]);
    const customSection = (name, value) => {
      const custom = new Bytes().name(name).add(Buffer.from(JSON.stringify(value))).finish();
      return Buffer.concat([Buffer.from([0, ...uleb(custom.length)]), custom]);
    };
    const sections = [machine, sourceSection(this.source, this.sourceName)];
    if (this.sources) sections.push(customSection('tt.modules', { version: 1, sources: this.sources.map(s => ({
      name: s.name, start: s.start, units: s.text.length, sha256: s.sha256,
      lines: [0, ...[...s.text.matchAll(/\n/g)].map(m => m.index + 1)],
    })) }));
    if(this.arrays)sections.push(customSection('tt.arrays',{version:1}));
    if(this.ownership)sections.push(customSection('tt.ownership',{version:1,arena_start:ownerStart,arena_limit:64*1024*1024}));
    if (this.hosts.length) sections.push(customSection('tt.effects', { version: 1, operations: this.hosts }));
    const core = Buffer.concat(sections);
    const abi = { schema: 'tt-wasm-abi', version: 2, labels: this.ast.symbols.names,
      heap_start: heap, core_bytes: core.length, core_sha256: createHash('sha256').update(core).digest('hex') };
    abi.metadata_sha256 = createHash('sha256').update(Buffer.from(JSON.stringify(abi))).digest('hex');
    const wasm = Buffer.concat([core, customSection('tt.abi', abi)]);
    if (wasm.length > LIMITS.artifactBytes) fail(0, 'Wasm artifact size limit exceeded', 'E_LIMIT');
    return { wasm, runtime_functions: this.runtimeFunctions, wasm_functions: this.m.functions.length,
      wasm_bytes: wasm.length, static_bytes: heap, emitted_expressions: this.sourceNodes, host_imports: this.hosts.length, unboxed_intermediates: this.unboxedIntermediates };
  }
}
