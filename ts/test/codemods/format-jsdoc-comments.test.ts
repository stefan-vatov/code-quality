import { describe, expect, it } from 'vitest';
import { formatJSDocComments } from '../../src/codemods/format-jsdoc-comments';

describe('formatJSDocComments', () => {
  it('rewrites single-line file headers into classic block JSDoc', () => {
    const source = `/** @internal Conservative codemod for safe func-style declaration rewrites. */
import ts from 'typescript';
`;

    expect(formatJSDocComments(source)).toBe(`/**
 * Conservative codemod for safe func-style declaration rewrites.
 *
 * @internal
 */
import ts from 'typescript';
`);
  });

  it('rewrites generated internal export docs to the same style', () => {
    const source = `/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const value = 1;
`;

    expect(formatJSDocComments(source)).toBe(`/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const value = 1;
`);
  });

  it('keeps normal multi-line JSDoc unchanged', () => {
    const source = `/**
 * Already formatted.
 *
 * @public
 */
export const value = 1;
`;

    expect(formatJSDocComments(source)).toBe(source);
  });

  it('rewrites untagged helper JSDoc into classic block JSDoc', () => {
    const source = `/** Split a mixedCase identifier into word segments. */
const splitMixedCase = (name: string): string[] => [];
`;

    expect(formatJSDocComments(source)).toBe(`/**
 * Split a mixedCase identifier into word segments.
 */
const splitMixedCase = (name: string): string[] => [];
`);
  });

  it('does not rewrite JSDoc-like text inside string literals', () => {
    const source = `const marker = '/** @internal string marker. */';
`;

    expect(formatJSDocComments(source)).toBe(source);
  });

  it('preserves parameter and return tags as separate JSDoc lines', () => {
    const source = `/** Builds config.
 *
 * @param options - Feature flags for type-aware checks and Effect rule buckets.
 * @returns Oxlint configuration with native rules and package-local custom rules.
 * @public
 */
export function build(options: Options): Config {}
`;

    expect(formatJSDocComments(source)).toBe(`/**
 * Builds config.
 *
 * @param options - Feature flags for type-aware checks and Effect rule buckets.
 * @returns Oxlint configuration with native rules and package-local custom rules.
 * @public
 */
export function build(options: Options): Config {}
`);
  });

  it('splits collapsed inline JSDoc tags back onto separate lines', () => {
    const source = `/**
 * Builds config. @param options - Feature flags for type-aware checks. @returns Oxlint configuration.
 *
 * @public
 */
export function build(options: Options): Config {}
`;

    expect(formatJSDocComments(source)).toBe(`/**
 * Builds config.
 *
 * @param options - Feature flags for type-aware checks.
 * @returns Oxlint configuration.
 * @public
 */
export function build(options: Options): Config {}
`);
  });
});
