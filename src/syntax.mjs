import { NONE, MIN, MAX, LIMITS, fail, enter, Symbols, Ranges, comparison, contract, intContract } from './core.mjs';

const wordStart = c => /[a-zA-Z_@]/.test(c ?? '');
const wordRest = c => /[a-zA-Z_@0-9]/.test(c ?? '');
const digit = c => c !== undefined && c >= '0' && c <= '9';
const doubles = new Set(['=>', '->', '::', '==', '!=', '<=', '>=', '&&', '||', '..']);
const comparisons = new Set(['<', '>', '<=', '>=', '==', '!=']);
const reserved = new Set(['then', 'else', 'return', 'let', 'const', 'where']);
const precedence = new Map([['||', 1], ['&&', 2], ['==', 3], ['!=', 3],
  ['<', 4], ['<=', 4], ['>', 4], ['>=', 4], ['+', 5], ['-', 5], ['*', 6], ['/', 6], ['%', 6]]);

export function lex(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (Buffer.byteLength(source) > LIMITS.sourceBytes) fail(0, 'source limit (4 MiB) exceeded', 'E_LIMIT');
  if (!source.isWellFormed()) fail(0, 'source contains an unpaired Unicode surrogate', 'E_PARSE');
  const out = []; let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (' \t\r\n'.includes(c)) { i++; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    const pos = i;
    if (wordStart(c)) {
      while (wordRest(source[++i])) { /* scan */ }
      out.push({ kind: 'word', text: source.slice(pos, i), pos });
    } else if (digit(c)) {
      while (digit(source[++i])) { /* scan */ }
      out.push({ kind: 'number', text: source.slice(pos, i), pos });
    } else if (c === '"') {
      i++; const chars = []; let closed = false;
      while (i < source.length) {
        let x = source[i++];
        if (x === '"') { closed = true; break; }
        if (x === '\\') {
          if (i === source.length) break;
          x = source[i++];
          if (x === 'n') x = '\n'; else if (x === 'r') x = '\r'; else if (x === 't') x = '\t';
          else if (x !== '"' && x !== '\\') fail(i - 1, 'unsupported string escape', 'E_PARSE');
        }
        chars.push(x);
      }
      if (!closed) fail(pos, 'unterminated string', 'E_PARSE');
      out.push({ kind: 'string', text: chars.join(''), pos });
    } else {
      let text = source[i++];
      if (doubles.has(text + source[i])) text += source[i++];
      if (!'(){}[];,:.=+-*/%<>!&|'.includes(text[0])) fail(pos, 'invalid character', 'E_PARSE');
      out.push({ kind: 'punct', text, pos });
    }
    if (out.length > LIMITS.tokens) fail(pos, 'token limit exceeded', 'E_LIMIT');
  }
  out.push({ kind: 'end', text: '', pos: source.length }); return out;
}
export class Parser {
  at = 0; depth = 0; aliases = new Map();
  ast = { symbols: new Symbols(), nodes: [], root: NONE };
  constructor(source) { this.tokens = lex(source); }
  get t() { return this.tokens[this.at]; }
  is(text) { return this.t.kind !== 'string' && this.t.text === text; }
  eat(text) { if (this.is(text)) { this.at++; return true; } return false; }
  take() { const t = this.t; if (t.kind !== 'end') this.at++; return t; }
  need(text) { if (!this.eat(text)) fail(this.t.pos, `expected '${text}'`, 'E_PARSE'); }
  word() {
    if (this.t.kind !== 'word') fail(this.t.pos, 'expected name', 'E_PARSE');
    return this.ast.symbols.intern(this.take().text);
  }
  integer(negative = false) {
    if (this.t.kind !== 'number') fail(this.t.pos, 'expected integer literal', 'E_PARSE');
    const tok = this.take();
    // Reject enormous integers before invoking BigInt parsing, but admit leading zeroes.
    const digits = tok.text.replace(/^0+/, '') || '0';
    if (digits.length > 19) fail(tok.pos, 'integer literal outside signed 64-bit domain', 'E_PARSE');
    const v = BigInt(digits) * (negative ? -1n : 1n);
    if (v < MIN || v > MAX) fail(tok.pos, 'integer literal outside signed 64-bit domain', 'E_PARSE');
    return v;
  }
  add(e) {
    if (this.ast.nodes.length >= LIMITS.astNodes) fail(e.pos, 'AST node limit exceeded', 'E_LIMIT');
    this.ast.nodes.push({ a: NONE, b: NONE, c: NONE, name: NONE, binder: NONE,
      type: NONE, paramType: NONE, annotation: null, items: [], fields: [], bindings: [], ...e });
    return this.ast.nodes.length - 1;
  }
  typeAtom() {
    enter(this, this.t.pos);
    try {
      let result;
      if (this.eat('(')) { result = this.type(); this.need(')'); }
      else if (this.eat('[')) { result = contract('Array', this.type()); this.need(']'); }
      else if (this.eat('{')) {
        result = contract('Record'); const seen = new Set();
        while (!this.eat('}')) {
          this.eat('.'); const name = this.word();
          if (seen.has(name)) fail(this.t.pos, 'duplicate type field', 'E_PARSE');
          seen.add(name);
          if (!this.eat(':') && !this.eat('::') && !this.eat('=')) this.need(':');
          result.fields.push([name, this.type()]);
          if (!this.eat(';')) { this.need('}'); break; }
        }
        result.fields.sort((a, b) => a[0] - b[0]);
      } else {
        const pos = this.t.pos, id = this.word(), name = this.ast.symbols.name(id);
        if (['Int', 'Bool', 'Text', 'Unit'].includes(name)) result = contract(name);
        else {
          result = this.aliases.get(id);
          if (!result) fail(pos, `unknown type '${name}'`, 'E_PARSE');
        }
      }
      if (this.eat('where')) {
        if (result.kind !== 'Int') fail(this.t.pos, 'only Int literal comparisons can be refined', 'E_UNSUPPORTED');
        let range = result.range;
        do {
          this.need('self'); const op = this.take();
          if (!comparisons.has(op.text)) fail(op.pos, 'expected refinement comparison', 'E_PARSE');
          const value = this.integer(this.eat('-'));
          range = Ranges.intersect(range, comparison(op.text, value));
        } while (this.eat('&&'));
        result = intContract(range);
      }
      return result;
    } finally { this.depth--; }
  }
  type() {
    enter(this, this.t.pos);
    try {
      let result = this.typeAtom();
      while (this.is('&') || this.is('|')) {
        const meet = this.eat('&'); if (!meet) this.need('|');
        const b = this.typeAtom();
        if (result.kind !== 'Int' || b.kind !== 'Int') fail(this.t.pos, 'Boolean type composition supports Int predicates only', 'E_UNSUPPORTED');
        result = intContract(meet ? Ranges.intersect(result.range, b.range) : Ranges.unite(result.range, b.range));
      }
      if (this.eat('->')) result = contract('Function', result, this.type());
      return result;
    } finally { this.depth--; }
  }
  startsAtom() {
    return this.t.kind === 'number' || this.t.kind === 'string' ||
      (this.t.kind === 'word' && !reserved.has(this.t.text)) || ['(', '[', '{'].some(x => this.is(x));
  }
  atom() {
    enter(this, this.t.pos);
    try {
      const e = { pos: this.t.pos };
      if (this.t.kind === 'number') { e.kind = 'Int'; e.number = this.integer(); }
      else if (this.t.kind === 'string') { e.kind = 'Text'; e.text = this.take().text; }
      else if (this.eat('true')) { e.kind = 'Bool'; e.number = true; }
      else if (this.eat('false')) { e.kind = 'Bool'; e.number = false; }
      else if (this.eat('fn')) {
        e.kind = 'Lambda'; const paren = this.eat('('); e.name = this.word();
        if (this.eat('::') || this.eat(':')) e.annotation = this.type();
        if (paren) this.need(')'); this.need('=>'); e.a = this.expr();
      } else if (this.eat('if')) {
        e.kind = 'If'; e.a = this.expr(); this.need('then'); e.b = this.expr(); this.need('else'); e.c = this.expr();
      } else if (this.eat('do')) { this.need('{'); return this.block(false); }
      else if (this.eat('(')) {
        if (this.eat(')')) e.kind = 'Unit';
        else { const result = this.expr(); this.need(')'); return result; }
      } else if (this.eat('[')) {
        e.kind = 'Array'; e.items = [];
        while (!this.eat(']')) { e.items.push(this.expr()); if (!this.eat(',')) { this.need(']'); break; } }
      } else if (this.eat('{')) {
        e.kind = 'Record'; e.fields = []; const seen = new Set();
        while (!this.eat('}')) {
          this.eat('.'); const name = this.word();
          if (seen.has(name)) fail(this.t.pos, 'duplicate record field', 'E_PARSE');
          seen.add(name); this.need('='); e.fields.push([name, this.expr()]);
          if (!this.eat(';')) { this.need('}'); break; }
        }
      } else if (this.t.kind === 'word') { e.kind = 'Var'; e.name = this.word(); }
      else fail(this.t.pos, 'expected expression', 'E_PARSE');
      return this.add(e);
    } finally { this.depth--; }
  }
  postfix() {
    let x = this.atom();
    while (this.eat('.')) x = this.add({ pos: this.t.pos, kind: 'Field', a: x, name: this.word() });
    return x;
  }
  unary() {
    enter(this, this.t.pos);
    try {
      if (this.is('-') || this.is('!')) {
        const op = this.take();
        return op.text === '-' && this.t.kind === 'number'
          ? this.add({ pos: op.pos, kind: 'Int', number: this.integer(true) })
          : this.add({ pos: op.pos, kind: 'Unary', text: op.text, a: this.unary() });
      }
      return this.postfix();
    } finally { this.depth--; }
  }
  expr(min = 0) {
    enter(this, this.t.pos);
    try {
      let x = this.unary();
      for (;;) {
        if (this.startsAtom() && 7 >= min) {
          x = this.add({ pos: this.ast.nodes[x].pos, kind: 'Call', a: x, b: this.expr(8) }); continue;
        }
        const p = this.t.kind === 'punct' ? (precedence.get(this.t.text) ?? -1) : -1;
        if (p < min) break;
        const op = this.take(); x = this.add({ pos: op.pos, kind: 'Binary', text: op.text, a: x, b: this.expr(p + 1) });
      }
      return x;
    } finally { this.depth--; }
  }
  block(top) {
    enter(this, this.t.pos);
    try {
      const e = { kind: 'Block', pos: this.t.pos, bindings: [] };
      while (this.is('let') || this.is('const')) {
        if (this.eat('const')) {
          if (!top) fail(this.t.pos, 'type aliases are module-level in this prototype', 'E_UNSUPPORTED');
          const name = this.word(); this.need('='); const c = this.type(); this.need(';');
          if (this.aliases.has(name)) fail(this.t.pos, 'duplicate type alias', 'E_PARSE');
          this.aliases.set(name, c);
        } else {
          this.need('let'); const b = { pos: this.t.pos, name: this.word(), annotation: null, binder: NONE };
          if (this.eat('::')) b.annotation = this.type();
          this.need('='); b.expr = this.expr(); this.need(';'); e.bindings.push(b);
        }
      }
      this.need('return'); e.a = this.expr(); this.eat(';');
      if (top) { if (this.t.kind !== 'end') fail(this.t.pos, 'unexpected text after module return', 'E_PARSE'); }
      else this.need('}');
      return this.add(e);
    } finally { this.depth--; }
  }
  parse() { this.ast.root = this.block(true); return this.ast; }
}
