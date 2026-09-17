import { performance } from 'node:perf_hooks';
import { Parser } from './syntax.mjs';
import { Types, Infer } from './types.mjs';
import { Refine } from './refine.mjs';
import { Effects } from './effects.mjs';
import { prepareModules, locateSource } from './modules.mjs';
import { WasmEmit } from './wasm.mjs';
import { execute } from './wasm-host.mjs';
export { TTError } from './core.mjs';
export { execute, loadWasm, readValue, display } from './wasm-host.mjs';

function compilePrepared(prepared, emit, parse_ms) {
  const { ast, source, sourceName, sources = null, modules = [] } = prepared;
  try {
    const types = new Types(), inference = new Infer(ast, types);
    let start = performance.now(); const type = inference.run(); const type_ms = performance.now() - start;
    start = performance.now();
    const effects = ast.nodes.some(n => ['Effect', 'Host', 'Handle'].includes(n.kind)) ? new Effects(ast, types, inference).run()
      : { operations: [], hosts: [], effects: [], functions: [], steps: 0 };
    const effect_ms = performance.now() - start;
    start = performance.now(); new Refine(ast, types, inference).run(); const refine_ms = performance.now() - start;
    let wasm = null, emit_ms = 0, validation_ms = 0, emission = {};
    if (emit) {
      start = performance.now(); ({ wasm, ...emission } = new WasmEmit(ast, inference, source, sourceName, effects, sources).run()); emit_ms = performance.now() - start;
      start = performance.now(); if (!WebAssembly.validate(wasm)) throw new Error('internal: emitter produced invalid Wasm'); validation_ms = performance.now() - start;
    }
    return { wasm, type: types.show(type, ast.symbols), effects: effects.effects,
      effect_functions: effects.functions, modules, metrics: {
        parse_ms, type_ms, effect_ms, refine_ms, emit_ms, validation_ms,
        ast_nodes: ast.nodes.length, type_nodes: types.nodes.length, effect_steps: effects.steps,
        module_count: modules.length || 1, ...types.metrics, ...emission,
      } };
  } catch (error) { if (sources && typeof error.pos === 'number') error.source = locateSource(sources, error.pos); throw error; }
}
/** Request-local arenas; compilation never executes TT code or ambient I/O. */
export function compile(source, { emit = true, sourceName = '' } = {}) {
  const start = performance.now(), ast = new Parser(source, { moduleName: sourceName || 'main.tt' }).parse();
  return compilePrepared({ ast, source, sourceName }, emit, performance.now() - start);
}
export function compileProject(entry, sources, { emit = true } = {}) {
  const start = performance.now(), prepared = prepareModules(entry, sources);
  return compilePrepared(prepared, emit, performance.now() - start);
}
export function check(source) { return compile(source, { emit: false }); }
export function run(source, options = {}) {
  const { sourceName = '', ...executionOptions } = options;
  const result = compile(source, { sourceName }), execution = execute(result.wasm, executionOptions);
  return { ...result, ...execution, metrics: result.metrics, execution_metrics: execution.metrics };
}
