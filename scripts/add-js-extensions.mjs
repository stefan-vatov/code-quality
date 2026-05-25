/** @internal Adds runtime ESM extensions to emitted package files. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import ts from 'typescript';

const distDirectory = new URL('../ts/dist', import.meta.url);
const emittedFileExtensions = new Set(['.d.ts', '.js']);

const emittedFiles = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && emittedFileExtensions.has(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));

const hasJavaScriptTarget = (filePath, specifier) => {
  const base = join(dirname(filePath), specifier);
  return existsSync(`${base}.js`) || existsSync(join(base, 'index.js'));
};

const rewriteSpecifier = (filePath, specifier) => {
  if (!/^\.\.?\//u.test(specifier) || extname(specifier) !== '') {
    return specifier;
  }
  return hasJavaScriptTarget(filePath, specifier) ? `${specifier}.js` : specifier;
};

const collectReplacements = (filePath, text) => {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const replacements = [];

  source.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const nextSpecifier = rewriteSpecifier(filePath, node.moduleSpecifier.text);
      if (nextSpecifier !== node.moduleSpecifier.text) {
        replacements.push([
          node.moduleSpecifier.getStart(source) + 1,
          node.moduleSpecifier.getEnd() - 1,
          nextSpecifier,
        ]);
      }
    }
  });

  return replacements;
};

for (const filePath of emittedFiles(distDirectory)) {
  const text = readFileSync(filePath, 'utf-8');
  const replacements = collectReplacements(filePath, text);
  if (replacements.length === 0) {
    continue;
  }

  let nextText = text;
  for (const [start, end, specifier] of replacements.sort((a, b) => b[0] - a[0])) {
    nextText = `${nextText.slice(0, start)}${specifier}${nextText.slice(end)}`;
  }
  writeFileSync(filePath, nextText);
}
