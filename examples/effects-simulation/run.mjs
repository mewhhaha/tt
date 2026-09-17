import { compileProject, execute } from '../../src/compiler.mjs';
import { fileProject } from '../../src/project-files.mjs';
import { fileURLToPath } from 'node:url';
const step = BigInt(process.argv[2] ?? '2'), axis = BigInt(process.argv[3] ?? '1');
const project = fileProject(fileURLToPath(new URL('./host.tt', import.meta.url)));
const built = compileProject(project.entry, project.read);
const result = execute(built.wasm, { host: new Map([
  ['operations.tt::Step', () => step],
  ['operations.tt::Axis', () => axis],
  ['operations.tt::Report', total => { console.log('position checksum:', String(total)); }],
]) });
console.log(result.output);
