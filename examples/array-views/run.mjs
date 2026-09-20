import { fileURLToPath } from 'node:url';
import { fileProject } from '../../src/project-files.mjs';
import { compileProject, execute } from '../../src/compiler.mjs';
const mode = process.argv[2] ?? 'pure';
if (!['pure','host'].includes(mode)) throw new Error('usage: node examples/array-views/run.mjs pure|host [index value]');
const project = fileProject(fileURLToPath(new URL(`./${mode}.tt`,import.meta.url)));
const built = compileProject(project.entry,project.read);
const host = new Map([
  ['operations.tt::IndexInput', () => BigInt(process.argv[3] ?? '1')],
  ['operations.tt::ValueInput', () => BigInt(process.argv[4] ?? '99')],
]);
const result = execute(built.wasm,{host});
console.log(result.output);
console.log(JSON.stringify(result.metrics));
