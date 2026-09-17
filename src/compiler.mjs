import { performance } from 'node:perf_hooks';
import { Parser } from './syntax.mjs';
import { Types, Infer } from './types.mjs';
import { Refine } from './refine.mjs';
import { WasmEmit } from './wasm.mjs';
import { execute } from './wasm-host.mjs';
export { TTError } from './core.mjs';
export { execute, loadWasm, readValue, display } from './wasm-host.mjs';

/** Request-local arenas; compile emits Wasm only and never executes the source. */
export function compile(source, { emit = true, sourceName = '' } = {}) {
  let start = performance.now(); const ast = new Parser(source).parse(); const parse_ms = performance.now() - start;
  const types = new Types(), inference = new Infer(ast, types);
  start = performance.now(); const type = inference.run(); const type_ms = performance.now() - start;
  start = performance.now(); new Refine(ast, types, inference).run(); const refine_ms = performance.now() - start;
  let wasm = null, emit_ms = 0, validation_ms = 0, emission = {};
  if (emit) {
    start = performance.now(); ({ wasm, ...emission } = new WasmEmit(ast, inference, source, sourceName).run()); emit_ms = performance.now() - start;
    start = performance.now(); if (!WebAssembly.validate(wasm)) throw new Error('internal: emitter produced invalid Wasm'); validation_ms = performance.now() - start;
  }
  return { wasm, type: types.show(type, ast.symbols), metrics: {
    parse_ms, type_ms, refine_ms, emit_ms, validation_ms, ast_nodes: ast.nodes.length, type_nodes: types.nodes.length, ...types.metrics, ...emission,
  } };
}
export function check(source) { return compile(source, { emit: false }); }
export function run(source, options = {}) {
  const { sourceName = '', ...executionOptions } = options;
  const result = compile(source, { sourceName }), execution = execute(result.wasm, executionOptions);
  return { ...result, ...execution, metrics: result.metrics, execution_metrics: execution.metrics };
}
