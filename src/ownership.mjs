/** Affine isolated data owners and lexical read loans; no whole-program alias search. */
import { NONE, LIMITS, enter, fail } from './core.mjs';
const rejected = (pos, message) => fail(pos, message, 'E_OWNERSHIP');
const unsupported = (pos, message) => fail(pos, message, 'E_OWNERSHIP_UNSUPPORTED');
export class Ownership {
  depth = 0; steps = 0; frame = 0; nextFrame = 1; owners = new Map(); env = new Map(); containsCache = new Map(); plainCache = new Set();
  constructor(ast, types) { this.ast = ast; this.types = types; }
  step(pos = 0) { if (++this.steps > LIMITS.proofSteps) fail(pos, 'ownership work limit exceeded', 'E_LIMIT'); }
  type(id) { return this.types.nodes[this.types.find(id)]; }
  own(id) { return this.type(id).kind === 'Owned'; }
  contains(id, arrows = true, seen = new Set()) {
    this.step(); enter(this);
    try {
      id = this.types.find(id); const key = id * 2 + Number(arrows);
      if (this.containsCache.has(key)) return this.containsCache.get(key);
      if (seen.has(id)) return false; seen.add(id);
      const t = this.type(id);
      const out = t.kind === 'Owned' || ((arrows || t.kind !== 'Function') && (
        (t.a !== NONE && this.contains(t.a, arrows, seen)) ||
        (t.b !== NONE && this.contains(t.b, arrows, seen)) || t.fields.some(([,v]) => this.contains(v, arrows, seen))));
      this.containsCache.set(key, out); return out;
    } finally { this.depth--; }
  }
  plain(id, pos, seen = new Set()) {
    this.step(pos); enter(this,pos);
    try {
      id = this.types.find(id); if (this.plainCache.has(id) || seen.has(id)) return; seen.add(id);
      const t = this.type(id);
      if (['Int','Bool','Text','Unit'].includes(t.kind)) { this.plainCache.add(id); return; }
      if (t.kind === 'Array') { this.plain(t.a, pos, seen); this.plainCache.add(id); return; }
      if (t.kind === 'Record') {
        const row = this.types.flatten(t.a, pos);
        if (row.tail !== NONE) unsupported(pos, 'owned data requires a closed record shape');
        for (const [,v] of row.fields) this.plain(v, pos, seen); this.plainCache.add(id); return;
      }
      unsupported(pos, 'owned storage supports closed plain data, not functions, nested owners or unknown shapes');
    } finally { this.depth--; }
  }
  signature(summary, id, pos) {
    if (!this.contains(id)) return;
    const t = this.type(id);
    if (t.kind === 'Owned') return;
    if (t.kind === 'Record' && summary?.kind === 'Record') {
      for (const [n,ty] of this.types.flatten(t.a, pos).fields) this.signature(summary.fields.get(n), ty, pos); return;
    }
    if (t.kind !== 'Function' || summary?.kind !== 'Function')
      unsupported(pos, 'ownership-bearing callable needs a statically checked function summary');
    const e = this.ast.nodes[summary.node];
    if (this.own(t.a) !== this.own(e.paramType) || this.own(t.b) !== this.own(this.ast.nodes[e.a].type))
      unsupported(pos, 'generic substitution cannot invent a consuming ownership interface');
    if (!this.own(t.a) && this.contains(t.a))
      unsupported(pos, 'higher-order ownership parameters are not supported yet');
    if (!this.own(t.b) && this.contains(t.b)) this.signature(summary.result, t.b, pos);
  }
  selector(e, consume = false) {
    const v = this.ast.nodes[e.a]; this.step(e.pos);
    if (v.kind !== 'Var') rejected(e.pos, 'ownership operation requires an owner binding');
    const state = this.owners.get(v.binder);
    if (!state) rejected(e.pos, 'not an owner binding');
    if (state.frame !== this.frame) unsupported(e.pos, 'closures cannot capture owning bindings; borrow or pass an owner explicitly');
    if (state.moved) rejected(e.pos, 'use after move or drop');
    if (consume && state.loans) rejected(e.pos, 'cannot consume an owner while a read borrow is active');
    if (consume) state.moved = true;
    e.ownerBinder = v.binder; return state;
  }
  fork() { return new Map([...this.owners].map(([id,state]) => [id,{...state}])); }
  merge(a, b, pos) {
    for (const [id,x] of a) { this.step(pos); const y=b.get(id);
      if (!y || x.moved !== y.moved || x.loans !== y.loans)
        rejected(pos, 'continuing branches must consume the same owners');
    }
    this.owners = a;
  }
  expression(id) {
    const e=this.ast.nodes[id]; enter(this,e.pos); this.step(e.pos);
    try {
      // Owning payloads may not hide beneath ordinary structural containers.
      if (!this.own(e.type) && this.contains(e.type,false)) unsupported(e.pos,'owners cannot be stored in ordinary records or arrays');
      switch(e.kind) {
        case 'Int': case 'Bool': case 'Text': case 'Unit': return null;
        case 'Var':
          if(this.own(e.type)) rejected(e.pos,'an owner must be moved, borrowed, snapshotted or dropped explicitly');
          return this.env.get(e.binder) ?? null;
        case 'ArraySet': {
          this.expression(e.a); this.expression(e.b); this.expression(e.c);
          const element = this.type(this.type(this.type(e.type).a).a);
          if (!['Int','Bool','Unit'].includes(element.kind))
            unsupported(e.pos,'in-place array set currently requires Int, Bool or Unit elements');
          return null;
        }
        case 'ArrayGet': case 'ArraySlice': case 'ArrayConcat': case 'ArrayMaterialize': {
          this.expression(e.a); if (e.b !== NONE) this.expression(e.b); if (e.c !== NONE) this.expression(e.c);
          // No owning callable may be hidden in an array view.
          if (this.contains(e.type)) unsupported(e.pos,'array views cannot carry ownership-bearing interfaces');
          return null;
        }
        case 'Own': this.expression(e.a); this.plain(this.ast.nodes[e.a].type,e.pos); return null;
        case 'Move': this.selector(e,true); return null;
        case 'Drop': this.selector(e,true); return null;
        case 'Snapshot': this.selector(e); return null;
        case 'Take': this.expression(e.a); this.plain(e.type,e.pos); return null;
        case 'Borrow': {
          const state=this.selector(e); state.loans++;
          const summary=this.expression(e.b); this.owners.get(e.ownerBinder).loans--;
          const out=this.type(e.type);
          if(!['Int','Bool','Unit','Owned'].includes(out.kind))
            rejected(e.pos,'a read borrow may return only copied scalars or an independent owner');
          e.borrowScalar = out.kind !== 'Owned'; return summary;
        }
        case 'Update': case 'Evolve': {
          this.expression(e.a); this.plain(this.type(e.type).a,e.pos);
          if(e.kind==='Evolve')this.expression(e.b);
          this.expression(e.kind==='Evolve'?e.c:e.b); return null;
        }
        case 'Lambda': {
          const previousFrame=this.frame; this.frame=this.nextFrame++;
          const owned=this.own(e.paramType); e.ownedParam=owned;
          if(!owned && this.contains(e.paramType)) unsupported(e.pos,'higher-order ownership parameters need a future usage contract');
          if(owned)this.owners.set(e.binder,{moved:false,loans:0,frame:this.frame});
          let result;
          try { result=this.expression(e.a); }
          finally { if(owned)this.owners.delete(e.binder);this.frame=previousFrame; }
          return {kind:'Function',node:id,result};
        }
        case 'Call': {
          const fn=this.expression(e.a); this.expression(e.b);
          const arrow=this.type(this.ast.nodes[e.a].type);
          this.signature(fn,this.ast.nodes[e.a].type,e.pos);
          if(!this.own(arrow.a) && this.contains(arrow.a)) unsupported(e.pos,'cannot pass an ownership-bearing callable through an unknown usage interface');
          return fn?.kind==='Function'?fn.result:null;
        }
        case 'Record': {
          const fields=new Map();for(const [n,x]of e.fields)fields.set(n,this.expression(x));
          const result={kind:'Record',fields};this.signature(result,e.type,e.pos);return result;
        }
        case 'Array': {
          for(const x of e.items)this.expression(x);
          if(this.contains(e.type))unsupported(e.pos,'arrays of ownership-bearing callables need a future usage contract');
          return null;
        }
        case 'Field': { const r=this.expression(e.a);const out=r?.kind==='Record'?r.fields.get(e.name):null;this.signature(out,e.type,e.pos);return out; }
        case 'Unary': this.expression(e.a);return null;
        case 'Binary': {
          this.expression(e.a);
          if(e.text==='&&'||e.text==='||') { const before=this.fork();this.expression(e.b);this.merge(before,this.owners,e.pos); }
          else this.expression(e.b);return null;
        }
        case 'If': {
          this.expression(e.a);const before=this.fork();const a=this.expression(e.b),left=this.fork();
          this.owners=before;const b=this.expression(e.c);this.merge(left,this.owners,e.pos);
          if(this.contains(e.type)&&!this.own(e.type)&&a!==b)unsupported(e.pos,'branch-selected ownership callables need a common usage contract');
          return a===b?a:null;
        }
        case 'Block': {
          const locals=[];
          try {
            for(const b of e.bindings) {
              const summary=this.expression(b.expr);this.signature(summary,this.ast.nodes[b.expr].type,b.pos);
              this.env.set(b.binder,summary);
              b.owned=this.own(this.ast.nodes[b.expr].type);
              if(b.owned){this.owners.set(b.binder,{moved:false,loans:0,frame:this.frame});locals.push(b.binder);}
            }
            return this.expression(e.a);
          } finally { for(const binder of locals)this.owners.delete(binder); }
        }
        case 'Effect':
          if(this.contains(e.type))unsupported(e.pos,'operation contracts cannot contain owners yet');return null;
        case 'Host': this.expression(e.a);return null;
        case 'Handle': this.expression(e.a);this.expression(e.b);return this.expression(e.c);
        default: unsupported(e.pos,'unsupported ownership construct '+e.kind);
      }
    } finally {this.depth--;}
  }
  run() {
    this.expression(this.ast.root);
    if(this.own(this.ast.nodes[this.ast.root].type))rejected(0,'an owner cannot escape main; take a detached value first');
    return {steps:this.steps};
  }
}
