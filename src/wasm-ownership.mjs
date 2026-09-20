/** Deterministic whole-owner blocks. No tracing, reference counts, or host allocator. */
import { I32, I64 } from './wasm-binary.mjs';
import { Tag, G } from './wasm-runtime.mjs';
export const OWNED_EXPORTS = Object.freeze({
  owned_reset: 'owner_reset', owned_live_bytes: 'owner_live',
  owned_peak_bytes: 'owner_peak', owned_reserved_bytes: 'owner_reserved', owned_reuses: 'owner_reuses',
});
const MAX = 64 * 1024 * 1024;
export function declareOwnership(m, effects) {
  const base=6+effects.operations.length;
  const globals=Object.fromEntries(['start','top','free','cursor','end','live','peak','reuses'].map((n,i)=>[n,base+i]));
  const definitions=[
    ['owner_reset',[],[]],['owner_live',[],[I32]],['owner_peak',[],[I32]],['owner_reserved',[],[I32]],['owner_reuses',[],[I32]],
    ['owner_size',[I32],[I32]],['owner_measure',[I32,I32],[I32]],['owner_copy',[I32,I32],[I32]],
    ['owner_alloc',[I32],[I32]],['owner_root',[I32],[I32]],['owner_drop',[I32],[]],
    ['owner_create',[I32],[I32]],['owner_take',[I32],[I32]],['owner_scalar',[I32],[I32]],
    ['owner_evolve',[I32,I32,I64],[I32]],
  ];
  return { globals, functions:new Map(definitions.map(([n,p,r])=>[n,m.func(n,p,r)])) };
}
const reject=(f,n=15)=>f.if().i32(n).call('trap').end();
const align=f=>f.i32(7).add(0x6a).i32(-8).add(0x71);
export function installOwnership(emitter) {
  const {functions:fs,globals:h}=emitter.ownership; const arrays=Boolean(emitter.arrays); let f;
  const isAggregate=(f,tag)=>{
    f.get(tag).i32(Tag.Array).add(0x46).get(tag).i32(Tag.Record).add(0x46,0x72);
    if(arrays)f.get(tag).i32(Tag.Slice).add(0x46,0x72).get(tag).i32(Tag.Concat).add(0x46,0x72);
  };
  const element=(f,tag,i,width)=>{
    if(arrays)f.get(tag).i32(Tag.Record).add(0x47).if(I32).get(0).get(i).add(0xad).call('array_get').else();
    f.get(0).i32(16).add(0x6a).get(i).get(width).add(0x6c,0x6a).get(width).i32(4).add(0x6b,0x6a).load();
    if(arrays)f.end();
  };
  f=fs.get('owner_reset');f.gget(h.start).gset(h.top).i32(0).gset(h.free).i32(0).gset(h.cursor).i32(0).gset(h.end).i32(0).gset(h.live);
  fs.get('owner_live').gget(h.live);fs.get('owner_peak').gget(h.peak);
  fs.get('owner_reserved').gget(h.top).gget(h.start).add(0x6b);fs.get('owner_reuses').gget(h.reuses);
  // Validate one plain boxed header and return its aligned shallow allocation size.
  f=fs.get('owner_size');{
    const tag=f.local(),len=f.local(),size=f.local();
    f.get(0).i32(16).add(0x49).get(0).i32(7).add(0x71,0x72);reject(f);
    f.get(0).i32(MAX-16).add(0x4b);reject(f);
    f.get(0).load().set(tag);f.get(0).load(4).set(len);
    f.get(tag).i32(Tag.Int).add(0x46).if();f.i32(24).set(size);
    f.else().get(tag).i32(Tag.Unit).add(0x46).get(tag).i32(Tag.Bool).add(0x46,0x72).if();f.i32(16).set(size);
    f.else().get(tag).i32(Tag.Text).add(0x46).if();
    f.get(len).i32(4*1024*1024).add(0x4b);reject(f,7);f.get(len).i32(16).add(0x6a);align(f).set(size);
    f.else();
    f.get(tag).i32(Tag.Array).add(0x47).get(tag).i32(Tag.Record).add(0x47,0x71);
    if(arrays)f.get(tag).i32(Tag.Slice).add(0x47,0x71).get(tag).i32(Tag.Concat).add(0x47,0x71);reject(f);
    f.get(len).i32(1_000_000).add(0x4b);reject(f,7);
    f.get(tag).i32(Tag.Record).add(0x46).if(I32).i32(8).else().i32(4).end().get(len).add(0x6c).i32(16).add(0x6a);align(f).set(size);
    f.end().end().end();
    f.get(0);
    if(arrays)f.get(tag).i32(Tag.Slice).add(0x46).get(tag).i32(Tag.Concat).add(0x46,0x72).if(I32).i32(32).else();
    f.get(size);if(arrays)f.end();
    f.add(0x6a).add(0x3f,0).i32(16).add(0x74,0x4b);reject(f);f.get(size);
  }
  f=fs.get('owner_measure');{
    const size=f.local(),tag=f.local(),n=f.local(),i=f.local(),width=f.local();
    f.call('tick').get(1).i32(128).add(0x4b);reject(f,10);
    f.get(0).call('owner_size').set(size);f.get(0).load().set(tag);
    isAggregate(f,tag);f.if();
    f.get(0).load(4).set(n);f.get(tag).i32(Tag.Record).add(0x46).if(I32).i32(8).else().i32(4).end().set(width);
    f.block().loop().get(i).get(n).add(0x4f).brIf(1);
    element(f,tag,i,width);
    f.get(1).i32(1).add(0x6a).call('owner_measure').get(size).add(0x6a).tee(size).i32(MAX-32).add(0x4b);reject(f,7);
    f.get(i).i32(1).add(0x6a).set(i).br(0).end().end().end().get(size);
  }
  f=fs.get('owner_alloc');{
    const p=f.local(),prev=f.local(),need=f.local(),cap=f.local(),end=f.local(),pages=f.local();
    f.get(0).i32(MAX-32).add(0x4b);reject(f,7);f.get(0).i32(32).add(0x6a).set(need);
    f.gget(h.free).set(p);
    f.block().loop().get(p).add(0x45).brIf(1).call('tick');
    f.get(p).load().get(need).add(0x4f).brIf(1);
    f.get(p).set(prev).get(p).load(8).set(p).br(0).end().end();
    f.get(p).if();
    f.get(prev).if().get(prev).get(p).load(8).store(8).else().get(p).load(8).gset(h.free).end();
    f.get(p).load().set(cap);f.gget(h.reuses).i32(1).add(0x6a).gset(h.reuses);
    f.else();
    f.gget(h.top).set(p);f.get(need).set(cap);f.get(p).get(cap).add(0x6a).tee(end).i32(MAX).add(0x4b);reject(f,7);
    f.get(end).i32(65535).add(0x6a).i32(16).add(0x76).set(pages);
    f.get(pages).add(0x3f,0,0x4b).if();f.get(pages).add(0x3f,0,0x6b,0x40,0).i32(-1).add(0x46);reject(f,7);f.end();
    f.get(end).gset(h.top);f.end();
    f.get(p).get(cap).store();f.get(p).i32(1).store(4);f.get(p).i32(0).store(8);
    f.get(p).get(0).store(12);f.get(p).get(p).i32(32).add(0x6a).store(16);
    for(const offset of [20,24,28])f.get(p).i32(0).store(offset);
    f.gget(h.live).get(cap).add(0x6a).gset(h.live);
    f.gget(h.live).gget(h.peak).add(0x4b).if().gget(h.live).gset(h.peak).end();f.get(p);
  }
  f=fs.get('owner_root');{
    f.get(0).gget(h.start).add(0x49).get(0).gget(h.top).add(0x4f,0x72).get(0).i32(7).add(0x71,0x72);reject(f);
    f.get(0).load(4).i32(1).add(0x47);reject(f);
    f.get(0).load().i32(32).add(0x49);reject(f);
    f.get(0).get(0).load().add(0x6a).gget(h.top).add(0x4b);reject(f);
    f.get(0).load(16).get(0).i32(32).add(0x6a,0x47);reject(f);f.get(0).load(16);
  }
  f=fs.get('owner_drop');{
    f.get(0).if();f.get(0).call('owner_root').drop();
    f.get(0).i32(0).store(4);f.get(0).gget(h.free).store(8);f.get(0).gset(h.free);
    f.gget(h.live).get(0).load().add(0x6b).gset(h.live);f.end();
  }
  f=fs.get('owner_copy');{
    const size=f.local(),p=f.local(),tag=f.local(),n=f.local(),i=f.local(),width=f.local(),offset=f.local(),value=f.local();
    f.call('tick').get(1).i32(128).add(0x4b);reject(f,10);f.get(0).call('owner_size').set(size);
    f.gget(h.end).if();
    f.gget(h.cursor).set(p);f.get(p).get(size).add(0x6a).gget(h.end).add(0x4b);reject(f,7);
    f.get(p).get(size).add(0x6a).gset(h.cursor);
    f.else().get(size).call('alloc').set(p).end();
    // Charge copied bytes as well as visited nodes: one large Text must not
    // turn a small fuel allowance into unbounded repeated bulk memory work.
    f.gget(G.fuel).get(size).add(0xad,0x54).if();
    f.i64(0).gset(G.fuel).i32(8).call('trap').end();
    f.gget(G.fuel).get(size).add(0xad,0x7d).gset(G.fuel);
    if(arrays){
      f.get(0).load().set(tag);
      f.get(tag).i32(Tag.Slice).add(0x46).get(tag).i32(Tag.Concat).add(0x46,0x72).if();
      f.get(p).i32(Tag.Array).store();f.get(p).get(0).load(4).store(4);f.get(p).i32(0).store(8);f.get(p).i32(0).store(12);
      f.else();
    }
    f.get(p).get(0).get(size).add(0xfc,0x0a,0,0);
    if(arrays)f.end();else f.get(0).load().set(tag);
    isAggregate(f,tag);f.if();if(arrays)f.get(p).i32(0).store(12);
    f.get(0).load(4).set(n);f.get(tag).i32(Tag.Record).add(0x46).if(I32).i32(8).else().i32(4).end().set(width);
    f.block().loop().get(i).get(n).add(0x4f).brIf(1);
    f.get(i).get(width).add(0x6c).i32(16).add(0x6a).get(width).i32(4).add(0x6b,0x6a).set(offset);
    if(arrays)element(f,tag,i,width);else f.get(0).get(offset).add(0x6a).load();
    f.get(1).i32(1).add(0x6a).call('owner_copy').set(value);
    f.get(p).get(offset).add(0x6a).get(value).store();
    if(arrays){
      f.get(value).load(12).i32(1).add(0x6a).get(p).load(12).add(0x4b).if();
      f.get(p).get(value).load(12).i32(1).add(0x6a).store(12);f.end();
    }
    f.get(i).i32(1).add(0x6a).set(i).br(0).end().end().end();f.get(p);
  }
  f=fs.get('owner_create');{
    const size=f.local(),p=f.local();f.get(0).i32(0).call('owner_measure').set(size);
    f.get(size).call('owner_alloc').set(p);f.get(p).i32(32).add(0x6a).gset(h.cursor);
    f.get(p).i32(32).add(0x6a).get(size).add(0x6a).gset(h.end);
    f.get(0).i32(0).call('owner_copy').drop();
    f.gget(h.cursor).gget(h.end).add(0x47);reject(f);
    f.i32(0).gset(h.cursor).i32(0).gset(h.end).get(p);
  }
  f=fs.get('owner_take');{
    const p=f.local();f.get(0).call('owner_root').i32(0).call('owner_copy').set(p);f.get(0).call('owner_drop').get(p);
  }
  f=fs.get('owner_scalar');{
    const size=f.local(),p=f.local();
    f.get(0).load().i32(Tag.Bool).add(0x4b);reject(f);
    f.get(0).call('owner_size').tee(size).call('alloc').set(p);f.get(p).get(0).get(size).add(0xfc,0x0a,0,0).get(p);
  }
  f=fs.get('owner_evolve');{
    const i=f.local(I64),mark=f.local(),next=f.local(),site=f.local();
    f.get(2).i64(0).add(0x53);reject(f,16);f.gget(G.position).set(site);
    f.block().loop().get(i).get(2).add(0x5a).brIf(1);
    f.get(site).gset(G.position).call('tick');f.gget(G.heap).set(mark);
    f.get(1).get(0).call('owner_root').call('invoke');
    f.get(site).gset(G.position).call('owner_create').set(next);
    f.get(0).call('owner_drop');f.get(mark).gset(G.heap);f.get(next).set(0);
    f.get(i).i64(1).add(0x7c).set(i).br(0).end().end().get(0);
  }
}
export function emitOwnership(emitter,e,f,scope) {
  const {globals:h}=emitter.ownership;
  const moved=()=>{const loc=scope.get(e.ownerBinder);if(!loc||loc.capture)throw new Error('invalid owning local');f.get(loc.index).i32(0).set(loc.index);};
  switch(e.kind) {
    case 'Move': moved();break;
    case 'Drop': moved();f.call('owner_drop').i32(emitter.constants.unit);break;
    case 'Snapshot': emitter.load(e.ownerBinder,f,scope);f.call('owner_root').call('owner_create');break;
    case 'Own': {const mark=f.local(),owner=f.local();f.gget(G.heap).set(mark);emitter.expression(e.a,f,scope);f.i32(e.pos).gset(G.position).call('owner_create').set(owner);f.get(mark).gset(G.heap).get(owner);break;}
    case 'Take': emitter.expression(e.a,f,scope);f.i32(e.pos).gset(G.position).call('owner_take');break;
    case 'Borrow': {
      const view=f.local();emitter.load(e.ownerBinder,f,scope);f.call('owner_root').set(view);
      const inner=new Map(scope);inner.set(e.binder,{capture:false,index:view});emitter.expression(e.b,f,inner);
      if(e.borrowScalar)f.i32(e.pos).gset(G.position).call('owner_scalar');break;
    }
    case 'Update': case 'Evolve': {
      const owner=f.local(),count=f.local(I64),fn=f.local();emitter.expression(e.a,f,scope);f.set(owner);
      if(e.kind==='Evolve'){emitter.expression(e.b,f,scope);f.call('integer');}else f.i64(1);f.set(count);
      emitter.expression(e.kind==='Evolve'?e.c:e.b,f,scope);f.set(fn);
      f.get(owner).get(fn).get(count).i32(e.pos).gset(G.position).call('owner_evolve');break;
    }
    default:throw new Error('unknown ownership lowering');
  }
}
