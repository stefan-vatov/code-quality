import { describe, expect, it } from 'vitest';
import hasRequiredFunctionDocs from '../../src/rules/require-function-doc.js';

// ============================================================================
// hasRequiredFunctionDocs — checks exported declarations have non-empty JSDoc
// ============================================================================

describe('hasRequiredFunctionDocs', () => {
  // ── passes: documented exported functions ─────────────────────────────

  it('passes for exported function with JSDoc', () => {
    const src = '/** Authenticates a user. */\nexport function login(user: string, pass: string): boolean {\n  return true;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for default export function with JSDoc', () => {
    const src = '/** Default entry point. */\nexport default function main() {\n  return 0;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported async function with JSDoc', () => {
    const src = '/** Fetches user data. */\nexport async function fetchUser(id: string) {\n  return {};\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported class with JSDoc', () => {
    const src = '/** Represents a user entity. */\nexport class User {\n  constructor(public name: string) {}\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported const arrow function with JSDoc', () => {
    const src = '/** Formats a date. */\nexport const formatDate = (d: Date): string => d.toISOString();';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported const with JSDoc (non-arrow)', () => {
    const src = '/** API base URL. */\nexport const API_URL = "https://api.example.com";';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported type with JSDoc', () => {
    const src = '/** User configuration options. */\nexport type UserConfig = {\n  name: string;\n};';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported interface with JSDoc', () => {
    const src = '/** Authentication result. */\nexport interface AuthResult {\n  token: string;\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for exported enum with JSDoc', () => {
    const src = '/** HTTP status codes. */\nexport enum Status {\n  OK = 200,\n}';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for multi-line JSDoc on export', () => {
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

  it('passes for file with no exports at all', () => {
    const src = 'function helper() { return 1; }\nconst x = 1;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for file with only import/export re-exports', () => {
    const src = "export { foo } from './foo';\nexport type { Bar } from './bar';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── passes: JSDoc after shebang ───────────────────────────────────────

  it('passes for shebang + JSDoc + export', () => {
    const src = '#!/usr/bin/env node\n/** CLI entry. */\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for shebang + whitespace + JSDoc + export', () => {
    const src = '#!/usr/bin/env node\n\n/** CLI entry. */\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── passes: multiple documented exports ───────────────────────────────

  it('passes when all exports are documented', () => {
    const src = `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b; }

/** Subtracts two numbers. */
export function sub(a: number, b: number): number { return a - b; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── fails: missing JSDoc on export ────────────────────────────────────

  it('fails when exported function has no JSDoc', () => {
    const src = 'export function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported async function has no JSDoc', () => {
    const src = 'export async function fetchData() { return {}; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported default function has no JSDoc', () => {
    const src = 'export default function main() { return 0; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported class has no JSDoc', () => {
    const src = 'export class Product { constructor(public id: number) {} }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported const has no JSDoc', () => {
    const src = 'export const VERSION = "1.0.0";';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported arrow function has no JSDoc', () => {
    const src = 'export const getFoo = () => "foo";';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported type has no JSDoc', () => {
    const src = 'export type Id = string;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported interface has no JSDoc', () => {
    const src = 'export interface Config { port: number; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when exported enum has no JSDoc', () => {
    const src = 'export enum Color { Red, Blue }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── fails: empty JSDoc ────────────────────────────────────────────────

  it('fails when JSDoc is empty (no description)', () => {
    const src = '/** */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails when JSDoc is whitespace-only', () => {
    const src = '/**\n * \n */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when JSDoc has only tags but no description', () => {
    // Edge case: @param only, no description text. This is still "documented."
    const src = '/**\n * @param a - first number\n * @returns sum\n */\nexport function add(a: number): number { return a + 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── fails: mixed documented/undocumented ──────────────────────────────

  it('fails when one export is documented but another is not', () => {
    const src = `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b; }

export function sub(a: number, b: number): number { return a - b; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  // ── passes: non-export JSDoc is irrelevant ────────────────────────────

  it('passes when non-exported function has no doc (only exports matter)', () => {
    const src = `/** Documented export. */
export function pub(): void {}

function localHelper(): void {}`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── re-exports ────────────────────────────────────────────────────────

  it('passes for re-exports without doc', () => {
    const src = "export { foo } from './foo';\nexport { bar as default } from './bar';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for export type re-exports without doc', () => {
    const src = "export type { User } from './models';\nexport type { Config } from './config';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('passes for barrel file re-exporting everything', () => {
    const src = "export * from './utils';\nexport * from './types';";
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── edge cases ────────────────────────────────────────────────────────

  it('fails for export with comment that is not JSDoc', () => {
    const src = '// just a comment\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('fails for export with block comment that is not JSDoc', () => {
    const src = '/* not JSDoc */\nexport function foo() { return 1; }';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('handles shebang + undocumented export', () => {
    const src = '#!/usr/bin/env node\nexport function cli() {}\n';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('handles doc directly before export (with imports in between is wrong place)', () => {
    // JSDoc must be immediately before the export — an import between
    // doc and export means the doc is for something else (or file-level).
    // File-level docs are handled by require-file-doc rule.
    const src = `/** Docs for module */
import { x } from './x';

export function foo() { return 1; }`;
    // Doc is separated from export by an import — fails
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });

  it('passes when JSDoc is directly before export (standard pattern)', () => {
    const src = `import { x } from './x';

/** Docs for foo */
export function foo() { return 1; }`;
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  // ── multiple exports on one line ─────────────────────────────────────

  it('handles export const on one line with JSDoc', () => {
    const src = '/** Doc. */ export const A = 1, B = 2;';
    expect(hasRequiredFunctionDocs(src)).toBe(true);
  });

  it('handles export const on one line without JSDoc', () => {
    const src = 'export const A = 1, B = 2;';
    expect(hasRequiredFunctionDocs(src)).toBe(false);
  });
});
