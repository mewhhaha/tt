/** Immutable zero-element-copy array views and consuming scalar writes, lowered to Wasm. */
import { I32, I64 } from './wasm-binary.mjs';
import { Tag, G } from './wasm-runtime.mjs';
export const ARRAY_KINDS = new Set(['ArrayGet','ArraySlice','ArrayConcat','ArraySet','ArrayMaterialize']);
export const MAX_ARRAY_LENGTH = 1_000_000, MAX_VIEW_HEIGHT = 64;
export function declareArrays(m, owned) {
  const definitions = [
    ['array_count',[I32],[I32]], ['array_height',[I32],[I32]], ['array_get',[I32,I64],[I32]],
    ['array_slice',[I32,I64,I64],[I32]], ['array_concat',[I32,I32],[I32]], ['array_materialize',[I32],[I32]],
    ...(owned ? [['owner_array_set',[I32,I64,I32],[I32]]] : []),
  ];
  return new Map(definitions.map(([name,p,r])=>[name,m.func(name,p,r)]));
}
const reject=(f,code=4)=>f.if().i32(code).call('trap').end();
export function installArrays(emitter) {
  const fs=emitter.arrays; let f;
  f=fs.get('array_count'); {
    const tag=f.local(),len=f.local();
    f.get(0).load().set(tag);
    f.get(tag).i32(Tag.Array).add(0x47).get(tag).i32(Tag.Slice).add(0x47,0x71).get(tag).i32(Tag.Concat).add(0x47,0x71);reject(f,5);
    f.get(0).load(4).tee(len).i32(MAX_ARRAY_LENGTH).add(0x4b);reject(f,17);f.get(len);
  }
  f=fs.get('array_height');
  f.get(0).load().i32(Tag.Array).add(0x46).if(I32).i32(0).else().get(0).load(24).end();
  f=fs.get('array_get'); {
    const index=f.local(),tag=f.local(),left=f.local(),count=f.local();
    f.get(1).i64(0).add(0x53);reject(f);
    f.get(1).get(0).call('array_count').add(0xad,0x5a);reject(f);
    f.get(1).add(0xa7).set(index);
    f.loop();
    f.call('tick');f.get(0).load().set(tag);
    f.get(tag).i32(Tag.Array).add(0x46).if();f.get(0).get(index).i32(4).add(0x6c,0x6a).load(16).ret().end();
    f.get(tag).i32(Tag.Slice).add(0x46).if();
    f.get(index).get(0).load(20).add(0x6a).set(index);f.get(0).load(16).set(0);
    f.else();
    f.get(tag).i32(Tag.Concat).add(0x47);reject(f,5);
    f.get(0).load(16).tee(left).load(4).set(count);
    f.get(index).get(count).add(0x49).if().get(left).set(0);
    f.else().get(index).get(count).add(0x6b).set(index).get(0).load(20).set(0).end();
    f.end().br(0).end().add(0x00);
  }
  f=fs.get('array_slice'); {
    const len=f.local(),start=f.local(),count=f.local(),p=f.local(),height=f.local();
    f.get(0).call('array_count').set(len);
    f.get(1).i64(0).add(0x53).get(2).get(1).add(0x53,0x72).get(2).get(len).add(0xad,0x56,0x72);reject(f);
    f.get(1).add(0x50).get(2).get(len).add(0xad,0x51,0x71).if().get(0).ret().end();
    f.get(1).add(0xa7).set(start);f.get(2).get(1).add(0x7d,0xa7).set(count);
    // Collapse slice-of-slice. Neither bounds checking nor construction visits elements.
    f.get(0).load().i32(Tag.Slice).add(0x46).if();
    f.get(start).get(0).load(20).add(0x6a).set(start);f.get(0).load(16).set(0);f.end();
    f.get(0).call('array_height').i32(1).add(0x6a).tee(height).i32(MAX_VIEW_HEIGHT).add(0x4b);reject(f,17);
    f.i32(32).i32(Tag.Slice).get(count).call('object').set(p);
    f.get(p).get(0).load(12).store(12);
    f.get(p).get(0).store(16);f.get(p).get(start).store(20);f.get(p).get(height).store(24);f.get(p).i32(0).store(28);f.get(p);
  }
  f=fs.get('array_concat'); {
    const a=f.local(),b=f.local(),n=f.local(),left=f.local(),right=f.local(),ls=f.local(),rs=f.local(),height=f.local(),p=f.local();
    f.get(0).call('array_count').set(a);f.get(1).call('array_count').set(b);
    f.get(a).add(0x45).if().get(1).ret().end();f.get(b).add(0x45).if().get(0).ret().end();
    f.get(a).get(b).add(0x6a).tee(n).i32(MAX_ARRAY_LENGTH).add(0x4b);reject(f,17);
    f.get(0).set(left);f.get(1).set(right);
    f.get(left).load().i32(Tag.Slice).add(0x46).if();f.get(left).load(20).set(ls);f.get(left).load(16).set(left);f.end();
    f.get(right).load().i32(Tag.Slice).add(0x46).if();f.get(right).load(20).set(rs);f.get(right).load(16).set(right);f.end();
    // Adjacent windows on the same base merge into one window, or the original array.
    f.get(left).get(right).add(0x46).get(ls).get(a).add(0x6a).get(rs).add(0x46,0x71).if();
    f.get(left).get(ls).add(0xad).get(rs).get(b).add(0x6a,0xad).call('array_slice').ret().end();
    f.get(0).call('array_height').set(height);f.get(1).call('array_height').tee(b).get(height).add(0x4b).if().get(b).set(height).end();
    f.get(height).i32(1).add(0x6a).tee(height).i32(MAX_VIEW_HEIGHT).add(0x4b);reject(f,17);
    f.i32(32).i32(Tag.Concat).get(n).call('object').set(p);
    f.get(0).load(12).set(a);f.get(1).load(12).set(b);
    f.get(p).get(a).get(b).get(a).get(b).add(0x4b,0x1b).store(12);
    f.get(p).get(0).store(16);f.get(p).get(1).store(20);f.get(p).get(height).store(24);f.get(p).i32(0).store(28);f.get(p);
  }
  f=fs.get('array_materialize'); {
    const len=f.local(),p=f.local(),i=f.local(),value=f.local();
    f.get(0).call('array_count').set(len);
    // Already flat data requires no new representation.
    f.get(0).load().i32(Tag.Array).add(0x46).if().get(0).ret().end();
    f.get(len).i32(4).add(0x6c).i32(16).add(0x6a).i32(Tag.Array).get(len).call('object').set(p);
    f.block().loop().get(i).get(len).add(0x4f).brIf(1);
    f.get(0).get(i).add(0xad).call('array_get').set(value);
    f.get(p).get(i).i32(4).add(0x6c).i32(16).add(0x6a).get(value).call('put');
    f.get(i).i32(1).add(0x6a).set(i).br(0).end().end().get(p);
  }
  if(fs.has('owner_array_set')) { f=fs.get('owner_array_set');
    const root=f.local(),cell=f.local(),size=f.local(),old=f.local();
    f.get(0).call('owner_root').set(root);
    f.get(root).load().i32(Tag.Array).add(0x47);reject(f,15);
    f.get(root).get(1).call('array_get').set(cell);
    f.get(cell).load().i32(Tag.Bool).add(0x4b);reject(f,15);
    f.get(cell).load().get(2).load().add(0x47);reject(f,15);
    f.get(2).call('owner_size').set(size);
    if(!emitter.optimize) {
      // Reference lowering copies the owner. Checks are identical; allocation/fuel cost is not.
      f.get(0).set(old);f.get(root).call('owner_create').set(0);
      f.get(0).call('owner_root').get(1).call('array_get').set(cell);
    }
    // Ownership copying expands aliases; each scalar cell in this owned array is exclusive.
    // Complete validation and fuel charging happen before changing bytes.
    f.gget(G.fuel).get(size).add(0xad,0x54).if().i64(0).gset(G.fuel).i32(8).call('trap').end();
    f.gget(G.fuel).get(size).add(0xad,0x7d).gset(G.fuel);
    f.get(cell).get(2).get(size).add(0xfc,0x0a,0,0);
    if(!emitter.optimize)f.get(old).call('owner_drop');
    f.get(0);
  }
}
export function emitArray(emitter,e,f,scope) {
  // A set returns only an isolated owner. Its argument boxes/closures cannot escape
  // into that owner's scalar cells, so reclaim the complete argument scratch prefix.
  const mark=e.kind==='ArraySet'?f.local():null;
  if(mark!==null)f.gget(G.heap).set(mark);
  emitter.expression(e.a,f,scope);
  if(e.b>=0) { emitter.expression(e.b,f,scope); if(e.kind!=='ArrayConcat')f.call('integer'); }
  if(e.c>=0) { emitter.expression(e.c,f,scope); if(e.kind==='ArraySlice')f.call('integer'); }
  f.i32(e.pos).gset(G.position).call({ArrayGet:'array_get',ArraySlice:'array_slice',ArrayConcat:'array_concat',ArraySet:'owner_array_set',ArrayMaterialize:'array_materialize'}[e.kind]);
  if(mark!==null){const owner=f.local();f.set(owner).get(mark).gset(G.heap).get(owner);}
}
