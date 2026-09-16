import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRepositoryPolicy, legacyImplementationFiles } from '../scripts/repository-policy.mjs';

const fixture = fn => {
  const root = mkdtempSync(join(tmpdir(), 'tt-policy-'));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('repository policy accepts a dependency-free Node/Wasm tree', () => fixture(root => {
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src/compiler.mjs'), 'export const ok = true;\n');
  writeFileSync(join(root, 'docs/HISTORY_CPP.md'), '# Historical C++ implementation\n');
  assert.deepEqual(legacyImplementationFiles(root), []);
  assert.doesNotThrow(() => assertRepositoryPolicy(root));
}));

test('repository policy rejects legacy implementation files at any depth', () => fixture(root => {
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'nested'), { recursive: true });
  writeFileSync(join(root, 'CMakeLists.txt'), 'project(tt)\n');
  writeFileSync(join(root, 'src/main.cpp'), 'int main() {}\n');
  writeFileSync(join(root, 'nested/tool.py'), 'pass\n');
  assert.deepEqual(legacyImplementationFiles(root), ['CMakeLists.txt', 'nested/tool.py', 'src/main.cpp']);
  assert.throws(() => assertRepositoryPolicy(root), /legacy C\+\+\/Python implementation files are forbidden/);
}));

test('repository policy ignores generated dependency directories', () => fixture(root => {
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(root, 'node_modules/pkg/native.cpp'), 'ignored generated dependency\n');
  assert.deepEqual(legacyImplementationFiles(root), []);
}));
