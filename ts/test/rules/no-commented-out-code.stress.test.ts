/**
 * Stress test: natural language comments that start with keywords must NOT be flagged.
 */
import { describe, expect, it } from 'vitest';
import isCommentedOutCode from '../../src/rules/no-commented-out-code.js';

describe('false positive stress test', () => {
  const naturalLanguageStartingWithKeywords = [
    'const is used for immutable bindings',
    'let the user decide what to do',
    'return early to avoid errors',
    'try this approach instead',
    'new approach to the problem',
    'yield is used in generators',
    'break the loop when the timeout fires',
    'case matters when comparing strings',
    'get the value from the cache',
    'set the defaults before initializing',
    'public API is stable and documented',
    'private methods use underscore prefix',
    'static analysis helps catch bugs',
    'abstract thinking is required here',
    'while this works, prefer the other approach',
    'if needed, fall back to the default value',
    'for each item in the collection',
    'switch to the new implementation',
    'continue processing after validation',
    'class inheritance should be avoided here',
    'import the module dynamically instead',
    'export only what is needed',
    'extends the base functionality',
    'implements the required interface',
    'enum values should be documented',
    'type safety is important',
    'interface should be kept simple',
    'default behavior is acceptable',
    'finally clean up resources',
    'throw an error if validation fails',
    'await the promise resolution',
    'async operations are handled elsewhere',
    'function naming conventions',
    'readonly properties cannot be reassigned',
    'typeof check is done before usage',
    'instanceof should be used for type guards',
    'catch errors at the boundary',
    'declare the variable before use',
    'protected access is not needed here',
    'throw away unnecessary code',
  ];

  for (const comment of naturalLanguageStartingWithKeywords) {
    it(`does not flag natural language: "${comment}"`, () => {
      expect(isCommentedOutCode(comment)).toBe(false);
    });
  }

  // These should still be flagged as code (keyword + structural indicator)
  const actualCodeStartingWithKeywords = [
    ['const x = 1', true],
    ['let y = foo();', true],
    ['return result;', true],
    ['throw new Error("fail");', true],
    ['if (x === 0) {', true],
    ['for (const item of items) {', true],
    ['while (queue.length) {', true],
    ['switch (type) {', true],
    ['try {', true],
    ['catch (err) {', true],
    ['async function fetch() {', true],
    ['class MyComponent {', true],
    ['import { X } from "y";', true],
    ['export default function() {', true],
    ['const result = data.map(x => x * 2).filter(x => x > 10);', true],
    ['function helper(p: string): boolean { return p.length > 0; }', true],
    ['await fetch(url);', true],
    ['new Promise((resolve) => {', true],
    ['yield getNext();', true],
    ['break;', true],
    ['continue;', true],
    ['type MyType = { name: string };', true],
    ['interface ICheck { validate(): boolean; }', true],
    ['enum Color { Red, Green }', true],
    ['static init() {', true],
    ['get value() { return this._x; }', true],
    ['set value(v) { this._x = v; }', true],
  ];

  for (const [comment, expected] of actualCodeStartingWithKeywords) {
    it(`${expected ? 'flags' : 'does not flag'} actual code: "${comment}"`, () => {
      expect(isCommentedOutCode(comment as string)).toBe(expected);
    });
  }
});
