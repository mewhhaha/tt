import { NONE, LIMITS, fail, enter } from './core.mjs';

/** Level-based let polymorphism and structural row unification. IDs are arena offsets. */
export class Types {
  nodes = []; depth = 0;
  metrics = { unify_steps: 0, occurs_visits: 0, instantiate_visits: 0,
    generalize_visits: 0, projection_steps: 0, proof_steps: 0, refinement_substitutions: 0 };
  constructor() {
    this.integer = this.add({ kind: 'Int' }); this.boolean = this.add({ kind: 'Bool' });
    this.text = this.add({ kind: 'Text' }); this.unit = this.add({ kind: 'Unit' });
    this.emptyRow = this.add({ kind: 'Row' });
  }
  add(node) {
    if (this.nodes.length >= LIMITS.typeNodes) fail(0, 'type node limit exceeded', 'E_LIMIT');
    this.nodes.push({ a: NONE, b: NONE, level: 0, rowVar: false, fields: [], ...node });
    return this.nodes.length - 1;
  }
  fresh(level, rowVar = false) { return this.add({ kind: 'Var', level, rowVar }); }
  owned(a) { return this.add({ kind: 'Owned', a }); }
  array(a) { return this.add({ kind: 'Array', a }); }
  function(a, b) { return this.add({ kind: 'Function', a, b }); }
  row(fields, a = NONE) { return this.add({ kind: 'Row', fields, a }); }
  record(fields, tail = NONE) { return this.add({ kind: 'Record', a: this.row(fields, tail) }); }
  find(id) {
    let root = id;
    while (this.nodes[root].kind === 'Var' && this.nodes[root].a !== NONE) root = this.nodes[root].a;
    while (id !== root && this.nodes[id].kind === 'Var' && this.nodes[id].a !== NONE) {
      const next = this.nodes[id].a; this.nodes[id].a = root; id = next;
    }
    return root;
  }
  lowerAndOccurs(variable, value, level, pos) {
    const work = [value], seen = new Set();
    while (work.length) {
      const id = this.find(work.pop()); if (seen.has(id)) continue;
      seen.add(id); this.metrics.occurs_visits++;
      if (id === variable) fail(pos, 'infinite type (occurs check)');
      const t = this.nodes[id];
      if (t.kind === 'Var') t.level = Math.min(t.level, level);
      else {
        if (t.a !== NONE) work.push(t.a); if (t.b !== NONE) work.push(t.b);
        for (const [, value] of t.fields) work.push(value);
      }
    }
  }
  flatten(root, pos = 0) {
    const fields = new Map(), seen = new Set(); let id = this.find(root);
    for (;;) {
      if (seen.has(id)) fail(pos, 'cyclic row', 'E_INTERNAL'); seen.add(id);
      const t = this.nodes[id];
      if (t.kind === 'Var') return { fields, tail: id };
      if (t.kind !== 'Row') fail(pos, 'invalid row node', 'E_INTERNAL');
      for (const [name, value] of t.fields) {
        if (fields.has(name)) this.unify(fields.get(name), value, pos);
        else fields.set(name, value);
      }
      if (t.a === NONE) return { fields, tail: NONE };
      id = this.find(t.a);
    }
  }
  unifyRows(a, b, pos) {
    const { fields: af, tail: at } = this.flatten(a, pos), { fields: bf, tail: bt } = this.flatten(b, pos);
    const onlyA = [], onlyB = [];
    for (const [n, v] of af) { if (bf.has(n)) this.unify(v, bf.get(n), pos); else onlyA.push([n, v]); }
    for (const [n, v] of bf) if (!af.has(n)) onlyB.push([n, v]);
    if (!onlyA.length && !onlyB.length) { this.unify(at === NONE ? this.emptyRow : at, bt === NONE ? this.emptyRow : bt, pos); return; }
    if ((at === NONE && onlyB.length) || (bt === NONE && onlyA.length)) fail(pos, 'record does not provide the required fields');
    if (at !== NONE && bt !== NONE && this.find(at) === this.find(bt)) fail(pos, 'infinite row (incompatible fields on the same tail)');
    onlyA.sort((x, y) => x[0] - y[0]); onlyB.sort((x, y) => x[0] - y[0]);
    if (!onlyA.length) { this.unify(at, this.row(onlyB, bt), pos); return; }
    if (!onlyB.length) { this.unify(bt, this.row(onlyA, at), pos); return; }
    const level = Math.min(this.nodes[this.find(at)].level, this.nodes[this.find(bt)].level);
    const rest = this.fresh(level, true);
    this.unify(at, this.row(onlyB, rest), pos); this.unify(bt, this.row(onlyA, rest), pos);
  }
  unify(a, b, pos = 0) {
    enter(this, pos);
    try {
      this.metrics.unify_steps++; a = this.find(a); b = this.find(b); if (a === b) return;
      const x = this.nodes[a], y = this.nodes[b];
      if (x.kind === 'Var') {
        const row = y.kind === 'Row' || (y.kind === 'Var' && y.rowVar);
        if (x.rowVar !== row) fail(pos, 'row/type kind mismatch');
        this.lowerAndOccurs(a, b, x.level, pos); x.a = b; return;
      }
      if (y.kind === 'Var') { this.unify(b, a, pos); return; }
      if (x.kind !== y.kind) fail(pos, 'incompatible type shapes');
      switch (x.kind) {
        case 'Function': this.unify(x.a, y.a, pos); this.unify(x.b, y.b, pos); break;
        case 'Owned': case 'Array': case 'Record': this.unify(x.a, y.a, pos); break;
        case 'Row': this.unifyRows(a, b, pos); break;
      }
    } finally { this.depth--; }
  }
  polymorphic(root, cutoff) {
    const work = [root], seen = new Set();
    while (work.length) {
      const id = this.find(work.pop()); if (seen.has(id)) continue;
      seen.add(id); this.metrics.generalize_visits++;
      const t = this.nodes[id];
      if (t.kind === 'Var') { if (t.level > cutoff) return true; }
      else {
        if (t.a !== NONE) work.push(t.a); if (t.b !== NONE) work.push(t.b);
        for (const [, value] of t.fields) work.push(value);
      }
    }
    return false;
  }
  project(recordType, label, level, pos) {
    const root = this.find(recordType), t = this.nodes[root];
    if (t.kind === 'Var') {
      const value = this.fresh(level);
      this.unify(root, this.record([[label, value]], this.fresh(level, true)), pos); return value;
    }
    if (t.kind !== 'Record') fail(pos, 'field projection requires a record');
    let at = t.a;
    for (;;) {
      at = this.find(at); this.metrics.projection_steps++; const row = this.nodes[at];
      if (row.kind === 'Var') {
        const value = this.fresh(level);
        this.unify(at, this.row([[label, value]], this.fresh(level, true)), pos); return value;
      }
      // Known fields do not allocate another row constraint or scan the entire record.
      let lo = 0, hi = row.fields.length;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (row.fields[m][0] < label) lo = m + 1; else hi = m; }
      if (lo < row.fields.length && row.fields[lo][0] === label) return row.fields[lo][1];
      if (row.a === NONE) fail(pos, 'record does not provide the required field');
      at = row.a;
    }
  }
  instantiate(root, cutoff, level) {
    const copied = new Map();
    const copy = id => {
      enter(this);
      try {
        id = this.find(id); this.metrics.instantiate_visits++;
        if (copied.has(id)) return copied.get(id);
        const t = this.nodes[id];
        if (t.kind === 'Var') {
          const out = t.level > cutoff ? this.fresh(level, t.rowVar) : id; copied.set(id, out); return out;
        }
        const a = t.a === NONE ? NONE : copy(t.a), b = t.b === NONE ? NONE : copy(t.b);
        let changed = a !== t.a || b !== t.b;
        const fields = t.fields.map(([n, v]) => { const next = copy(v); changed ||= next !== v; return [n, next]; });
        const out = changed ? this.add({ ...t, a, b, fields }) : id; copied.set(id, out); return out;
      } finally { this.depth--; }
    };
    return copy(root);
  }
  from(c, level) {
    enter(this);
    try {
      switch (c.kind) {
        case 'Int': return this.integer; case 'Bool': return this.boolean;
        case 'Text': return this.text; case 'Unit': return this.unit;
        case 'Owned': return this.owned(this.from(c.a, level));
        case 'Array': return this.array(this.from(c.a, level));
        case 'Function': return this.function(this.from(c.a, level), this.from(c.b, level));
        case 'Record': return this.record(c.fields.map(([n, v]) => [n, this.from(v, level)]), this.fresh(level, true));
        default: fail(0, 'unknown contract', 'E_INTERNAL');
      }
    } finally { this.depth--; }
  }
  show(root, symbols) {
    const vars = new Map(); let visits = 0;
    const go = (id, depth) => {
      if (depth > 48 || ++visits > 4096) return '...';
      id = this.find(id); const t = this.nodes[id];
      switch (t.kind) {
        case 'Var': if (!vars.has(id)) vars.set(id, vars.size); return `${t.rowVar ? '..r' : "'t"}${vars.get(id)}`;
        case 'Int': case 'Bool': case 'Text': case 'Unit': return t.kind;
        case 'Owned': return `Owned ${go(t.a, depth + 1)}`;
        case 'Array': return `[${go(t.a, depth + 1)}]`;
        case 'Function': return `(${go(t.a, depth + 1)} -> ${go(t.b, depth + 1)})`;
        case 'Record': return go(t.a, depth + 1);
        case 'Row': {
          const { fields, tail } = this.flatten(id);
          return '{ ' + [...fields].sort((a, b) => a[0] - b[0]).map(([n, v]) => `.${symbols.name(n)}: ${go(v, depth + 1)}; `).join('') +
            (tail === NONE ? '' : go(tail, depth + 1) + ' ') + '}';
        }
        default: fail(0, 'unknown type', 'E_INTERNAL');
      }
    };
    return go(root, 0);
  }
}

export class Infer {
  depth = 0; nextBinder = 0; env = [new Map()]; builtins = [];
  constructor(ast, types) {
    this.ast = ast; this.types = types;
    const arrow = (a, b) => types.function(a, b);
    const add = (name, type, arity) => {
      const id = ast.symbols.intern(name), binder = this.nextBinder++;
      this.env[0].set(id, { type, binder, cutoff: 0, polymorphic: types.polymorphic(type, 0) });
      this.builtins.push({ name, binder, type, arity });
    };
    const a1 = types.fresh(1); add('length', arrow(types.array(a1), types.integer), 1);
    const a2 = types.fresh(1); add('get', arrow(types.array(a2), arrow(types.integer, a2)), 2);
    const a3 = types.fresh(1), b3 = types.fresh(1); add('map', arrow(arrow(a3, b3), arrow(types.array(a3), types.array(b3))), 2);
    const a4 = types.fresh(1), b4 = types.fresh(1); add('fold', arrow(arrow(a4, arrow(b4, a4)), arrow(a4, arrow(types.array(b4), a4))), 3);
    add('concat', arrow(types.text, arrow(types.text, types.text)), 2); add('textLength', arrow(types.text, types.integer), 1);
  }
  lookup(name, pos) {
    for (let i = this.env.length - 1; i >= 0; i--) if (this.env[i].has(name)) return this.env[i].get(name);
    fail(pos, `unbound name '${this.ast.symbols.name(name)}'`, 'E_NAME');
  }
  expression(id, level) {
    const e = this.ast.nodes[id], t = this.types; enter(this, e.pos);
    try {
      let out;
      switch (e.kind) {
        case 'Int': out = t.integer; break; case 'Bool': out = t.boolean; break;
        case 'Text': out = t.text; break; case 'Unit': out = t.unit; break;
        case 'Var': {
          const s = this.lookup(e.name, e.pos); e.binder = s.binder;
          out = s.polymorphic ? t.instantiate(s.type, s.cutoff, level) : s.type; break;
        }
        case 'ArrayGet': case 'ArraySlice': case 'ArrayConcat': case 'ArraySet': case 'ArrayMaterialize': {
          const elem = t.fresh(level), array = t.array(elem), input = this.expression(e.a, level);
          t.unify(input, e.kind === 'ArraySet' ? t.owned(array) : array, e.pos);
          if (e.kind === 'ArrayConcat') t.unify(this.expression(e.b, level), array, e.pos);
          else if (e.kind !== 'ArrayMaterialize') t.unify(this.expression(e.b, level), t.integer, e.pos);
          if (e.kind === 'ArraySlice') t.unify(this.expression(e.c, level), t.integer, e.pos);
          if (e.kind === 'ArraySet') t.unify(this.expression(e.c, level), elem, e.pos);
          out = e.kind === 'ArraySet' ? t.owned(array) : e.kind === 'ArrayGet' ? elem : array;
          break;
        }
        case 'Own': out = t.owned(this.expression(e.a, level)); break;
        case 'Move': case 'Snapshot': out = this.expression(e.a, level); t.unify(out, t.owned(t.fresh(level)), e.pos); break;
        case 'Drop': { const owner = this.expression(e.a, level); t.unify(owner, t.owned(t.fresh(level)), e.pos); out = t.unit; break; }
        case 'Take': { const owner = this.expression(e.a, level); out = t.fresh(level); t.unify(owner, t.owned(out), e.pos); break; }
        case 'Borrow': {
          const owner = this.expression(e.a, level), view = t.fresh(level); t.unify(owner, t.owned(view), e.pos);
          e.binder = this.nextBinder++; this.env.push(new Map([[e.name, { type: view, binder: e.binder, cutoff: Infinity, polymorphic: false }]]));
          out = this.expression(e.b, level); this.env.pop(); break;
        }
        case 'Update': case 'Evolve': {
          out = this.expression(e.a, level); const data = t.fresh(level); t.unify(out, t.owned(data), e.pos);
          if (e.kind === 'Evolve') t.unify(this.expression(e.b, level), t.integer, e.pos);
          const fn = this.expression(e.kind === 'Evolve' ? e.c : e.b, level);
          t.unify(fn, t.function(data, data), e.pos); break;
        }
        case 'Import': fail(e.pos, 'imports require compileProject or the file CLI', 'E_MODULE'); break;
        case 'Effect': out = t.from(e.contract, level); break;
        case 'Host': out = this.expression(e.a, level); break;
        case 'Handle': {
          const op = this.expression(e.a, level), handler = this.expression(e.b, level);
          t.unify(op, handler, e.pos); out = this.expression(e.c, level); break;
        }
        case 'Lambda': {
          const param = e.annotation ? t.from(e.annotation, level) : t.fresh(level);
          e.paramType = param; e.binder = this.nextBinder++;
          this.env.push(new Map([[e.name, { type: param, binder: e.binder, cutoff: Infinity, polymorphic: false }]]));
          const body = this.expression(e.a, level); this.env.pop(); out = t.function(param, body); break;
        }
        case 'Call': {
          const f = this.expression(e.a, level), arg = this.expression(e.b, level); out = t.fresh(level);
          t.unify(f, t.function(arg, out), e.pos); break;
        }
        case 'Record': out = t.record(e.fields.map(([n, x]) => [n, this.expression(x, level)]).sort((a, b) => a[0] - b[0])); break;
        case 'Field': out = t.project(this.expression(e.a, level), e.name, level, e.pos); break;
        case 'Array': {
          const elem = t.fresh(level); for (const x of e.items) t.unify(elem, this.expression(x, level), e.pos);
          out = t.array(elem); break;
        }
        case 'Binary': {
          const a = this.expression(e.a, level), b = this.expression(e.b, level);
          const domain = e.text === '&&' || e.text === '||' ? t.boolean : t.integer;
          t.unify(a, domain, e.pos); t.unify(b, domain, e.pos);
          out = ['+', '-', '*', '/', '%'].includes(e.text) ? t.integer : t.boolean; break;
        }
        case 'Unary': out = e.text === '!' ? t.boolean : t.integer; t.unify(this.expression(e.a, level), out, e.pos); break;
        case 'If': t.unify(this.expression(e.a, level), t.boolean, e.pos); out = this.expression(e.b, level); t.unify(out, this.expression(e.c, level), e.pos); break;
        case 'Block': {
          this.env.push(new Map());
          for (const b of e.bindings) {
            const type = this.expression(b.expr, level + 1);
            if (b.annotation) t.unify(type, t.from(b.annotation, level + 1), b.pos);
            b.binder = this.nextBinder++;
            this.env.at(-1).set(b.name, { type, binder: b.binder, cutoff: level, polymorphic: t.polymorphic(type, level) });
          }
          out = this.expression(e.a, level); this.env.pop();
          if (e.moduleExport && t.nodes[t.find(out)].kind !== 'Record') fail(e.pos, 'imported modules must return an export record', 'E_MODULE');
          break;
        }
        default: fail(e.pos, 'unknown expression', 'E_INTERNAL');
      }
      e.type = out; return out;
    } finally { this.depth--; }
  }
  run() { return this.expression(this.ast.root, 0); }
}
