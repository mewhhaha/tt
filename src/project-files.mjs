/** Opt-in local filesystem source provider. Compiler APIs do not read files themselves. */
import { realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, basename, resolve, relative, isAbsolute } from 'node:path';
import { modulePath } from './modules.mjs';
import { fail, LIMITS, TTError } from './core.mjs';
export function fileProject(entryFile) {
  let full;
  try { full = realpathSync(entryFile); } catch (e) { fail(0, `cannot resolve entry: ${e.code}`, 'E_IO'); }
  const root = dirname(full), entry = basename(full), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const read = name => {
    modulePath(name); let path, fd;
    try {
      path = realpathSync(resolve(root, name)); const rel = relative(root, path);
      if (rel.startsWith('..') || isAbsolute(rel)) fail(0, 'module symlink escapes project root', 'E_MODULE');
      const info = statSync(path); if (!info.isFile()) fail(0, 'module source must be a regular file', 'E_IO');
      const size = info.size;
      if (size > LIMITS.sourceBytes) fail(0, 'module source size limit exceeded', 'E_LIMIT');
      fd = openSync(path, 'r'); if (!fstatSync(fd).isFile()) fail(0, 'module source must be a regular file', 'E_IO');
      const bytes = Buffer.alloc(size); let at = 0;
      while (at < size) { const n = readSync(fd, bytes, at, size - at, null); if (!n) fail(0, 'module changed while reading', 'E_IO'); at += n; }
      if (readSync(fd, Buffer.alloc(1), 0, 1, null)) fail(0, 'module grew while reading', 'E_IO');
      try { return decoder.decode(bytes); } catch { fail(0, 'module source is not valid UTF-8', 'E_PARSE'); }
    } catch (e) { if (e instanceof TTError) throw e; fail(0, `cannot read module '${name}': ${e.code ?? e.message}`, 'E_IO'); }
    finally { if (fd !== undefined) closeSync(fd); }
  };
  return { entry, read };
}
