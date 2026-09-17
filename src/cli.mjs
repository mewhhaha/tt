#!/usr/bin/env node
import { readFileSync, openSync, fstatSync, readSync, closeSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile, compileProject, execute, TTError } from './compiler.mjs';
import { fileProject } from './project-files.mjs';
import { LIMITS, fail } from './core.mjs';

export function readInput(path, max) {
  let fd;
  try {
    fd = openSync(path, 'r'); const st = fstatSync(fd);
    if (!st.isFile()) fail(0, 'input must be a regular file', 'E_IO');
    if (st.size > max) fail(0, 'input file size limit exceeded', 'E_LIMIT');
    // Read no more than the checked bound even when another writer grows the file.
    const bytes = Buffer.alloc(st.size); let at = 0;
    while (at < bytes.length) { const n = readSync(fd, bytes, at, bytes.length - at, null); if (!n) fail(0, 'input changed while reading', 'E_IO'); at += n; }
    const extra = Buffer.alloc(1); if (readSync(fd, extra, 0, 1, null)) fail(0, 'input grew while reading', 'E_IO');
    return bytes;
  } catch (e) { if (e instanceof TTError) throw e; fail(0, `cannot read '${path}': ${e.code ?? e.message}`, 'E_IO'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function writeArtifact(path, bytes) {
  const temp = `${path}.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
  let created = false;
  try {
    const fd = openSync(temp, 'wx', 0o600); created = true;
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    renameSync(temp, path); created = false;
  } catch (e) { fail(0, `cannot write '${path}': ${e.code ?? e.message}`, 'E_IO'); }
  finally { if (created) { try { unlinkSync(temp); } catch { /* preserve the original write diagnostic */ } } }
}
const usage = 'usage: node src/cli.mjs check|run SOURCE [--metrics]\n       node src/cli.mjs build SOURCE -o OUTPUT.wasm\n       node src/cli.mjs exec ARTIFACT.wasm\n';
export function main(args = process.argv.slice(2)) {
  let source = '', path = args[1] ?? '';
  try {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(usage); return 0; }
    if (args.length === 1 && args[0] === '--version') { console.log('tt 0.4.0 (Node.js compiler, WebAssembly-only target)'); return 0; }
    if (args.length < 2) { process.stderr.write(usage); return 2; }
    const command = args[0];
    if (command === 'exec') {
      if (args.length !== 2) fail(0, 'unexpected arguments', 'E_USAGE');
      console.log(execute(readInput(path, LIMITS.artifactBytes)).output); return 0;
    }
    if (!['check', 'run', 'build'].includes(command)) fail(0, 'unknown command', 'E_USAGE');
    const metrics = args.length === 3 && args[2] === '--metrics';
    if (command === 'build') {
      if (args.length !== 4 || args[2] !== '-o') fail(0, 'build requires -o OUTPUT', 'E_USAGE');
      if (!args[3].endsWith('.wasm')) fail(0, 'output must have .wasm extension', 'E_USAGE');
      if (resolve(path) === resolve(args[3])) fail(0, 'output must not overwrite source', 'E_USAGE');
    } else if (args.length !== 2 && !metrics) fail(0, 'unexpected arguments', 'E_USAGE');
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readInput(path, LIMITS.sourceBytes)); }
    catch (e) { if (e instanceof TTError) throw e; fail(0, 'source is not valid UTF-8', 'E_PARSE'); }
    const label = basename(path);
    const sourceName = Buffer.byteLength(label) <= 4096 && !/[\u0000-\u001f\u007f]/.test(label) ? label : '<source>';
    const project = fileProject(path);
    const c = compileProject(project.entry, name => name === project.entry ? source : project.read(name), { emit: command !== 'check' });
    if (command === 'build') writeArtifact(args[3], c.wasm);
    else if (command === 'run') console.log(execute(c.wasm).output);
    else console.log(c.type);
    if (metrics) console.error(JSON.stringify(c.metrics)); return 0;
  } catch (e) {
    if (e instanceof TTError) {
      const location = e.source;
      if (location) console.error(`${location.name || path}:${location.line}:${location.column}: ${e.code}: ${e.message}`);
      else { const before = source.slice(0, e.pos), line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
        console.error(`${path}:${line}:${column}: ${e.code}: ${e.message}`); } return e.code === 'E_USAGE' ? 2 : 1;
    }
    console.error(`E_INTERNAL: ${e.message}`); return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
