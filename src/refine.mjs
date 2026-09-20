import { MIN, MAX, LIMITS, Ranges, comparison, fail, enter } from './core.mjs';

// null means the full *structural type at this occurrence*, not untyped top.
export const intEvidence = range => range.full ? null : { kind: 'Integer', range };
export function pairEvidence(kind, a, b = null, binder = null, paramType = null, calls = []) {
  if (kind === 'Function' && !a && !b && !calls.length) return null;
  const out = { kind, a, b };
  if (kind === 'Function' && binder !== null) out.binder = binder;
  if (kind === 'Function' && paramType !== null) out.paramType = paramType;
  if (kind === 'Function' && calls.length) out.calls = calls;
  return out;
}
const BOTTOM = Object.freeze({ kind: 'Bottom' });
const ANY = Object.freeze({ kind: 'Any' });
const bottom = p => p === BOTTOM;
const symbolic = p => p?.kind === 'Param' || p?.kind === 'Project' || p?.kind === 'Apply';
const fallback = p => symbolic(p) ? p.base ?? null : p;
const unknownEvidence = p => p === ANY || (symbolic(p) && fallback(p) === ANY);
export const ranges = p => bottom(p) ? new Ranges() : p?.kind === 'Integer' ? p.range : symbolic(p) ? ranges(p.base) : Ranges.all();
const part = (p, right = false) => p === ANY ? ANY : symbolic(p) ? part(p.base, right) : (right ? p?.b : p?.a) ?? null;
function field(p, n) {
  if (p === ANY) return ANY;
  if (p?.fields?.has(n)) return p.fields.get(n);
  if (symbolic(p)) return { kind: 'Project', source: p, name: n, base: field(p.base, n) };
  return null;
}
const paramEvidence = (binder, base = null) => ({ kind: 'Param', binder, base });
export function evidence(c) {
  switch (c.kind) {
    case 'Int': return intEvidence(c.range);
    case 'Function': return pairEvidence('Function', evidence(c.a), evidence(c.b));
    case 'Owned': return pairEvidence('Owned', evidence(c.a));
    case 'Array': return pairEvidence('Array', evidence(c.a));
    case 'Record': return { kind: 'Record', fields: new Map(c.fields.map(([n, v]) => [n, evidence(v)])) };
    default: return null;
  }
}
export class Refine {
  depth = 0; unreachable = false; pendingCalls = [];
  constructor(ast, types, inference) {
    this.ast = ast; this.types = types; this.env = new Array(inference.nextBinder).fill(null);
    for (const b of inference.builtins) if (b.name === 'length' || b.name === 'textLength')
      this.env[b.binder] = pairEvidence('Function', null, intEvidence(Ranges.span(0n, MAX)));
  }
  step(pos) { if (++this.types.metrics.proof_steps > LIMITS.proofSteps) fail(pos, 'refinement work limit exceeded', 'E_LIMIT'); }
  same(a, b) {
    enter(this);
    try {
      this.step(0); if (a === b) return true;
      if (!a || !b || a.kind !== b.kind) return false;
      switch (a.kind) {
        case 'Bottom': case 'Any': return true;
        case 'Integer': return a.range.equal(b.range);
        case 'Param': return a.binder === b.binder && this.same(a.base, b.base);
        case 'Project': return a.name === b.name && this.same(a.source, b.source) && this.same(a.base, b.base);
        case 'Apply': return a.type === b.type && this.same(a.fn, b.fn) && this.same(a.arg, b.arg) && this.same(a.required, b.required) && this.same(a.base, b.base);
        case 'Owned': case 'Array': return this.same(a.a, b.a) && this.same(a.b, b.b);
        case 'Function': return this.same(a.a, b.a) && this.same(a.b, b.b) &&
          (a.calls?.length ?? 0) === (b.calls?.length ?? 0) &&
          (a.calls ?? []).every((call, i) => this.same(call, b.calls[i]));
        case 'Record':
          if ((a.fields?.size ?? 0) !== (b.fields?.size ?? 0)) return false;
          for (const [n, v] of a.fields) if (!b.fields.has(n) || !this.same(v, b.fields.get(n))) return false;
          return true;
        default: return false;
      }
    } finally { this.depth--; }
  }
  substitute(value, binder, argument, pos, pending = []) {
    if (!value || bottom(value)) return value;
    this.step(pos); this.types.metrics.refinement_substitutions++;
    switch (value.kind) {
      case 'Integer': case 'Any': return value;
      case 'Param': return value.binder === binder ? argument : value;
      case 'Project': {
        const source = this.substitute(value.source, binder, argument, pos, pending);
        return field(source, value.name);
      }
      case 'Apply': {
        const fn = this.substitute(value.fn, binder, argument, pos, pending);
        const arg = this.substitute(value.arg, binder, argument, pos, pending);
        return this.applyEvidence(fn, arg, pos, value.type, pending);
      }
      case 'Owned': return pairEvidence('Owned', this.substitute(value.a, binder, argument, pos, pending));
      case 'Array': return pairEvidence('Array', this.substitute(value.a, binder, argument, pos, pending));
      case 'Function': {
        // The returned closure's obligations belong to its future body, not the
        // enclosing invocation which merely constructs it.
        const inner = [];
        const domain = this.substitute(value.a, binder, argument, pos, inner);
        // A directly returned call is already instantiated through the result.
        for (const call of value.calls ?? []) if (call !== value.b) this.substitute(call, binder, argument, pos, inner);
        const result = this.substitute(value.b, binder, argument, pos, inner);
        return this.functionEvidence(domain, result, value.binder ?? null, value.paramType ?? null, pos, inner);
      }
      case 'Record': return { kind: 'Record', fields: new Map([...value.fields]
        .map(([n, v]) => [n, this.substitute(v, binder, argument, pos, pending)])) };
      default: return value;
    }
  }
  collectDirectRequirements(value, binder, out, seen = new Set()) {
    if (!value || bottom(value) || seen.has(value)) return;
    seen.add(value); this.step(0);
    if (value.kind === 'Apply' && value.required && value.arg?.kind === 'Param' && value.arg.binder === binder) out.push({ required: value.required, type: value.type });
    switch (value.kind) {
      case 'Project': this.collectDirectRequirements(value.source, binder, out, seen); break;
      case 'Apply':
        this.collectDirectRequirements(value.fn, binder, out, seen);
        this.collectDirectRequirements(value.arg, binder, out, seen);
        this.collectDirectRequirements(value.base, binder, out, seen); break;
      case 'Owned': case 'Array': this.collectDirectRequirements(value.a, binder, out, seen); break;
      case 'Function':
        this.collectDirectRequirements(value.a, binder, out, seen);
        this.collectDirectRequirements(value.b, binder, out, seen); break;
      case 'Record': for (const v of value.fields.values()) this.collectDirectRequirements(v, binder, out, seen); break;
    }
  }
  meetRequirements(a, b, type, pos) {
    if (!a) return b; if (!b) return a; if (this.same(a, b)) return a;
    if (this.entails(a, b, type, pos)) return a;
    if (this.entails(b, a, type, pos)) return b;
    const t = this.types.nodes[this.types.find(type)];
    if (t.kind === 'Int') return intEvidence(Ranges.intersect(ranges(a), ranges(b)));
    if (t.kind === 'Array') return pairEvidence('Array', this.meetRequirements(part(a), part(b), t.a, pos));
    if (t.kind === 'Record') return { kind: 'Record', fields: new Map([...this.types.flatten(t.a, pos).fields]
      .map(([n, ty]) => [n, this.meetRequirements(field(a, n), field(b, n), ty, pos)])) };
    fail(pos, 'dependent callable requirements need an explicit common contract', 'E_REFINEMENT_JOIN');
  }
  functionEvidence(domain, result, binder, paramType, pos, calls = []) {
    if (binder !== null && paramType !== null) {
      const requirements = [], seen = new Set(); this.collectDirectRequirements(result, binder, requirements, seen);
      for (const call of calls) this.collectDirectRequirements(call, binder, requirements, seen);
      for (const entry of requirements) {
        const requirementType = entry.type ?? paramType;
        domain = this.meetRequirements(domain, entry.required, requirementType, pos);
        if (requirementType !== null && this.types.nodes[this.types.find(paramType)].kind === 'Var') paramType = requirementType;
      }
    }
    return pairEvidence('Function', domain, result, binder, paramType, [...new Set(calls)]);
  }
  applyEvidence(fn, argument, pos, argType = null, pending = []) {
    if (!fn) return null;
    if (fn.kind === 'Function') {
      const required = part(fn), requirementType = fn.paramType ?? argType;
      if (required && requirementType !== null && !this.entails(argument, required, requirementType, pos)) {
        if (symbolic(argument)) {
          const base = fn.binder === undefined ? fn.b ?? null : this.substitute(fn.b, fn.binder, fallback(argument), pos);
          const call = { kind: 'Apply', fn, arg: argument, required, type: requirementType, base };
          pending.push(call); return call;
        }
        this.require(argument, required, requirementType, pos);
      }
      if (fn.binder === undefined) return fn.b ?? null;
      for (const call of fn.calls ?? []) if (call !== fn.b) this.substitute(call, fn.binder, argument, pos, pending);
      return this.substitute(fn.b, fn.binder, argument, pos, pending);
    }
    if (symbolic(fn)) {
      const base = fallback(fn);
      let result = null, required = part(base);
      if (base?.kind === 'Function') result = base.binder === undefined
        ? base.b ?? null : this.substitute(base.b, base.binder, fallback(argument), pos);
      const call = { kind: 'Apply', fn, arg: argument, required, type: argType, base: result };
      // ANY means the generic caller may later supply a refined callable. null
      // instead means a checked full structural arrow, with no precondition.
      if (unknownEvidence(fn) || (required && required !== ANY &&
          (argType === null || !this.entails(argument, required, argType, pos)))) pending.push(call);
      return call;
    }
    return null;
  }
  functionEntails(actual, required, type, pos) {
    const domain = part(required);
    if (!this.entails(domain, part(actual), type.a, pos)) return false;
    const fn = fallback(actual), pending = [];
    let result = part(actual, true);
    try {
      if (fn?.binder !== undefined) {
        for (const call of fn.calls ?? []) if (call !== fn.b) this.substitute(call, fn.binder, domain, pos, pending);
        result = this.substitute(fn.b, fn.binder, domain, pos, pending);
      }
    } catch (error) {
      if (error.code === 'E_REFINEMENT') return false;
      throw error; // Never convert a resource limit into successful evidence.
    }
    return pending.length === 0 && this.entails(result, part(required, true), type.b, pos);
  }
  entails(actual, required, type, pos) {
    enter(this, pos);
    try {
      this.step(pos); if (actual === required || bottom(actual)) return true;
      if (bottom(required)) return false;
      const t = this.types.nodes[this.types.find(type)];
      if (required === ANY) return true;
      if (t.kind === 'Function' && unknownEvidence(actual)) return false;
      // A stored generic call may retain its original open shape ID after a
      // let-instantiation. Scalar evidence is already checked independently of
      // that ID; it cannot grant a new structural operation.
      if (t.kind === 'Var' && required?.kind === 'Integer')
        return ranges(actual).subset(required.range);
      switch (t.kind) {
        case 'Int': return ranges(actual).subset(ranges(required));
        case 'Function': return this.functionEntails(actual, required, t, pos);
        case 'Owned': case 'Array': return this.entails(part(actual), part(required), t.a, pos);
        case 'Record': {
          for (const [n, ty] of this.types.flatten(t.a, pos).fields)
            if (!this.entails(field(actual, n), field(required, n), ty, pos)) return false;
          return true;
        }
        default: return !required;
      }
    } finally { this.depth--; }
  }
  require(actual, expected, type, pos) {
    if (!this.entails(actual, expected, type, pos)) {
      const extra = this.types.nodes[this.types.find(type)].kind === 'Int'
        ? `; have ${ranges(actual)}, need ${ranges(expected)}` : '';
      fail(pos, 'refinement contract not established' + extra, 'E_REFINEMENT');
    }
  }
  join(a, b, type, pos) {
    enter(this, pos);
    try {
      this.step(pos); if (bottom(a)) return b; if (bottom(b)) return a; if (this.same(a, b)) return a;
      const t = this.types.nodes[this.types.find(type)];
      switch (t.kind) {
        case 'Int': return intEvidence(Ranges.unite(ranges(a), ranges(b)));
        case 'Owned': return pairEvidence('Owned', this.join(part(a), part(b), t.a, pos));
        case 'Array': return pairEvidence('Array', this.join(part(a), part(b), t.a, pos));
        case 'Record': return { kind: 'Record', fields: new Map([...this.types.flatten(t.a, pos).fields]
          .map(([n, ty]) => [n, this.join(field(a, n), field(b, n), ty, pos)])) };
        case 'Function':
          if (a?.calls?.length || b?.calls?.length)
            fail(pos, 'joining deferred call requirements needs a common explicit contract', 'E_REFINEMENT_JOIN');
          if (this.same(part(a), part(b))) return pairEvidence('Function', part(a), this.join(part(a, true), part(b, true), t.b, pos));
          if (this.entails(a, null, type, pos) && this.entails(b, null, type, pos)) return null;
          fail(pos, 'joining different callable preconditions needs a common explicit contract', 'E_REFINEMENT_JOIN');
        default: return null;
      }
    } finally { this.depth--; }
  }
  arithmetic(op, a, b) {
    if (a.empty || b.empty) return new Ranges();
    if (a.parts.length * b.parts.length > LIMITS.intervals) return Ranges.all();
    let out = new Ranges();
    for (const [xl, xh] of a.parts) for (const [yl, yh] of b.parts) {
      let lo = MIN, hi = MAX;
      if (op === '+') { lo = xl + yl; hi = xh + yh; }
      else if (op === '-') { lo = xl - yh; hi = xh - yl; }
      else if (op === '*') {
        const values = [xl * yl, xl * yh, xh * yl, xh * yh];
        lo = values.reduce((a, b) => a < b ? a : b); hi = values.reduce((a, b) => a > b ? a : b);
      } else if (op === '/' && yl === yh && yl !== 0n) {
        const p = xl / yl, q = xh / yl; lo = p < q ? p : q; hi = p > q ? p : q;
      } else if (op === '%' && yl === yh && yl !== 0n) {
        const n = yl < 0n ? -yl : yl; lo = -n + 1n; hi = n - 1n;
      }
      // Postconditions describe normal returns; uncertain overflow cannot justify wrapping evidence.
      if (lo < MIN || hi > MAX) return Ranges.all();
      out = Ranges.unite(out, Ranges.span(lo, hi));
    }
    return out;
  }
  assume(id, truth, changes) {
    const e = this.ast.nodes[id]; enter(this, e.pos);
    try {
      if (e.kind === 'Bool') { if (e.number !== truth) this.unreachable = true; return; }
      if (e.kind === 'Unary' && e.text === '!') { this.assume(e.a, !truth, changes); return; }
      if (e.kind !== 'Binary') return;
      if ((e.text === '&&' && truth) || (e.text === '||' && !truth)) { this.assume(e.a, truth, changes); this.assume(e.b, truth, changes); return; }
      if (!['==', '!=', '<', '<=', '>', '>='].includes(e.text)) return;
      let v = this.ast.nodes[e.a], n = this.ast.nodes[e.b], op = e.text;
      if (v.kind === 'Int' && n.kind === 'Var') { [v, n] = [n, v]; op = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' })[op] ?? op; }
      if (v.kind !== 'Var' || n.kind !== 'Int') return;
      let r = comparison(op, n.number); if (!truth) r = Ranges.complement(r);
      changes.push([v.binder, this.env[v.binder]]);
      r = Ranges.intersect(ranges(this.env[v.binder]), r);
      if (r.empty) this.unreachable = true; this.env[v.binder] = intEvidence(r);
    } finally { this.depth--; }
  }
  restore(changes) { for (let i = changes.length - 1; i >= 0; i--) this.env[changes[i][0]] = changes[i][1]; }
  expression(id, expected = null, checking = false, deferCheck = false) {
    const e = this.ast.nodes[id]; enter(this, e.pos);
    try {
      this.step(e.pos); if (this.unreachable) return BOTTOM;
      let out = null;
      switch (e.kind) {
        case 'Int': out = intEvidence(Ranges.one(e.number)); break;
        case 'Bool': case 'Text': case 'Unit': break;
        case 'Var': out = this.env[e.binder]; break;
        case 'ArrayGet': case 'ArraySlice': case 'ArrayConcat': case 'ArraySet': case 'ArrayMaterialize': {
          const a = this.expression(e.a), b = e.b < 0 ? null : this.expression(e.b), c = e.c < 0 ? null : this.expression(e.c);
          if (e.kind === 'ArrayGet') out = part(a);
          else if (e.kind === 'ArraySet') {
            const elem = this.types.nodes[this.types.find(this.types.nodes[this.types.find(e.type)].a)].a;
            out = pairEvidence('Owned', pairEvidence('Array', this.join(part(part(a)), c, elem, e.pos)));
          } else if (e.kind === 'ArrayConcat') {
            const elem = this.types.nodes[this.types.find(e.type)].a;
            out = pairEvidence('Array', this.join(part(a), part(b), elem, e.pos));
          } else out = a;
          break;
        }
        case 'Own': out = pairEvidence('Owned', this.expression(e.a)); break;
        case 'Move': case 'Snapshot': out = this.expression(e.a); break;
        case 'Drop': this.expression(e.a); break;
        case 'Take': out = part(this.expression(e.a)); break;
        case 'Borrow': {
          this.env[e.binder] = part(this.expression(e.a)); out = this.expression(e.b, expected, checking); break;
        }
        case 'Update': case 'Evolve': {
          this.expression(e.a); if (e.kind === 'Evolve') this.expression(e.b);
          const id = e.kind === 'Evolve' ? e.c : e.b;
          const callback = this.expression(id);
          this.require(callback, null, this.ast.nodes[id].type, e.pos);
          out = pairEvidence('Owned', null); break;
        }
        case 'Effect': out = evidence(e.contract); break;
        case 'Host': this.expression(e.a); out = evidence(e.effectContract); break;
        case 'Handle': {
          this.expression(e.a);
          const required = evidence(e.effectContract);
          const handler = this.expression(e.b, required, true, true);
          // A generic handler parameter can carry an unknown callable precondition.
          // Retain a checked subsumption obligation rather than assuming that it
          // accepts all operation arguments or rechecking its source body.
          const handlerType = this.ast.nodes[e.b].type;
          const validator = { kind: 'Function', a: required ?? { kind: 'Function', a: null, b: null }, b: null, paramType: handlerType };
          this.applyEvidence(validator, handler, e.pos, handlerType, this.pendingCalls);
          out = this.expression(e.c, expected, checking); break;
        }
        case 'Lambda': {
          const domain = e.annotation ? evidence(e.annotation) : checking ? part(expected) : ANY;
          this.env[e.binder] = paramEvidence(e.binder, domain);
          const outer = this.pendingCalls; this.pendingCalls = [];
          try {
            const result = this.expression(e.a, checking ? part(expected, true) : null, checking);
            out = this.functionEvidence(domain, result, e.binder, e.paramType, e.pos, this.pendingCalls);
          } finally { this.pendingCalls = outer; }
          break;
        }
        case 'Call': {
          const f = this.expression(e.a), required = part(f), contextual = required !== ANY;
          const a = this.expression(e.b, contextual ? required : null, contextual);
          const ft = this.types.nodes[this.types.find(this.ast.nodes[e.a].type)];
          if (contextual) this.require(a, required, ft.a, e.pos);
          out = this.applyEvidence(f, a, e.pos, ft.a, this.pendingCalls); break;
        }
        case 'Record': out = { kind: 'Record', fields: new Map(e.fields.map(([n, x]) => [n, this.expression(x, field(expected, n), checking)])) }; break;
        case 'Field': out = field(this.expression(e.a), e.name); break;
        case 'Array': {
          let elem = BOTTOM; const ty = this.types.nodes[this.types.find(e.type)].a;
          for (const x of e.items) elem = this.join(elem, this.expression(x, part(expected), checking), ty, e.pos);
          out = pairEvidence('Array', elem); break;
        }
        case 'Unary': { const a = this.expression(e.a); if (e.text === '-') out = intEvidence(this.arithmetic('-', Ranges.one(0n), ranges(a))); break; }
        case 'Binary': {
          const a = this.expression(e.a); let b;
          if (e.text === '&&' || e.text === '||') {
            const changes = [], old = this.unreachable;
            this.assume(e.a, e.text === '&&', changes); b = this.expression(e.b); this.restore(changes); this.unreachable = old;
          } else b = this.expression(e.b);
          if (['+', '-', '*', '/', '%'].includes(e.text)) out = intEvidence(this.arithmetic(e.text, ranges(a), ranges(b)));
          break;
        }
        case 'If': {
          this.expression(e.a); const changes = [], old = this.unreachable;
          this.assume(e.a, true, changes); const a = this.expression(e.b, expected, checking);
          this.restore(changes); changes.length = 0; this.unreachable = old;
          this.assume(e.a, false, changes); const b = this.expression(e.c, expected, checking);
          this.restore(changes); this.unreachable = old; out = this.join(a, b, e.type, e.pos); break;
        }
        case 'Block':
          for (const b of e.bindings) {
            const required = b.annotation ? evidence(b.annotation) : null;
            const value = this.expression(b.expr, required, Boolean(b.annotation));
            this.env[b.binder] = b.annotation ? required : value;
          }
          out = this.expression(e.a, expected, checking); break;
        default: fail(e.pos, 'unknown expression', 'E_INTERNAL');
      }
      if (checking && !deferCheck) this.require(out, expected, e.type, e.pos);
      return out;
    } finally { this.depth--; }
  }
  run() {
    const result = this.expression(this.ast.root);
    if (this.pendingCalls.length) fail(0, 'unresolved call requirements at module boundary', 'E_REFINEMENT');
    return result;
  }
}
