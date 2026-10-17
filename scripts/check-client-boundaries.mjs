import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const browserGlobals = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'WebSocket', 'navigator', 'crypto']);

async function inspect(directory, packageName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(filename, packageName); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const relative = path.relative(root, filename);
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const core = packageName === 'client-core';
    const reactEntry = core && /[/\\]react(?:[/\\]|\.tsx?$)/.test(filename);
    const report = (node, message) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${relative}:${line + 1}: ${message}`);
    };
    function walk(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        if (name.startsWith('@/') || name.includes('apps/web') || /^(next(?:\/|$)|server-only$|@my-platform\/db(?:\/|$))/.test(name)) report(node, `application dependency ${name}`);
        if (core && /^(livekit-client|react-dom|@tanstack\/react-query|@my-platform\/(web-ui|mobile-web))(\/|$)/.test(name)) report(node, `platform dependency ${name}`);
        if (core && !reactEntry && (/^(react|zustand\/react)(\/|$)/.test(name) || name === 'zustand' || /(?:^|\/)react(?:\.[jt]sx?)?$/.test(name))) report(node, `React belongs in the separate /react entry: ${name}`);
      }
      if (core && ts.isIdentifier(node) && browserGlobals.has(node.text)) {
        // Ignore property names and type declarations; reject runtime globals.
        const propertyName = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
          || (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
          || (ts.isPropertySignature(node.parent) && node.parent.name === node);
        if (!propertyName) report(node, `browser global ${node.text}; inject a platform service`);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
}

for (const name of ['client-core', 'mobile-web', 'web-ui']) await inspect(path.join(root, 'packages', name, 'src'), name);
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('Client package boundaries passed.\n');
