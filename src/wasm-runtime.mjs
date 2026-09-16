/** Runtime helpers are emitted as real Wasm functions, not JavaScript imports. */
import { I32, I64 } from './wasm-binary.mjs';
export const Tag = Object.freeze({ Unit: 0, Int: 1, Bool: 2, Text: 3, Array: 4, Record: 5, Closure: 6 });
export const G = Object.freeze({ heap: 0, error: 1, fuel: 2, limit: 3, depth: 4 });
export const Errors = Object.freeze({
  1: ['E_RUNTIME', 'integer overflow'], 2: ['E_RUNTIME', 'division by zero'],
  3: ['E_RUNTIME', 'remainder by zero'], 4: ['E_RUNTIME', 'array index out of bounds'],
  5: ['E_RUNTIME', 'invalid runtime value kind'], 6: ['E_RUNTIME', 'missing record field'],
  7: ['E_LIMIT', 'Wasm linear-memory allocation budget exhausted'], 8: ['E_LIMIT', 'execution fuel exhausted'],
  9: ['E_LIMIT', 'call depth limit exceeded'], 10: ['E_LIMIT', 'value nesting limit exceeded'],
  11: ['E_LIMIT', 'text size limit exceeded'], 12: ['E_RUNTIME', 'invalid execution fuel'],
});
const failIf = (f, code) => f.if().i32(code).call('trap').end();
const allocObject = (f, tag, count, bytes) => f.i32(bytes).i32(tag).i32(count).call('object');
const storeCapture = (f, p, index, value) => f.get(p).i32(16 + 4 * index).get(value).call('put');
export const NativeEntry = Object.freeze({
  length: 'length', get: 'get1', map: 'map1', fold: 'fold1', concat: 'concat1', textLength: 'textLength',
});
const dependencies = Object.freeze({
  trap: [], tick: ['trap'], alloc: ['trap'], object: ['alloc'], put: ['trap'], kind: ['trap'],
  integer: ['kind'], boolean: ['kind'], box: ['object'], bool: [], invoke: ['tick', 'trap', 'kind'],
  field: ['kind', 'tick', 'trap'], neg: ['integer', 'trap', 'box'], not: ['boolean', 'bool'],
  add: ['integer', 'trap', 'box'], sub: ['integer', 'trap', 'box'], mul: ['integer', 'trap', 'box'],
  div: ['integer', 'trap', 'box'], mod: ['integer', 'trap', 'box'],
  eq: ['integer', 'bool'], ne: ['integer', 'bool'], lt: ['integer', 'bool'], le: ['integer', 'bool'],
  gt: ['integer', 'bool'], ge: ['integer', 'bool'],
  length: ['kind', 'box'], get1: ['object', 'put', 'get2'], get2: ['kind', 'integer', 'trap'],
  map1: ['object', 'put', 'map2'], map2: ['kind', 'object', 'tick', 'invoke', 'put'],
  fold1: ['object', 'put', 'fold2'], fold2: ['object', 'put', 'fold3'], fold3: ['kind', 'tick', 'invoke'],
  concat1: ['object', 'put', 'concat2'], concat2: ['kind', 'trap', 'object', 'tick'],
  textLength: ['kind', 'box'], set_fuel: ['trap'], error_code: [], fuel_remaining: [],
});
function closure(roots) {
  const wanted = new Set(), pending = [...roots];
  while (pending.length) {
    const name = pending.pop();
    if (wanted.has(name)) continue;
    const deps = dependencies[name];
    if (!deps) throw new Error(`unknown Wasm runtime helper: ${name}`);
    wanted.add(name); pending.push(...deps);
  }
  return wanted;
}
export function installRuntime(m, constants, roots) {
  const wanted = closure(roots);
  const sig = wanted.has('invoke') ? m.type([I32, I32], [I32]) : null;
  // Predeclare: direct call indices never depend on later demand/definition order.
  const defs = [
    ['trap', [I32], []], ['tick', [], []], ['alloc', [I32], [I32]],
    ['object', [I32, I32, I32], [I32]], ['put', [I32, I32, I32], []],
    ['kind', [I32, I32], [I32]], ['integer', [I32], [I64]], ['boolean', [I32], [I32]],
    ['box', [I64], [I32]], ['bool', [I32], [I32]], ['invoke', [I32, I32], [I32]],
    ['field', [I32, I32], [I32]], ['neg', [I32], [I32]], ['not', [I32], [I32]],
    ...['add', 'sub', 'mul', 'div', 'mod', 'eq', 'ne', 'lt', 'le', 'gt', 'ge'].map(n => [n, [I32, I32], [I32]]),
    ...['length', 'get1', 'get2', 'map1', 'map2', 'fold1', 'fold2', 'fold3', 'concat1', 'concat2', 'textLength'].map(n => [n, [I32, I32], [I32]]),
    ['set_fuel', [I64], []], ['error_code', [], [I32]], ['fuel_remaining', [], [I64]],
  ];
  const fs = new Map(defs.filter(([name]) => wanted.has(name)).map(([name, p, r]) => [name, m.func(name, p, r)]));
  let f;
  if (fs.has('trap')) { f = fs.get('trap'); f.get(0).gset(G.error).add(0x00); }
  if (fs.has('tick')) { f = fs.get('tick'); f.gget(G.fuel).add(0x50); failIf(f, 8); f.gget(G.fuel).i64(1).add(0x7d).gset(G.fuel); }
  if (fs.has('alloc')) { f = fs.get('alloc'); {
    const old = f.local(), end = f.local(), pages = f.local();
    f.get(0).i32(64 * 1024 * 1024 - 8).add(0x4b); failIf(f, 7);
    f.get(0).i32(7).add(0x6a).i32(-8).add(0x71).set(0);
    f.gget(G.heap).tee(old).get(0).add(0x6a).tee(end).i32(64 * 1024 * 1024).add(0x4b); failIf(f, 7);
    f.get(end).i32(65535).add(0x6a).i32(16).add(0x76).set(pages);
    f.get(pages).add(0x3f, 0).add(0x4b).if();
    f.get(pages).add(0x3f, 0, 0x6b, 0x40, 0).i32(-1).add(0x46); failIf(f, 7); f.end();
    f.get(end).gset(G.heap).get(old);
  } }
  if (fs.has('object')) { f = fs.get('object'); { const p = f.local(); f.get(0).call('alloc').set(p);
    f.get(p).get(1).store(); f.get(p).get(2).store(4); f.get(p).i32(0).store(8); f.get(p).i32(0).store(12); f.get(p); }
  }
  if (fs.has('put')) { f = fs.get('put'); { const depth = f.local(); f.get(2).load(12).i32(1).add(0x6a).tee(depth).i32(128).add(0x4b); failIf(f, 10);
    f.get(depth).get(0).load(12).add(0x4b).if().get(0).get(depth).store(12).end();
    f.get(0).get(1).add(0x6a).get(2).store(); }
  }
  if (fs.has('kind')) { f = fs.get('kind'); f.get(0).load().get(1).add(0x47); failIf(f, 5); f.get(0); }
  if (fs.has('integer')) { f = fs.get('integer'); f.get(0).i32(Tag.Int).call('kind').load64(16); }
  if (fs.has('boolean')) { f = fs.get('boolean'); f.get(0).i32(Tag.Bool).call('kind').load(8); }
  if (fs.has('box')) { f = fs.get('box'); { const p = f.local(); allocObject(f, Tag.Int, 0, 24).set(p); f.get(p).get(0).store64(16).get(p); } }
  if (fs.has('bool')) { f = fs.get('bool'); f.i32(constants.true).i32(constants.false).get(0).add(0x1b); }
  if (fs.has('invoke')) { f = fs.get('invoke'); {
    const result = f.local(); f.call('tick').gget(G.depth).i32(256).add(0x4f); failIf(f, 9);
    f.gget(G.depth).i32(1).add(0x6a).gset(G.depth);
    f.get(0).i32(Tag.Closure).call('kind').drop(); f.get(0).get(1).get(0).load(8).indirect(sig).set(result);
    f.gget(G.depth).i32(1).add(0x6b).gset(G.depth).get(result);
  } }
  if (fs.has('field')) { f = fs.get('field'); {
    const i = f.local(), len = f.local(), entry = f.local(); f.get(0).i32(Tag.Record).call('kind').load(4).set(len);
    f.block().loop().get(i).get(len).add(0x4f).brIf(1).call('tick');
    f.get(0).i32(16).add(0x6a).get(i).i32(8).add(0x6c, 0x6a).tee(entry).load().get(1).add(0x46).if();
    f.get(entry).load(4).ret().end(); f.get(i).i32(1).add(0x6a).set(i).br(0).end().end();
    f.i32(6).call('trap').add(0x00);
  } }
  if (fs.has('neg')) { f = fs.get('neg'); { const a = f.local(I64); f.get(0).call('integer').tee(a).i64(-(1n << 63n)).add(0x51); failIf(f, 1);
    f.i64(0).get(a).add(0x7d).call('box'); }
  }
  if (fs.has('not')) { f = fs.get('not'); f.get(0).call('boolean').add(0x45).call('bool'); }
  for (const [name, op] of [['add', 0x7c], ['sub', 0x7d], ['mul', 0x7e], ['div', 0x7f], ['mod', 0x81],
    ['eq', 0x51], ['ne', 0x52], ['lt', 0x53], ['le', 0x57], ['gt', 0x55], ['ge', 0x59]]) {
    if (!fs.has(name)) continue;
    f = fs.get(name); const a = f.local(I64), b = f.local(I64), r = f.local(I64);
    f.get(0).call('integer').set(a); f.get(1).call('integer').set(b);
    if (name === 'div' || name === 'mod') { f.get(b).add(0x50); failIf(f, name === 'div' ? 2 : 3); }
    if (name === 'div' || name === 'mul') {
      f.get(a).i64(-(1n << 63n)).add(0x51).get(b).i64(-1).add(0x51, 0x71); failIf(f, 1);
      if (name === 'mul') { f.get(b).i64(-(1n << 63n)).add(0x51).get(a).i64(-1).add(0x51, 0x71); failIf(f, 1); }
    }
    f.get(a).get(b).add(op);
    if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(name)) { f.call('bool'); continue; }
    f.set(r);
    if (name === 'add') { f.get(a).get(r).add(0x85).get(b).get(r).add(0x85, 0x83).i64(0).add(0x53); failIf(f, 1); }
    if (name === 'sub') { f.get(a).get(b).add(0x85).get(a).get(r).add(0x85, 0x83).i64(0).add(0x53); failIf(f, 1); }
    if (name === 'mul') { f.get(b).i64(0).add(0x52).if(); f.get(r).get(b).add(0x7f).get(a).add(0x52); failIf(f, 1); f.end(); }
    f.get(r).call('box');
  }
  // Curried primitives use precisely the same captured-environment ABI as source lambdas.
  const curry = (name, next, count) => {
    if (!fs.has(name)) return;
    const x = fs.get(name), p = x.local(); allocObject(x, Tag.Closure, count, 16 + 4 * count).set(p);
    x.get(p).i32(m.functionId(next)).store(8);
    for (let i = 0; i < count - 1; i++) x.get(p).i32(16 + 4 * i).get(0).load(16 + 4 * i).call('put');
    storeCapture(x, p, count - 1, 1); x.get(p);
  };
  curry('get1', 'get2', 1); curry('map1', 'map2', 1); curry('fold1', 'fold2', 1); curry('fold2', 'fold3', 2); curry('concat1', 'concat2', 1);
  if (fs.has('length')) { f = fs.get('length'); f.get(1).i32(Tag.Array).call('kind').load(4).add(0xad).call('box'); }
  if (fs.has('textLength')) { f = fs.get('textLength'); f.get(1).i32(Tag.Text).call('kind').load(4).add(0xad).call('box'); }
  if (fs.has('get2')) { f = fs.get('get2'); {
    const array = f.local(), index = f.local(I64); f.get(0).load(16).i32(Tag.Array).call('kind').set(array);
    f.get(1).call('integer').tee(index).i64(0).add(0x53); failIf(f, 4);
    f.get(index).get(array).load(4).add(0xad, 0x5a); failIf(f, 4);
    f.get(array).i32(16).add(0x6a).get(index).add(0xa7).i32(4).add(0x6c, 0x6a).load();
  } }
  for (const name of ['map2', 'fold3']) {
    if (!fs.has(name)) continue;
    f = fs.get(name); const len = f.local(), i = f.local(), result = f.local(), item = f.local();
    f.get(1).i32(Tag.Array).call('kind').drop(); f.get(1).load(4).set(len);
    if (name === 'map2') f.get(len).i32(4).add(0x6c).i32(16).add(0x6a).i32(Tag.Array).get(len).call('object').set(result);
    else f.get(0).load(20).set(result);
    f.block().loop().get(i).get(len).add(0x4f).brIf(1).call('tick');
    f.get(1).get(i).i32(4).add(0x6c, 0x6a).load(16).set(item);
    f.get(0).load(16);
    if (name === 'fold3') f.get(result).call('invoke');
    f.get(item).call('invoke');
    if (name === 'map2') { f.set(item); f.get(result).get(i).i32(4).add(0x6c).i32(16).add(0x6a).get(item).call('put'); }
    else f.set(result);
    f.get(i).i32(1).add(0x6a).set(i).br(0).end().end().get(result);
  }
  if (fs.has('concat2')) { f = fs.get('concat2'); {
    const a = f.local(), alen = f.local(), blen = f.local(), n = f.local(), p = f.local(), i = f.local();
    f.get(0).load(16).i32(Tag.Text).call('kind').tee(a).load(4).set(alen);
    f.get(1).i32(Tag.Text).call('kind').load(4).set(blen);
    f.get(alen).get(blen).add(0x6a).tee(n).i32(4 * 1024 * 1024).add(0x4b); failIf(f, 11);
    f.get(n).i32(16).add(0x6a).i32(Tag.Text).get(n).call('object').set(p);
    for (const [source, length, second] of [[a, alen, false], [1, blen, true]]) {
      f.i32(0).set(i).block().loop().get(i).get(length).add(0x4f).brIf(1).call('tick');
      f.get(p).get(i).add(0x6a); if (second) f.get(alen).add(0x6a);
      f.get(source).get(i).add(0x6a).load8(16).store8(16);
      f.get(i).i32(1).add(0x6a).set(i).br(0).end().end();
    } f.get(p);
  } }
  if (fs.has('set_fuel')) { f = fs.get('set_fuel'); f.get(0).i64(0).add(0x53); failIf(f, 12); f.get(0).gset(G.limit); }
  if (fs.has('error_code')) fs.get('error_code').gget(G.error);
  if (fs.has('fuel_remaining')) fs.get('fuel_remaining').gget(G.fuel);
  return new Map([...wanted].map(name => [name, m.functionId(name)]));
}
