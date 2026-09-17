/** One checked implementation shared by boxed ABI wrappers and register-only regions. */
import { I64 } from './wasm-binary.mjs';
export const INTEGER_OPS = Object.freeze([
  ['add', 0x7c], ['sub', 0x7d], ['mul', 0x7e], ['div', 0x7f], ['mod', 0x81],
  ['eq', 0x51], ['ne', 0x52], ['lt', 0x53], ['le', 0x57], ['gt', 0x55], ['ge', 0x59],
]);
export const isComparison = name => ['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(name);
const failIf = (f, code) => f.if().i32(code).call('trap').end();
export function emitIntegerBinary(f, name, opcode, boxed) {
  const a = boxed ? f.local(I64) : 0, b = boxed ? f.local(I64) : 1, r = f.local(I64);
  if (boxed) { f.get(0).call('integer').set(a); f.get(1).call('integer').set(b); }
  if (name === 'div' || name === 'mod') { f.get(b).add(0x50); failIf(f, name === 'div' ? 2 : 3); }
  if (name === 'div' || name === 'mul') {
    f.get(a).i64(-(1n << 63n)).add(0x51).get(b).i64(-1).add(0x51, 0x71); failIf(f, 1);
    if (name === 'mul') { f.get(b).i64(-(1n << 63n)).add(0x51).get(a).i64(-1).add(0x51, 0x71); failIf(f, 1); }
  }
  f.get(a).get(b).add(opcode);
  if (isComparison(name)) { if (boxed) f.call('bool'); return; }
  f.set(r);
  if (name === 'add') { f.get(a).get(r).add(0x85).get(b).get(r).add(0x85, 0x83).i64(0).add(0x53); failIf(f, 1); }
  if (name === 'sub') { f.get(a).get(b).add(0x85).get(a).get(r).add(0x85, 0x83).i64(0).add(0x53); failIf(f, 1); }
  if (name === 'mul') { f.get(b).i64(0).add(0x52).if(); f.get(r).get(b).add(0x7f).get(a).add(0x52); failIf(f, 1); f.end(); }
  f.get(r); if (boxed) f.call('box');
}
export function emitIntegerNeg(f) {
  f.get(0).i64(-(1n << 63n)).add(0x51); failIf(f, 1);
  f.i64(0).get(0).add(0x7d);
}
