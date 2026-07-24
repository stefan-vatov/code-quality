import {
  BINDING_FETCH,
  BINDING_GLOBAL_THIS,
  BINDING_PROMISE,
  isLocallyBound,
  matchingParenthesisEnd,
  skipWhitespace,
  sourceScopeIndex,
} from '../../src/rules/effect-sync-promise-scope-index';
import { describe, expect, it } from 'vitest';

const ALL_BINDINGS = BINDING_FETCH | BINDING_PROMISE | BINDING_GLOBAL_THIS;

describe('Effect sync Promise lexical scope index mutation contracts', (): void => {
  it.each([
    ['', 0, 0],
    ['abc', 0, 0],
    [' abc', 0, 1],
    ['\t\nabc', 0, 2],
    ['x  y', 1, 3],
    ['x  ', 1, 3],
    ['x', 1, 1],
  ])('skips whitespace in %j from %i to %i', (source, start, expected): void => {
    expect(skipWhitespace(source, start)).toBe(expected);
  });

  it.each([
    ['()', 0, 1],
    ['(())', 0, 3],
    ['(a(b)c)d', 0, 6],
    ['x(y)', 1, 3],
    ['(unterminated', 0, 13],
  ])('finds the matching close in %j', (source, open, expected): void => {
    expect(matchingParenthesisEnd(source, open)).toBe(expected);
  });

  it('indexes exact nested lexical scope boundaries and inherited bindings', (): void => {
    const source = 'const root = 1; { const Promise = local; { const fetch = local; use(); } }';
    const outerOpen = source.indexOf('{');
    const innerOpen = source.indexOf('{', outerOpen + 1);
    const innerClose = source.indexOf('}', innerOpen);
    const outerClose = source.lastIndexOf('}');
    const index = sourceScopeIndex(source);

    expect(index.parameterScopes).toStrictEqual([]);
    expect(index.scopes).toStrictEqual([
      { bindingMask: 0, end: source.length, parent: -1, start: 0 },
      {
        bindingMask: BINDING_PROMISE,
        end: outerClose,
        parent: 0,
        start: outerOpen + 1,
      },
      {
        bindingMask: BINDING_FETCH,
        end: innerClose,
        parent: 1,
        start: innerOpen + 1,
      },
    ]);

    const innerUse = source.indexOf('use');
    expect(isLocallyBound(index, innerUse, BINDING_PROMISE)).toBe(true);
    expect(isLocallyBound(index, innerUse, BINDING_FETCH)).toBe(true);
    expect(isLocallyBound(index, innerUse, BINDING_GLOBAL_THIS)).toBe(false);
    expect(isLocallyBound(index, source.length, BINDING_PROMISE)).toBe(false);
  });

  it.each([
    ['import { Promise, fetch, globalThis } from "values"; use();', ALL_BINDINGS],
    ['import {Promise,fetch,globalThis} from "values"; use();', ALL_BINDINGS],
    ['import {\tPromise  ,\n fetch,\tglobalThis } from "values"; use();', ALL_BINDINGS],
    ['import Promise from "values"; use();', BINDING_PROMISE],
    ['import * as fetch from "values"; use();', BINDING_FETCH],
    ['import { value as globalThis } from "values"; use();', BINDING_GLOBAL_THIS],
    ['import { value as\t\tPromise } from "values"; use();', BINDING_PROMISE],
    ['import { value as\n fetch } from "values"; use();', BINDING_FETCH],
    ['import type { Promise, fetch, globalThis } from "types"; use();', 0],
    ['import { type Promise, type fetch, type globalThis } from "types"; use();', 0],
    ['import { type\tPromise, type  fetch, type\n globalThis } from "types"; use();', 0],
    ['import { type Item as Promise, type Other as fetch } from "types"; use();', 0],
    ['import { Promise as Other, fetch as Else, globalThis as World } from "values";', 0],
    ['import { NotPromise, prefetch, globalThisValue } from "values";', 0],
    ['import { x Promise, x fetch, x globalThis } from "invalid";', 0],
    ['import { value asPromise, value asfetch, value asglobalThis } from "invalid";', 0],
    [
      'import { Other as Promise, Else as fetch, World as globalThis } from "values";',
      ALL_BINDINGS,
    ],
  ])('classifies root import bindings in %j', (source, expectedMask): void => {
    const index = sourceScopeIndex(source);

    expect(index.scopes[0]).toStrictEqual({
      bindingMask: expectedMask,
      end: source.length,
      parent: -1,
      start: 0,
    });
    expect(isLocallyBound(index, source.length - 1, BINDING_PROMISE)).toBe(
      (expectedMask & BINDING_PROMISE) !== 0,
    );
    expect(isLocallyBound(index, source.length - 1, BINDING_FETCH)).toBe(
      (expectedMask & BINDING_FETCH) !== 0,
    );
    expect(isLocallyBound(index, source.length - 1, BINDING_GLOBAL_THIS)).toBe(
      (expectedMask & BINDING_GLOBAL_THIS) !== 0,
    );
  });

  it.each([
    ['class Promise {}', BINDING_PROMISE],
    ['const fetch = local;', BINDING_FETCH],
    ['function globalThis() {}', BINDING_GLOBAL_THIS],
    [
      'let Promise = one, fetch = two; var globalThis = three;',
      BINDING_PROMISE | BINDING_GLOBAL_THIS,
    ],
  ])('classifies named declarations in %j', (source, expectedMask): void => {
    expect(sourceScopeIndex(source).scopes[0]?.bindingMask).toBe(expectedMask);
  });

  it('indexes parenthesized arrow parameters and an expression body exactly', (): void => {
    const source =
      'const task = (Promise, { fetch }, ...globalThis) => ({ value: Promise }); const tail = 1;';
    const arrow = source.indexOf('=>');
    const start = skipWhitespace(source, arrow + 2);
    const end = source.indexOf(';', start);
    const index = sourceScopeIndex(source);

    expect(index.parameterScopes).toStrictEqual([{ bindingMask: ALL_BINDINGS, end, start }]);
    expect(isLocallyBound(index, start, BINDING_PROMISE)).toBe(true);
    expect(isLocallyBound(index, end - 1, BINDING_FETCH)).toBe(true);
    expect(isLocallyBound(index, end, BINDING_GLOBAL_THIS)).toBe(false);
  });

  it.each([
    ['Promise', BINDING_PROMISE],
    ['fetch', BINDING_FETCH],
    ['globalThis', BINDING_GLOBAL_THIS],
    ['...Promise', BINDING_PROMISE],
    ['... Promise', BINDING_PROMISE],
    ['...  fetch', BINDING_FETCH],
    ['...\tglobalThis', BINDING_GLOBAL_THIS],
    ['{Promise}', BINDING_PROMISE],
    ['{ Promise: alias }', BINDING_PROMISE],
    ['Promise = fallback', BINDING_PROMISE],
    ['PromiseValue', 0],
    ['prefetch', 0],
    ['globalThisValue', 0],
    ['x Promise', 0],
    ['x fetch', 0],
    ['x globalThis', 0],
    ['{ alias: Promise }', 0],
  ])('classifies parenthesized parameter text %j', (parameters, expectedMask): void => {
    const source = `const task = (${parameters}) => value;`;
    const arrow = source.indexOf('=>');
    const start = skipWhitespace(source, arrow + 2);
    const scopes = sourceScopeIndex(source).parameterScopes;

    if (expectedMask === 0) {
      expect(scopes).toStrictEqual([]);
      return;
    }
    expect(scopes).toStrictEqual([
      {
        bindingMask: expectedMask,
        end: source.indexOf(';'),
        start,
      },
    ]);
  });

  it.each([
    ['const task = Promise => Promise.resolve(1), tail = 1;', BINDING_PROMISE],
    ['const task = async fetch => fetch("/"), tail = 1;', BINDING_FETCH],
    ['const task = globalThis => globalThis.value;', BINDING_GLOBAL_THIS],
    ['Promise => value;', BINDING_PROMISE],
    ['const task = async  Promise => value;', BINDING_PROMISE],
    ['const task = fetch=>value;', BINDING_FETCH],
  ])('indexes a single arrow parameter in %j', (source, expectedMask): void => {
    const arrow = source.indexOf('=>');
    const start = skipWhitespace(source, arrow + 2);
    const end = source.search(/[,;]/);
    const [scope] = sourceScopeIndex(source).parameterScopes;

    expect(scope).toStrictEqual({ bindingMask: expectedMask, end, start });
    expect(isLocallyBound(sourceScopeIndex(source), start, expectedMask)).toBe(true);
    expect(isLocallyBound(sourceScopeIndex(source), end, expectedMask)).toBe(false);
  });

  it.each([
    'const task = PromiseValue => value;',
    'const task = prefetch => value;',
    'const task = globalThisValue => value;',
  ])('rejects a single-arrow parameter lookalike in %j', (source): void => {
    expect(sourceScopeIndex(source).parameterScopes).toStrictEqual([]);
  });

  it.each([
    ['const task = Promise => call({ a: [1, 2] }, (3, 4)); tail();', ';'],
    ['const task = Promise => value), tail();', ')'],
    ['const task = Promise => value], tail();', ']'],
    ['const task = Promise => value}, tail();', '}'],
    ['const task = Promise => value, tail();', ','],
  ])('ends an expression arrow at the first base delimiter in %j', (source, delimiter): void => {
    const arrow = source.indexOf('=>');
    const start = skipWhitespace(source, arrow + 2);
    const end = source.indexOf(delimiter, start);

    expect(sourceScopeIndex(source).parameterScopes).toStrictEqual([
      { bindingMask: BINDING_PROMISE, end, start },
    ]);
  });

  it('tracks function and catch parameter bindings to their exact bodies', (): void => {
    const source =
      'function task<T>(Promise: T, { fetch }, globalThis?: T) { use(); } ' +
      'try { work(); } catch (fetch) { recover(); }';
    const functionStart = source.indexOf('{', source.indexOf(')')) + 1;
    const functionEnd = source.indexOf('}', functionStart);
    const catchOpen = source.lastIndexOf('{');
    const catchStart = catchOpen + 1;
    const catchEnd = source.indexOf('}', catchStart);
    const index = sourceScopeIndex(source);

    expect(index.parameterScopes).toStrictEqual([
      { bindingMask: ALL_BINDINGS, end: functionEnd, start: functionStart },
      { bindingMask: BINDING_FETCH, end: catchEnd, start: catchStart },
    ]);
    expect(isLocallyBound(index, source.indexOf('use'), BINDING_PROMISE)).toBe(true);
    expect(isLocallyBound(index, source.indexOf('recover'), BINDING_FETCH)).toBe(true);
    expect(isLocallyBound(index, source.indexOf('recover'), BINDING_PROMISE)).toBe(false);
  });

  it.each([
    ['const task = (value) => { return value;', BINDING_PROMISE],
    ['function task(Promise); const body = 1;', BINDING_PROMISE],
  ])('does not invent parameter scopes for malformed or bodyless source %j', (source): void => {
    expect(sourceScopeIndex(source).parameterScopes).toStrictEqual([]);
  });

  it('returns the cached index and evicts the least-recently inserted source', (): void => {
    const originalSource = 'const Promise = cacheIdentityValue;';
    const original = sourceScopeIndex(originalSource);

    expect(sourceScopeIndex(originalSource)).toBe(original);
    for (let sequence = 0; sequence < 129; sequence += 1) {
      sourceScopeIndex(`const uniqueMutationCacheEntry${sequence} = ${sequence};`);
    }
    expect(sourceScopeIndex(originalSource)).not.toBe(original);
  });
});
