/** Synchronous effect operations lower to Wasm dispatch and explicitly typed imports. */
import { I32, I64 } from './wasm-binary.mjs';
import { Tag, G } from './wasm-runtime.mjs';

export const HOST_MODULE = 'tt.host';
export function wireContract(c) {
  return c.kind === 'Int' ? { kind: 'Int', ranges: c.range.parts.map(([lo, hi]) => [String(lo), String(hi)]) } : { kind: c.kind };
}
export function hostSignature(spec) {
  const a = spec.input.kind, b = spec.output.kind;
  return { params: a === 'Unit' ? [] : a === 'Text' ? [I32, I32] : [a === 'Int' ? I64 : I32],
    results: b === 'Unit' ? [] : [b === 'Int' ? I64 : I32] };
}
export function hostSpecifications(effects) {
  return effects.hosts.map(op => ({ key: op.key, input: wireContract(op.contract.a), output: wireContract(op.contract.b) }));
}
export function declareEffectImports(m, specs) {
  for (const spec of specs) {
    const { params, results } = hostSignature(spec);
    m.importFunction('host:' + spec.key, HOST_MODULE, spec.key, params, results);
  }
}
const reject = (f, code) => f.if().i32(code).call('trap').end();
export function installEffectOperations(emitter, effects) {
  const { m, data, constants } = emitter;
  emitter.effectGlobals = new Map(); emitter.effectPointers = new Map(); emitter.hostPointers = new Map();
  for (const [index, op] of effects.operations.entries()) {
    const global = 6 + index; emitter.effectGlobals.set(op.key, global);
    const f = m.func('effect:' + op.key, [I32, I32]), frame = f.local(), previous = f.local(), value = f.local();
    f.gget(global).tee(frame).i32(constants.unit).add(0x46); reject(f, 13);
    f.get(frame).load(20).tee(previous).gset(global);
    f.get(frame).load(16).get(1).call('invoke').set(value);
    f.get(frame).gset(global).get(value);
    emitter.effectPointers.set(op.key, data.add('effect:' + op.key, Tag.Closure, 0, f.index));
  }
  for (const op of effects.hosts) {
    const f = m.func('host-wrapper:' + op.key, [I32, I32]), a = op.contract.a, b = op.contract.b;
    if (a.kind === 'Int') f.get(1).call('integer');
    else if (a.kind === 'Bool') f.get(1).call('boolean');
    else if (a.kind === 'Unit') f.get(1).i32(Tag.Unit).call('kind').drop();
    else { f.get(1).i32(Tag.Text).call('kind').i32(16).add(0x6a).get(1).load(4); }
    // A throwing host call cannot reach the Wasm trap helper. Preserve its site first.
    f.i32(8).gget(G.position).store().call('host:' + op.key);
    if (b.kind === 'Unit') f.i32(constants.unit);
    else if (b.kind === 'Bool') {
      const value = f.local(); f.tee(value).i32(1).add(0x4b); reject(f, 14); f.get(value).call('bool');
    } else {
      const value = f.local(I64); f.set(value);
      if (!b.range.full) {
        f.i32(0);
        for (const [lo, hi] of b.range.parts) f.get(value).i64(lo).add(0x59).get(value).i64(hi).add(0x57, 0x71, 0x72);
        f.add(0x45); reject(f, 14);
      }
      f.get(value).call('box');
    }
    emitter.hostPointers.set(op.key, data.add('host:' + op.key, Tag.Closure, 0, f.index));
  }
}
export function emitHandler(emitter, e, f, scope) {
  const global = emitter.effectGlobals.get(e.effectKey), handler = f.local(), previous = f.local(), frame = f.local(), output = f.local();
  emitter.expression(e.a, f, scope); f.drop(); emitter.expression(e.b, f, scope); f.set(handler);
  f.gget(global).set(previous); emitter.object(f, Tag.Array, 2, 24); f.set(frame);
  f.get(frame).i32(16).get(handler).call('put'); f.get(frame).i32(20).get(previous).call('put');
  f.get(frame).gset(global); emitter.expression(e.c, f, scope); f.set(output);
  f.get(previous).gset(global).get(output);
}
