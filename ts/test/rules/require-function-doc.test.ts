import { describe, expect, it } from 'vitest';
import hasRequiredFunctionDocs, {
  findRequiredFunctionDocFailure,
} from '../../src/rules/require-function-doc';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// ============================================================================
// hasRequiredFunctionDocs — checks exported declarations have non-empty JSDoc
// ============================================================================

describe('hasRequiredFunctionDocs', (): void => {
  it('checks for exported declarations before scanning ambient declaration headers', (): void => {
    const sourceWithoutExports = 'const text = "declare module";\n'.repeat(1000);

    expect(hasRequiredFunctionDocs(sourceWithoutExports)).toBe(true);
  });

  it('validates exported declarations without allocating an export position list', (): void => {
    const source = readFileSync(
      new URL('../../src/rules/require-function-doc.ts', import.meta.url),
      'utf-8',
    );

    expect(source).not.toContain('const exportPositions: number[] = []');
  });

  // ── passes: documented exported functions ─────────────────────────────

  it('passes for exported function with JSDoc', (): void => {
    const src =
      '/** Authenticates a user. */\nexport function login(user: string, pass: string): boolean {\n  return true;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for default export function with JSDoc', (): void => {
    const src = '/** Default entry point. */\nexport default function main() {\n  return 0;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported async function with JSDoc', (): void => {
    const src =
      '/** Fetches user data. */\nexport async function fetchUser(id: string) {\n  return {};\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported class with JSDoc', (): void => {
    const src =
      '/** Represents a user entity. */\nexport class User {\n  constructor(public name: string) {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported const arrow function with JSDoc', (): void => {
    const src =
      '/** Formats a date. */\nexport const formatDate = (d: Date): string => d.toISOString();';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported const with JSDoc (non-arrow)', (): void => {
    const src = '/** API base URL. */\nexport const API_URL = "https://api.example.com";';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported type with JSDoc', (): void => {
    const src =
      '/** User configuration options. */\nexport type UserConfig = {\n  name: string;\n};';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported interface with JSDoc', (): void => {
    const src = '/** Authentication result. */\nexport interface AuthResult {\n  token: string;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported enum with JSDoc', (): void => {
    const src = '/** HTTP status codes. */\nexport enum Status {\n  OK = 200,\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for multi-line JSDoc on export', (): void => {
    const src = `/**
 * Performs a deep merge of two objects.
 * @param target - The target object.
 * @param source - The source object.
 * @returns The merged object.
 * @throws {TypeError} If either argument is not an object.
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  return { ...target, ...source };
}`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for file with no exports at all', (): void => {
    const src = 'function helper() { return 1; }\nconst x = 1;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for file with only import/export re-exports', (): void => {
    const src = "export { foo } from './foo';\nexport type { Bar } from './bar';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── passes: JSDoc after shebang ───────────────────────────────────────

  it('passes for shebang + JSDoc + export', (): void => {
    const src = '#!/usr/bin/env node\n/** CLI entry. */\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for shebang + whitespace + JSDoc + export', (): void => {
    const src = '#!/usr/bin/env node\n\n/** CLI entry. */\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── passes: multiple documented exports ───────────────────────────────

  it('passes when all exports are documented', (): void => {
    const src = `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b; }

/** Subtracts two numbers. */
export function sub(a: number, b: number): number { return a - b; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── fails: missing JSDoc on export ────────────────────────────────────

  it('fails when exported function has no JSDoc', (): void => {
    const src = 'export function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported async function has no JSDoc', (): void => {
    const src = 'export async function fetchData() { return {}; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported default function has no JSDoc', (): void => {
    const src = 'export default function main() { return 0; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported class has no JSDoc', (): void => {
    const src = 'export class Product { constructor(public id: number) {} }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported const has no JSDoc', (): void => {
    const src = 'export const VERSION = "1.0.0";';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported arrow function has no JSDoc', (): void => {
    const src = 'export const getFoo = () => "foo";';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported type has no JSDoc', (): void => {
    const src = 'export type Id = string;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported interface has no JSDoc', (): void => {
    const src = 'export interface Config { port: number; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported enum has no JSDoc', (): void => {
    const src = 'export enum Color { Red, Blue }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when a local export list hides an undocumented declaration', (): void => {
    const src = 'const hidden = () => true;\nexport { hidden };';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when a local export list points to a documented declaration', (): void => {
    const src =
      '/**\n * Hidden implementation export.\n * @internal\n */\nconst hidden = () => true;\nexport { hidden };';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── fails: empty JSDoc ────────────────────────────────────────────────

  it('fails when JSDoc is empty (no description)', (): void => {
    const src = '/** */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when JSDoc is whitespace-only', (): void => {
    const src = '/**\n * \n */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when JSDoc has only tags but no description', (): void => {
    const src =
      '/**\n * @param a - first number\n * @returns sum\n */\nexport function add(a: number): number { return a + 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── fails: mixed documented/undocumented ──────────────────────────────

  it('fails when one export is documented but another is not', (): void => {
    const src = `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b; }

export function sub(a: number, b: number): number { return a - b; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── passes: non-export JSDoc is irrelevant ────────────────────────────

  it('passes when non-exported function has no doc (only exports matter)', (): void => {
    const src = `/** Documented export. */
export function pub(): void {}

function localHelper(): void {}`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── re-exports ────────────────────────────────────────────────────────

  it('passes for re-exports without doc', (): void => {
    const src = "export { foo } from './foo';\nexport { bar as default } from './bar';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for export type re-exports without doc', (): void => {
    const src = "export type { User } from './models';\nexport type { Config } from './config';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for barrel file re-exporting everything', (): void => {
    const src = "export * from './utils';\nexport * from './types';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge cases ────────────────────────────────────────────────────────

  it('fails for export with comment that is not JSDoc', (): void => {
    const src = '// just a comment\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails for export with block comment that is not JSDoc', (): void => {
    const src = '/* not JSDoc */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('handles shebang + undocumented export', (): void => {
    const src = '#!/usr/bin/env node\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('handles doc directly before export (with imports in between is wrong place)', (): void => {
    // JSDoc must be immediately before the export — an import between
    // doc and export means the doc is for something else (or file-level).
    // File-level docs are handled by require-file-doc rule.
    const src = `/** Docs for module */
import { x } from './x';

export function foo() { return 1; }`;
    // Doc is separated from export by an import — fails
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when JSDoc is directly before export (standard pattern)', (): void => {
    const src = `import { x } from './x';

/** Docs for foo */
export function foo() { return 1; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── multiple exports on one line ─────────────────────────────────────

  it('handles export const on one line with JSDoc', (): void => {
    const src = '/** Doc. */ export const A = 1, B = 2;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('handles export const on one line without JSDoc', (): void => {
    const src = 'export const A = 1, B = 2;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── keyword combinations ─────────────────────────────────────────────

  it('passes for export abstract class with JSDoc', (): void => {
    const src =
      '/** Base handler. */\nexport abstract class Handler {\n  abstract handle(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export abstract class without JSDoc', (): void => {
    const src = 'export abstract class Handler {\n  abstract handle(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export default async function with JSDoc', (): void => {
    const src = '/** Boot sequence. */\nexport default async function boot() {\n  await init();\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export default async function without JSDoc', (): void => {
    const src = 'export default async function boot() {\n  await init();\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails for export default async function without JSDoc (combined keywords)', (): void => {
    const src = 'export default async function init() {\n  return;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export let with JSDoc', (): void => {
    const src = '/** Mutable counter. */\nexport let counter = 0;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export let without JSDoc', (): void => {
    const src = 'export let counter = 0;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export var with JSDoc', (): void => {
    const src = '/** Legacy flag. */\nexport var flag = true;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export var without JSDoc', (): void => {
    const src = 'export var flag = true;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── non-whitespace preceding export ─────────────────────────────────

  it('skips "export" when preceded by non-whitespace (e.g. reexport)', (): void => {
    // "reexport" contains "export" but is not an export keyword
    const src = 'const reexport = 1;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('correctly finds export after preceding content on different line', (): void => {
    // export is at start of line after } — the newline is whitespace
    const src = 'function bar() {}\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when export after preceding content has JSDoc', (): void => {
    const src = 'function bar() {}\n\n/** Docs. */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── whitespace edge cases ────────────────────────────────────────────

  it('handles tab characters before JSDoc on export', (): void => {
    const src = '\t\t/** Docs. */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('handles CRLF line endings on export without JSDoc', (): void => {
    const src = '/** Docs. */\r\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('handles CRLF line endings failing case', (): void => {
    const src = 'export function foo() {}\r\n';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── JSDoc content edge cases ─────────────────────────────────────────

  it('fails when JSDoc is only asterisk markers with no text', (): void => {
    const src = '/**\n *\n *\n */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when JSDoc has text mixed with asterisk-only lines', (): void => {
    const src = '/**\n *\n * Actual description.\n */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── exports deeper in the file ───────────────────────────────────────

  it('fails when first export is documented but second deeper export is not', (): void => {
    const src = `/** First. */
export function a() {}

const helper = () => {};

export function b() {}`;
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── exports at end of file ───────────────────────────────────────────

  it('handles export with multiple spaces before declaration', (): void => {
    const src = '/** Docs. */\nexport   function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('handles export default with multiple spaces before async', (): void => {
    const src = '/** Boot. */\nexport default   async function boot() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes when only export is at end of file with JSDoc', (): void => {
    const src = `import { x } from './x';\n\n/** Final export. */\nexport function last() {}`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FALSE POSITIVE PREVENTION — patterns that should NOT require docs
  // ═══════════════════════════════════════════════════════════════════════

  // ── expression defaults ──────────────────────────────────────────────

  it('skips export default with literal expression', (): void => {
    const src = 'export default 42;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export default with object expression', (): void => {
    const src = 'export default { foo: "bar" };';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export default with new operator', (): void => {
    const src = 'export default new Map();';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export default with IIFE', (): void => {
    const src = 'export default (() => { return 1; })();';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export default with computed expression', (): void => {
    const src = 'export default config.port || 3000;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export default with identifier reference', (): void => {
    const src = 'const App = {};\nexport default App;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── CommonJS / UMD / legacy patterns ─────────────────────────────────

  it('skips export = (CommonJS namespace export)', (): void => {
    const src = 'export = React;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export = with complex expression', (): void => {
    const src = 'export = function foo() { return 1; };';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export as namespace (UMD global declaration)', (): void => {
    const src = 'export as namespace mathLib;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export as namespace with export = combo', (): void => {
    const src = 'export = React;\nexport as namespace React;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── declare / ambient patterns ───────────────────────────────────────

  it('skips declare export function (ambient declaration)', (): void => {
    // In .d.ts files, the declare keyword makes this ambient
    const src = 'declare export function parse(cmd: string): Args;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips declare export class (ambient class)', (): void => {
    const src = 'declare export class EventBus {\n  on(e: string, fn: Function): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export in declare module block', (): void => {
    const src = 'declare module "fs" {\n  export function readFile(p: string): string;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export in declare namespace block', (): void => {
    const src = 'declare namespace Internal {\n  export function helper(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips declare global augmentation export', (): void => {
    const src = 'declare global {\n  export function gc(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── inline type-only exports ─────────────────────────────────────────

  it('fails for local export type lists without documented declarations', (): void => {
    const src = 'export { type A, type B };';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('skips export type * from (wildcard type re-export)', (): void => {
    const src = "export type * from './types';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips export type * as NS from', (): void => {
    const src = "export type * as Types from './types';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── export namespace ─────────────────────────────────────────────────

  it('fails for export namespace without JSDoc', (): void => {
    const src =
      'export namespace MathUtil {\n  export function add(a: number, b: number): number { return a + b; }\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when export namespace has doc but inner export does not', (): void => {
    // Inner `export function add` also needs its own JSDoc
    const src =
      '/** Math utilities. */\nexport namespace MathUtil {\n  export function add(a: number, b: number): number { return a + b; }\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when export namespace and all inner exports have JSDoc', (): void => {
    const src =
      '/** Math utilities. */\nexport namespace MathUtil {\n  /** Adds two numbers. */\n  export function add(a: number, b: number): number { return a + b; }\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── overloaded function declarations ─────────────────────────────────

  it('KNOWN LIMITATION: flags all overload signatures as undocumented', (): void => {
    // Only the implementation should need docs, but source scanning can\'t
    // distinguish declaration-only overloads from the implementation.
    const src = `/** Parses input. */
export function parse(input: string): AST;
export function parse(input: string, options: Options): AST;
export function parse(input: string, options?: Options): AST {
  return {} as AST;
}`;
    // Current behavior: flags the second overload as undocumented (false positive)
    // Ideal: should detect that the first overload has doc and accept the pattern
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── JSDoc before decorator ───────────────────────────────────────────

  it('KNOWN LIMITATION: JSDoc before decorator not recognized', (): void => {
    // JSDoc is above the decorator, not directly before export.
    // The decorator creates a gap our backwards scan doesn\'t cross.
    const src = '/** Controller. */\n@Controller()\nexport class AppController {}';
    // Current: fails (JSDoc not found directly before export)
    // Ideal: should detect JSDoc above the decorator
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when JSDoc is directly before export (decorator after)', (): void => {
    // This is valid: JSDoc belongs to the export, decorator is part of the declaration
    const src = '@Controller()\n/** Controller. */\nexport class AppController {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── override methods (class members) ─────────────────────────────────

  it('correctly ignores method definitions on exported class', (): void => {
    // Method `on` is not itself an export — only the class is
    const src = '/** Event bus. */\nexport class EventBus {\n  on(event: string) {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails when exported class has no JSDoc (methods irrelevant)', (): void => {
    const src = 'export class EventBus {\n  /** Handles event. */\n  on(event: string) {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── triple-slash directives ──────────────────────────────────────────

  it('skips triple-slash reference with export following', (): void => {
    const src = '/// <reference path="./types.d.ts" />\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for triple-slash reference + documented export', (): void => {
    const src = '/// <reference path="./types.d.ts" />\n/** Foo. */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── shebang + multiple exports ───────────────────────────────────────

  it('fails when shebang file has undocumented export', (): void => {
    const src = '#!/usr/bin/env node\n\nexport function main() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when shebang file has documented export', (): void => {
    const src = '#!/usr/bin/env node\n\n/** Entry. */\nexport function main() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── export from index barrel files ───────────────────────────────────

  it('skips barrel export * without doc', (): void => {
    const src = 'export * from "./utils";\nexport * from "./types";';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips barrel export * with only type exports mixed in', (): void => {
    const src =
      'export * from "./utils";\nexport type * from "./types";\nexport { default } from "./main";';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge: empty export (zero-length file) ────────────────────────────

  it('passes for empty file', (): void => {
    expect(hasRequiredFunctionDocs('')).toBe(true);
  });

  // ── edge: export at very start of file ───────────────────────────────

  it('fails for export at position 0 without JSDoc', (): void => {
    const src = 'export function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export at position 0 with JSDoc', (): void => {
    const src = '/** Doc. */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge: export with Unicode in JSDoc ───────────────────────────────

  it('passes for JSDoc with Unicode description', (): void => {
    const src = '/** Résumé handler — processes UTF-8. */\nexport function handler() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge: JSDoc with embedded /* ─────────────────────────────────────

  it('handles JSDoc containing /* as example code', (): void => {
    const src = '/**\n * Usage: /* comment */\n */\nexport function foo() {}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge: export in template literal (should not match) ───────────────

  it('ignores export keyword inside template literal', (): void => {
    const src = 'const msg = `export function fake() {}`;\nexport function real() {}';
    // "export function fake" is in a string — but source scanning sees it.
    // fake export at start of template literal would be detected.
    // The real export at end lacks JSDoc → fails
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('ignores generated-code exports inside strings when real exports are documented', (): void => {
    const src = `const indexContent = \`export * from './lib/generated.js';\\n\`;
const cliContent = [
  'export interface CliIo {',
  'export async function run(args: readonly string[]): Promise<number> {',
  'export default [',
].join('\\n');

/** Real public API. */
export function real(): void {}`;

    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('reports the first real undocumented export instead of generated-code strings', (): void => {
    const src = `const cliContent = [
  'export interface GeneratedCliIo {',
  'export async function generatedRun(): Promise<number> {',
].join('\\n');

export interface CliIo {
  info: (message: string) => void;
}`;

    expect(findRequiredFunctionDocFailure(src)).toEqual({
      line: 6,
      snippet: 'export interface CliIo {',
    });
  });

  // ── export default class / interface ─────────────────────────────────

  it('passes for export default class with JSDoc', (): void => {
    const src = '/** Default handler. */\nexport default class DefaultHandler {\n  handle() {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export default class without JSDoc', (): void => {
    const src = 'export default class DefaultHandler {\n  handle() {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export default interface with JSDoc', (): void => {
    const src =
      '/** Default config shape. */\nexport default interface DefaultConfig {\n  port: number;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('fails for export default interface without JSDoc', (): void => {
    const src = 'export default interface DefaultConfig {\n  port: number;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes for export default abstract class with JSDoc', (): void => {
    const src =
      '/** Base entity. */\nexport default abstract class BaseEntity {\n  abstract id: string;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── declare module edge cases ────────────────────────────────────────

  it('skips exports inside declare module with JSDoc anyway', (): void => {
    // Even with JSDoc, ambient module exports are skipped
    const src = '/** Not needed. */\ndeclare module "test" {\n  export function run(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('skips declare module with shebang', (): void => {
    const src = '#!/usr/bin/env node\ndeclare module "test" {\n  export function run(): void;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── word boundary in endsWithWord ────────────────────────────────────

  it('does not confuse const with class for default export', (): void => {
    const src = 'export default constValue;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('does not confuse interface with identifier starting with i', (): void => {
    const src = 'export default item;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('checks JSDoc content without splitting the whole comment into line arrays', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/rules/require-function-doc.ts', import.meta.url)),
      'utf-8',
    );

    expect(source).not.toContain(".split('\\n')");
  });
});
