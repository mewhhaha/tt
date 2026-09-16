/** Repository policy checks for the supported Node/Wasm-only implementation. */
import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ignoredDirectories = new Set(['.git', 'node_modules', 'coverage']);
const forbiddenBasenames = new Set(['CMakeLists.txt']);
const forbiddenExtensions = ['.cpp', '.hpp', '.py'];

export function legacyImplementationFiles(root) {
  const found = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const path = join(directory, entry.name);
      if (forbiddenBasenames.has(basename(path)) || forbiddenExtensions.some(ext => entry.name.endsWith(ext)))
        found.push(relative(root, path).split('\\').join('/'));
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return found.sort();
}

export function assertRepositoryPolicy(root) {
  const legacy = legacyImplementationFiles(root);
  if (legacy.length) throw new Error(`legacy C++/Python implementation files are forbidden:\n${legacy.map(x => `  ${x}`).join('\n')}`);
}
