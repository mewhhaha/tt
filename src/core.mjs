/** Shared diagnostics, interned names, and the finite signed-i64 predicate algebra. */
export const NONE = -1;
export const MIN = -(1n << 63n);
export const MAX = (1n << 63n) - 1n;
export const LIMITS = Object.freeze({
  sourceBytes: 4 * 1024 * 1024, tokens: 500_000, astNodes: 200_000,
  typeNodes: 1_000_000, depth: 256, intervals: 256, proofSteps: 2_000_000,
  artifactBytes: 64 * 1024 * 1024, instructions: 2_000_000,
});
export class TTError extends Error {
  constructor(code, pos, message) { super(message); this.name = 'TTError'; this.code = code; this.pos = pos; }
}
export function fail(pos, message, code = 'E_TYPE') { throw new TTError(code, pos, message); }
export function enter(state, pos = 0) {
  if (state.depth >= LIMITS.depth) fail(pos, `nesting limit (${LIMITS.depth}) exceeded`, 'E_LIMIT');
  state.depth++;
}
export class Symbols {
  names = [];
  ids = new Map();
  intern(name) {
    let id = this.ids.get(name);
    if (id === undefined) { id = this.names.length; this.ids.set(name, id); this.names.push(name); }
    return id;
  }
  name(id) { return this.names[id]; }
}
const min = (a, b) => a < b ? a : b;
const max = (a, b) => a > b ? a : b;

// All constructors/operations return canonical disjoint, non-adjacent intervals.
// BigInt is used during checking; generated Wasm uses checked i64 operations.
export class Ranges {
  constructor(parts = []) {
    if (parts.length > LIMITS.intervals) fail(0, 'interval partition limit exceeded', 'E_LIMIT');
    this.parts = parts;
  }
  static all() { return new Ranges([[MIN, MAX]]); }
  static one(v) { return new Ranges([[v, v]]); }
  static span(lo, hi) { return new Ranges(lo <= hi ? [[lo, hi]] : []); }
  get full() { return this.parts.length === 1 && this.parts[0][0] === MIN && this.parts[0][1] === MAX; }
  get empty() { return this.parts.length === 0; }
  equal(b) {
    return this === b || (this.parts.length === b.parts.length &&
      this.parts.every(([lo, hi], i) => lo === b.parts[i][0] && hi === b.parts[i][1]));
  }
  contains(x) { return this.parts.some(([lo, hi]) => lo <= x && x <= hi); }
  static unite(a, b) {
    // Linear merge of canonical inputs; never sort or mutate an aliased input.
    const out = []; let i = 0, j = 0;
    while (i < a.parts.length || j < b.parts.length) {
      const part = j === b.parts.length || (i < a.parts.length && a.parts[i][0] <= b.parts[j][0])
        ? a.parts[i++] : b.parts[j++];
      const last = out.at(-1);
      if (last && part[0] <= last[1] + 1n) last[1] = max(last[1], part[1]);
      else out.push([...part]);
    }
    return new Ranges(out);
  }
  static intersect(a, b) {
    const out = []; let i = 0, j = 0;
    while (i < a.parts.length && j < b.parts.length) {
      const x = a.parts[i], y = b.parts[j];
      const lo = max(x[0], y[0]), hi = min(x[1], y[1]);
      if (lo <= hi) out.push([lo, hi]);
      if (x[1] < y[1]) i++; else j++;
    }
    return new Ranges(out);
  }
  static complement(a) {
    const out = []; let next = MIN;
    for (const [lo, hi] of a.parts) {
      if (next < lo) out.push([next, lo - 1n]);
      if (hi === MAX) return new Ranges(out);
      next = hi + 1n;
    }
    out.push([next, MAX]); return new Ranges(out);
  }
  subset(b) {
    let j = 0;
    for (const [lo, hi] of this.parts) {
      while (j < b.parts.length && b.parts[j][1] < lo) j++;
      if (j === b.parts.length || b.parts[j][0] > lo || b.parts[j][1] < hi) return false;
    }
    return true;
  }
  toString() {
    if (this.empty) return 'Never';
    if (this.full) return 'Int';
    return this.parts.map(([lo, hi]) => lo === hi ? String(lo) : `Int[${lo}..${hi}]`).join(' | ');
  }
}
export function comparison(op, n) {
  switch (op) {
    case '==': return Ranges.one(n);
    case '!=': return Ranges.complement(Ranges.one(n));
    case '<': return n === MIN ? new Ranges() : Ranges.span(MIN, n - 1n);
    case '<=': return Ranges.span(MIN, n);
    case '>': return n === MAX ? new Ranges() : Ranges.span(n + 1n, MAX);
    case '>=': return Ranges.span(n, MAX);
    default: fail(0, 'unsupported comparison', 'E_PARSE');
  }
}
export function contract(kind, a = null, b = null) { return { kind, a, b, fields: [], range: Ranges.all() }; }
export function intContract(range) { return { ...contract('Int'), range }; }
