/** Deterministic, capability-free source module graph. No filesystem or network I/O. */
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { Parser } from './syntax.mjs';
import { Symbols, NONE, LIMITS, fail } from './core.mjs';

export const MODULE_LIMIT = 256;
export function modulePath(path, pos = 0) {
  if (typeof path !== 'string' || !path.isWellFormed() || !path.endsWith('.tt') ||
      Buffer.byteLength(path) > 4096 || /[\\\u0000-\u001f\u007f:]/.test(path) || posix.isAbsolute(path))
    fail(pos, 'module path must be a project-relative .tt path', 'E_MODULE');
  const normalized = posix.normalize(path);
  if (normalized === '..' || normalized.startsWith('../')) fail(pos, 'module path escapes project root', 'E_MODULE');
  return normalized;
}
export function resolveImport(importer, specifier, pos = 0) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../'))
    fail(pos, 'only explicit relative .tt imports are supported', 'E_MODULE');
  return modulePath(posix.join(posix.dirname(importer), specifier), pos);
}
export function locateSource(sources, pos) {
  for (const source of sources) if (pos >= source.start && pos <= source.start + source.text.length) {
    const local = pos - source.start, before = source.text.slice(0, local);
    return { name: source.name, sha256: source.sha256,
      line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') };
  }
  return null;
}
export function prepareModules(entry, input) {
  entry = modulePath(entry);
  if (!(input instanceof Map) && typeof input !== 'function') throw new TypeError('module sources must be a Map or an explicit synchronous resolver');
  const ast = { symbols: new Symbols(), nodes: [], root: NONE }, sources = [], modules = new Map(), order = [];
  let units = 0, bytes = 0, tokens = 0;
  const load = (name, stack = [], at = 0) => {
    if (stack.includes(name)) fail(at, 'cyclic module import: ' + [...stack, name].join(' -> '), 'E_MODULE_CYCLE');
    if (modules.has(name)) return modules.get(name);
    if (modules.size >= MODULE_LIMIT) fail(at, 'module graph limit exceeded', 'E_LIMIT');
    const text = input instanceof Map ? input.get(name) : input(name);
    if (typeof text !== 'string') fail(at, `missing module '${name}'`, 'E_MODULE');
    bytes += Buffer.byteLength(text) + 1;
    if (bytes > LIMITS.sourceBytes) fail(at, 'combined module source limit exceeded', 'E_LIMIT');
    const source = { name, text, start: units, sha256: createHash('sha256').update(Buffer.from(text)).digest('hex') };
    sources.push(source); units += text.length + 1;
    const symbol = ast.symbols.intern('@module/' + name);
    const module = { name, symbol, source, root: NONE }; modules.set(name, module);
    const first = ast.nodes.length, parser = new Parser(text, { ast, moduleName: name, offset: source.start });
    tokens += parser.tokens.length; if (tokens > LIMITS.tokens) fail(at, 'combined module token limit exceeded', 'E_LIMIT');
    parser.parse(); module.root = ast.root;
    const last = ast.nodes.length, body = ast.nodes[module.root];
    const topImports = new Set(body.bindings.map(b => b.expr));
    for (let id = first; id < last; id++) if (ast.nodes[id].kind === 'Import') {
      const node = ast.nodes[id];
      if (!topImports.has(id)) fail(node.pos, 'imports must be top-level let initializers', 'E_MODULE');
      const dependency = load(resolveImport(name, node.text, node.pos), [...stack, name], node.pos);
      node.kind = 'Var'; node.name = dependency.symbol;
    }
    if (name !== entry) body.moduleExport = true;
    order.push(module); return module;
  };
  try {
    const root = load(entry);
    const parser = new Parser('', { ast });
    const returned = parser.add({ kind: 'Var', name: root.symbol, pos: root.source.start });
    ast.root = parser.add({ kind: 'Block', pos: root.source.start, bindings: order.map(m => ({
      name: m.symbol, binder: NONE, annotation: null, expr: m.root, pos: m.source.start,
    })), a: returned });
    return { ast, source: sources.map(s => s.text + '\n').join(''), sourceName: entry, sources,
      modules: order.map(m => ({ name: m.name, sha256: m.source.sha256 })) };
  } catch (error) { if (typeof error.pos === 'number') error.source = locateSource(sources, error.pos); throw error; }
}
