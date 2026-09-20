// Frozen tokenizer oracle from syntax.mjs at 038dc74 (blob 7ef3000e...).
// Test-only; this is not a TT evaluator or another executable output target.
import { LIMITS, fail } from '../src/core.mjs';
const wordStart = c => /[a-zA-Z_@]/.test(c ?? '');
const wordRest = c => /[a-zA-Z_@0-9]/.test(c ?? '');
const digit = c => c !== undefined && c >= '0' && c <= '9';
const doubles = new Set(['=>', '->', '::', '==', '!=', '<=', '>=', '&&', '||', '..']);
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
      if (!'(){}[];,:.=+-*/%<>!&|~'.includes(text[0])) fail(pos, 'invalid character', 'E_PARSE');
      out.push({ kind: 'punct', text, pos });
    }
    if (out.length > LIMITS.tokens) fail(pos, 'token limit exceeded', 'E_LIMIT');
  }
  out.push({ kind: 'end', text: '', pos: source.length }); return out;
}
