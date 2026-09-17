/** Compositional synchronous-effect summaries. Substitution visits summaries, never AST bodies. */
import { LIMITS, fail, enter } from './core.mjs';
const empty = Object.freeze([]);
const result = (value = null, terms = empty) => ({ value, terms });
const unknown = v => ['Param', 'Project', 'Element', 'Applied'].includes(v?.kind);
const tag = name => name.startsWith('host:') || name.startsWith('effect:') ? name : 'effect:' + name;

export class Effects {
  depth = 0; steps = 0; env = []; functions = []; operations = new Map(); hosts = new Map();
  constructor(ast, types, inference) {
    this.ast = ast; this.types = types;
    for (const b of inference.builtins) this.env[b.binder] = { kind: 'Builtin', name: b.name, args: [] };
  }
  step(pos = 0) { if (++this.steps > LIMITS.proofSteps) fail(pos, 'effect summary work limit exceeded', 'E_LIMIT'); }
  union(...groups) { return this.unionGroups(groups); }
  unionGroups(groups) {
    const out = new Set(); for (const group of groups) for (const item of group) { this.step(); out.add(item); }
    return out.size ? [...out] : empty;
  }
  choice(a, b) {
    if (a === b) return a;
    if (a?.kind === 'Record' && b?.kind === 'Record' && a.fields.size === b.fields.size && [...a.fields.keys()].every(n => b.fields.has(n)))
      return { kind: 'Record', fields: new Map([...a.fields].map(([n, v]) => [n, this.choice(v, b.fields.get(n))])) };
    if (a?.kind === 'Array' && b?.kind === 'Array') return { kind: 'Array', value: this.choice(a.value, b.value) };
    const values = new Set([...(a?.kind === 'Choice' ? a.values : [a]), ...(b?.kind === 'Choice' ? b.values : [b])]);
    if (values.size > 256) fail(0, 'effect alternative limit exceeded', 'E_LIMIT');
    for (const v of values) this.step(); return { kind: 'Choice', values: [...values] };
  }
  project(value, name) {
    this.step();
    if (value?.kind === 'Record') return value.fields.get(name) ?? null;
    if (value?.kind === 'Choice') return value.values.map(v => this.project(v, name)).reduce((a, b) => this.choice(a, b));
    if (unknown(value)) return { kind: 'Project', value, name, base: value.base ? this.project(value.base, name) : null };
    return null;
  }
  element(value) {
    this.step();
    if (value?.kind === 'Array') return value.value;
    if (value?.kind === 'Choice') return value.values.map(v => this.element(v)).reduce((a, b) => this.choice(a, b));
    if (unknown(value)) return { kind: 'Element', value, base: value.base ? this.element(value.base) : null };
    return null;
  }
  fromContract(c) {
    this.step();
    if (!c) return null;
    if (c.kind === 'Function') return { kind: 'Signature', contract: c };
    if (c.kind === 'Array') return { kind: 'Array', value: this.fromContract(c.a) };
    if (c.kind === 'Record') return { kind: 'Record', fields: new Map(c.fields.map(([n, t]) => [n, this.fromContract(t)])) };
    return null;
  }
  subst(value, binder, argument, pos, memo = new Map()) {
    if (!value) return value;
    this.step(pos); enter(this, pos);
    try {
      if (memo.has(value)) return memo.get(value);
      const sub = v => this.subst(v, binder, argument, pos, memo);
      let out = value;
      switch (value.kind) {
        case 'Param': out = value.binder === binder ? argument : value; break;
        case 'Project': out = this.project(sub(value.value), value.name); break;
        case 'Element': out = this.element(sub(value.value)); break;
        case 'Applied': out = this.call(sub(value.fn), sub(value.arg), pos).value; break;
        case 'Choice': out = value.values.map(sub).reduce((a, b) => this.choice(a, b)); break;
        case 'Record': out = { kind: 'Record', fields: new Map([...value.fields].map(([n, v]) => [n, sub(v)])) }; break;
        case 'Array': out = { kind: 'Array', value: sub(value.value) }; break;
        case 'Builtin': out = { ...value, args: value.args.map(sub) }; break;
        case 'Function': out = { ...value, value: sub(value.value),
          terms: this.substTerms(value.terms, binder, argument, pos, memo) }; break;
      }
      memo.set(value, out); return out;
    } finally { this.depth--; }
  }
  substTerms(terms, binder, argument, pos, memo = new Map()) {
    const sub = v => this.subst(v, binder, argument, pos, memo), out = [];
    const append = terms => { for (const term of terms) out.push(term); };
    for (const term of terms) {
      this.step(pos);
      if (typeof term === 'string') out.push(term);
      else if (term.kind === 'Call') append(this.call(sub(term.fn), sub(term.arg), term.pos).terms);
      else if (term.kind === 'Check') append(this.checkValue(sub(term.value), term.contract, term.pos, term.allowRoot));
      else if (term.kind === 'Bound') append(this.bound(this.substTerms(term.terms, binder, argument, pos, memo), term.allowed, term.pos));
      else if (term.kind === 'Handle') append(this.handleTerms(term.operation, sub(term.handler),
        this.substTerms(term.terms, binder, argument, pos, memo), term.pos));
      else fail(pos, 'unknown effect summary', 'E_INTERNAL');
    }
    return this.union(out);
  }
  bound(terms, allowed, pos) {
    const pending = [];
    for (const term of terms) {
      this.step(pos);
      if (typeof term !== 'string') pending.push(term);
      else if (!allowed.includes(term)) fail(pos, `effect '${term}' is not permitted by the function contract`, 'E_EFFECT');
    }
    return pending.length ? [{ kind: 'Bound', terms: pending, allowed, pos }] : empty;
  }
  checkValue(value, c, pos, allowRoot = false) {
    this.step(pos); enter(this, pos);
    try {
      if (!c) return empty;
      if (c.kind === 'Array') return this.checkValue(this.element(value), c.a, pos);
      if (c.kind === 'Record') return this.unionGroups(c.fields.map(([n, t]) => this.checkValue(this.project(value, n), t, pos)));
      if (c.kind !== 'Function') return empty;
      if (unknown(value)) return [{ kind: 'Check', value, contract: c, pos, allowRoot }];
      const applied = this.call(value, this.fromContract(c.a), pos);
      return this.union(allowRoot ? empty : this.bound(applied.terms, (c.effects ?? []).map(tag), pos),
        this.checkValue(applied.value, c.b, pos));
    } finally { this.depth--; }
  }
  call(fn, arg, pos) {
    this.step(pos); enter(this, pos);
    try {
      if (fn?.kind === 'Choice') {
        const calls = fn.values.map(f => this.call(f, arg, pos));
        return result(calls.map(x => x.value).reduce((a, b) => this.choice(a, b)), this.unionGroups(calls.map(x => x.terms)));
      }
      if (fn?.kind === 'Function') {
        const memo = new Map();
        return result(this.subst(fn.value, fn.binder, arg, pos, memo), this.union(
          this.checkValue(arg, fn.domain, pos), this.substTerms(fn.terms, fn.binder, arg, pos, memo)));
      }
      if (fn?.kind === 'Signature' || fn?.kind === 'Operation') {
        const c = fn.contract;
        return result(this.fromContract(c.b), this.union(this.checkValue(arg, c.a, pos),
          fn.kind === 'Operation' ? [fn.term] : (c.effects ?? []).map(tag)));
      }
      if (fn?.kind === 'Builtin') {
        const args = [...fn.args, arg], arity = { length: 1, textLength: 1, get: 2, map: 2, fold: 3, concat: 2 }[fn.name];
        if (args.length < arity) return result({ ...fn, args });
        if (fn.name === 'get') return result(this.element(args[0]));
        if (fn.name === 'map') {
          const item = this.call(args[0], this.element(args[1]), pos);
          return result({ kind: 'Array', value: item.value }, item.terms);
        }
        if (fn.name === 'fold') {
          // Scalar accumulators have no callable contents to discover at later iterations.
          // Refuse unknown/higher-order accumulators instead of assuming one iteration is complete.
          if (args[1] !== null) fail(pos, 'effect-aware fold currently requires a scalar accumulator', 'E_EFFECT');
          const first = this.call(args[0], null, pos), second = this.call(first.value, this.element(args[2]), pos);
          if (second.value !== null) fail(pos, 'effect-aware fold cannot infer a higher-order accumulator', 'E_EFFECT');
          return result(null, this.union(first.terms, second.terms));
        }
        return result();
      }
      if (unknown(fn)) {
        if (fn.base) return this.call(fn.base, arg, pos);
        return result({ kind: 'Applied', fn, arg }, [{ kind: 'Call', fn, arg, pos }]);
      }
      // Shapes have already proved callability. Missing effect evidence is never proof of purity.
      fail(pos, 'callable effect evidence is unavailable', 'E_EFFECT');
    } finally { this.depth--; }
  }
  handleTerms(operation, handler, terms, pos) {
    const out = [], pending = []; let performs = false;
    for (const term of terms) {
      this.step(pos);
      if (term === operation.term) performs = true;
      else if (typeof term === 'string') out.push(term);
      else pending.push(term);
    }
    if (performs) for (const term of this.call(handler, this.fromContract(operation.contract.a), pos).terms) out.push(term);
    if (pending.length) out.push({ kind: 'Handle', operation, handler, terms: pending, pos });
    return this.union(out);
  }
  expression(id, expected = null) {
    const e = this.ast.nodes[id]; this.step(e.pos); enter(this, e.pos);
    try {
      switch (e.kind) {
        case 'Int': case 'Bool': case 'Unit': case 'Text': return result();
        case 'Var': return result(this.env[e.binder] ?? null);
        case 'Effect': {
          const op = { kind: 'Operation', key: e.key, term: 'effect:' + e.key, contract: e.contract, host: false };
          this.operations.set(e.key, op); return result(op);
        }
        case 'Host': {
          const a = this.expression(e.a), op = a.value;
          if (op?.kind !== 'Operation' || op.host) fail(e.pos, 'host requires a statically known effect declaration', 'E_EFFECT');
          if (!['Int', 'Bool', 'Unit', 'Text'].includes(op.contract.a.kind) || !['Int', 'Bool', 'Unit'].includes(op.contract.b.kind))
            fail(e.pos, 'host operations support scalar/Text inputs and Int/Bool/Unit results', 'E_EFFECT');
          e.effectKey = op.key; e.effectContract = op.contract;
          const host = { ...op, host: true, term: 'host:' + op.key }; this.hosts.set(op.key, host); return result(host, a.terms);
        }
        case 'Lambda': {
          const domain = e.annotation ?? expected?.a ?? null;
          const parameterType = this.types.nodes[this.types.find(e.paramType)];
          this.env[e.binder] = ['Int', 'Bool', 'Text', 'Unit'].includes(parameterType.kind) ? null :
            { kind: 'Param', binder: e.binder, base: this.fromContract(domain) };
          const body = this.expression(e.a, expected?.b);
          const fn = { kind: 'Function', binder: e.binder, domain, value: body.value, terms: body.terms };
          this.functions.push({ node: id, fn }); return result(fn);
        }
        case 'Call': {
          const f = this.expression(e.a), a = this.expression(e.b);
          const call = this.call(f.value, a.value, e.pos);
          return result(call.value, this.union(f.terms, a.terms, call.terms));
        }
        case 'Record': {
          const fields = new Map(), terms = [];
          for (const [n, id] of e.fields) { const item = this.expression(id, expected?.fields?.find(([name]) => name === n)?.[1]); fields.set(n, item.value); terms.push(item.terms); }
          return result({ kind: 'Record', fields }, this.unionGroups(terms));
        }
        case 'Field': { const a = this.expression(e.a); return result(this.project(a.value, e.name), a.terms); }
        case 'Array': {
          let value = null, first = true; const terms = [];
          for (const id of e.items) { const item = this.expression(id, expected?.a); value = first ? item.value : this.choice(value, item.value); first = false; terms.push(item.terms); }
          return result({ kind: 'Array', value }, this.unionGroups(terms));
        }
        case 'Unary': return result(null, this.expression(e.a).terms);
        case 'Binary': { const a = this.expression(e.a), b = this.expression(e.b); return result(null, this.union(a.terms, b.terms)); }
        case 'If': {
          const c = this.expression(e.a), a = this.expression(e.b, expected), b = this.expression(e.c, expected);
          return result(this.choice(a.value, b.value), this.union(c.terms, a.terms, b.terms));
        }
        case 'Block': {
          const terms = [];
          for (const b of e.bindings) {
            const item = this.expression(b.expr, b.annotation);
            terms.push(item.terms, this.checkValue(item.value, b.annotation, b.pos)); this.env[b.binder] = item.value;
          }
          const out = this.expression(e.a, expected); return result(out.value, this.unionGroups([...terms, out.terms]));
        }
        case 'Handle': {
          const declaration = this.expression(e.a), op = declaration.value;
          if (op?.kind !== 'Operation' || op.host) fail(e.pos, 'handle requires a statically known source effect declaration', 'E_EFFECT');
          e.effectKey = op.key; e.effectContract = op.contract;
          const handler = this.expression(e.b, op.contract), body = this.expression(e.c, expected);
          return result(body.value, this.union(declaration.terms, handler.terms,
            this.checkValue(handler.value, op.contract, e.pos, true), this.handleTerms(op, handler.value, body.terms, e.pos)));
        }
        default: fail(e.pos, 'unsupported effect analysis node', 'E_INTERNAL');
      }
    } finally { this.depth--; }
  }
  run() {
    const out = this.expression(this.ast.root);
    for (const term of out.terms) {
      if (typeof term !== 'string') fail(term.pos ?? 0, 'unresolved higher-order effect requirement at module boundary', 'E_EFFECT');
      if (!term.startsWith('host:')) fail(0, `unhandled ${term}`, 'E_EFFECT_UNHANDLED');
    }
    return { operations: [...this.operations.values()], hosts: [...this.hosts.values()],
      effects: [...new Set(out.terms)].sort(), steps: this.steps,
      functions: this.functions.map(({ node, fn }) => ({ position: this.ast.nodes[node].pos,
        effects: [...new Set(fn.terms.filter(t => typeof t === 'string'))].sort(), open: fn.terms.some(t => typeof t !== 'string') })) };
  }
}
