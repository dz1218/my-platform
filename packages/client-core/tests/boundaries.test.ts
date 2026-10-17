import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = join(dirname(fileURLToPath(import.meta.url)), '../src');
async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}
test('portable domains have no application, renderer, SDK or browser dependency', async () => {
  for (const path of await files(source)) {
    const name = relative(source, path);
    if (name === 'react.ts') continue;
    const code = await readFile(path, 'utf8');
    const imports = [...code.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const dependency of imports) assert.ok(dependency.startsWith('.') || dependency === '@my-platform/shared' || dependency === '@tanstack/query-core' || dependency.startsWith('zustand/'), `${name}: unexpected dependency ${dependency}`);
    assert.doesNotMatch(code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), /\b(window|document|localStorage|sessionStorage|WebSocket|TextEncoder|TextDecoder|crypto|setTimeout|setInterval)\b/, name);
  }
});
