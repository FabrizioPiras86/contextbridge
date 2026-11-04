import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');

// Packaging uses the same strip-only semantics as the development runtime.
// The repository uses static, single-line relative imports with explicit .ts extensions.
async function emit(relative = '') {
  const entries = await readdir(join(root, 'src', relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await emit(path);
    else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const source = await readFile(join(root, 'src', path), 'utf8');
      const javascript = stripTypeScriptTypes(source, { mode: 'strip' }).replace(
        /^(import\s+[^\n]*?\s+from\s+)(['"])(\.{1,2}\/[^'"\n]+)\.ts\2/gm,
        '$1$2$3.js$2',
      );
      const target = join(output, path.replace(/\.ts$/, '.js'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, javascript);
    } else throw new Error(`Unsupported source entry: ${path}`);
  }
}

// dist is disposable build output; cleaning prevents stale modules entering a tarball.
await rm(output, { recursive: true, force: true });
await emit();
