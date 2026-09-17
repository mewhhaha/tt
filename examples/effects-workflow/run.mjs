import { fileURLToPath } from 'node:url';
import { compileProject, execute } from '../../src/compiler.mjs';
import { fileProject } from '../../src/project-files.mjs';
const project = fileProject(fileURLToPath(new URL('./host.tt', import.meta.url)));
const compiled = compileProject(project.entry, project.read);
const saved = [];
const host = new Map([
  ['operations.tt::Clock', () => BigInt(Date.now())],
  ['operations.tt::Save', total => { saved.push(total); }],
  ['operations.tt::Emit', text => { process.stdout.write(`[host log] ${text}\n`); }],
]);
const executed = execute(compiled.wasm, { host });
console.log(executed.output);
console.log('saved totals:', saved.map(String).join(', '));
console.log('inferred escaping effects:', compiled.effects.join(', '));
