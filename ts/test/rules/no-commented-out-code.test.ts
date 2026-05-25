import { describe, expect, it } from 'vitest';
import isCommentedOutCode from '../../src/rules/no-commented-out-code';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('isCommentedOutCode heuristic', () => {
  // ════════════════════════════════════════════════════════════════
  //  STRONG CODE INDICATORS — KEYWORDS AT START OF LINE
  // ════════════════════════════════════════════════════════════════

  it('detects commented-out const declaration', () => {
    expect(isCommentedOutCode(' const oldFunction = () => { return "removed"; };')).toBe(true);
  });

  it('detects commented-out let assignment', () => {
    expect(isCommentedOutCode(' let unused = oldFunction();')).toBe(true);
  });

  it('detects commented-out var declaration', () => {
    expect(isCommentedOutCode(' var legacy = true;')).toBe(true);
  });

  it('detects commented-out import statement', () => {
    expect(isCommentedOutCode(" import { deprecated } from 'old-module';")).toBe(true);
  });

  it('detects commented-out export', () => {
    expect(isCommentedOutCode(' export default function legacyEntry() { return null; }')).toBe(
      true,
    );
  });

  it('detects commented-out function', () => {
    expect(
      isCommentedOutCode(
        ' function oldHelper(param: string): boolean { return param.length > 0; }',
      ),
    ).toBe(true);
  });

  it('detects commented-out class definition', () => {
    expect(isCommentedOutCode(' class OldClass {')).toBe(true);
  });

  it('detects commented-out if block', () => {
    expect(isCommentedOutCode(' if (condition) {')).toBe(true);
  });

  it('detects commented-out for loop', () => {
    expect(isCommentedOutCode(' for (let i = 0; i < 10; i++) {')).toBe(true);
  });

  it('detects commented-out while loop', () => {
    expect(isCommentedOutCode(' while (true) { doWork(); }')).toBe(true);
  });

  it('detects commented-out switch', () => {
    expect(isCommentedOutCode(' switch (value) { case 1: break; }')).toBe(true);
  });

  it('detects commented-out try/catch', () => {
    expect(isCommentedOutCode(' try {')).toBe(true);
  });

  it('detects commented-out return statement', () => {
    expect(isCommentedOutCode(' return computedValue;')).toBe(true);
  });

  it('detects commented-out throw', () => {
    expect(isCommentedOutCode(' throw new Error("never reached");')).toBe(true);
  });

  it('detects commented-out await', () => {
    expect(isCommentedOutCode(" await fetch('https://example.com');")).toBe(true);
  });

  it('detects commented-out async function', () => {
    expect(isCommentedOutCode(' async function fetchData() { await delay(); }')).toBe(true);
  });

  it('detects commented-out new expression', () => {
    expect(isCommentedOutCode(' new Promise((resolve) => { setTimeout(resolve, 100); });')).toBe(
      true,
    );
  });

  it('detects commented-out yield', () => {
    expect(isCommentedOutCode(' yield getNext();')).toBe(true);
  });

  it('detects commented-out type alias', () => {
    expect(isCommentedOutCode(' type OldType = { name: string; value: number };')).toBe(true);
  });

  it('detects commented-out interface', () => {
    expect(isCommentedOutCode(' interface OldInterface { validate(): boolean; }')).toBe(true);
  });

  it('detects commented-out enum', () => {
    expect(isCommentedOutCode(' enum Color { Red, Green, Blue }')).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  //  MODIFIER / ACCESSOR KEYWORDS
  // ════════════════════════════════════════════════════════════════

  it('detects commented-out extends', () => {
    expect(isCommentedOutCode(' extends BaseComponent {')).toBe(true);
  });

  it('detects commented-out implements', () => {
    expect(isCommentedOutCode(' implements IValidator {')).toBe(true);
  });

  it('detects commented-out break', () => {
    expect(isCommentedOutCode(' break;')).toBe(true);
  });

  it('detects commented-out continue', () => {
    expect(isCommentedOutCode(' continue;')).toBe(true);
  });

  it('detects commented-out default case', () => {
    expect(isCommentedOutCode(' default: return null;')).toBe(true);
  });

  it('detects commented-out case label', () => {
    expect(isCommentedOutCode(' case "active": handleActive(); break;')).toBe(true);
  });

  it('detects commented-out static method', () => {
    expect(isCommentedOutCode(' static create(): Instance { return new Instance(); }')).toBe(true);
  });

  it('detects commented-out get accessor', () => {
    expect(isCommentedOutCode(' get value(): number { return this._value; }')).toBe(true);
  });

  it('detects commented-out set accessor', () => {
    expect(isCommentedOutCode(' set value(v: number) { this._value = v; }')).toBe(true);
  });

  it('detects commented-out private field', () => {
    expect(isCommentedOutCode(' private secret: string;')).toBe(true);
  });

  it('detects commented-out protected method', () => {
    expect(isCommentedOutCode(' protected init(): void {')).toBe(true);
  });

  it('detects commented-out public constructor', () => {
    expect(isCommentedOutCode(' public constructor() {')).toBe(true);
  });

  it('detects commented-out readonly property', () => {
    expect(isCommentedOutCode(' readonly id: number;')).toBe(true);
  });

  it('detects commented-out abstract class', () => {
    expect(isCommentedOutCode(' abstract class BaseService {')).toBe(true);
  });

  it('detects commented-out declare module', () => {
    expect(isCommentedOutCode(' declare module "my-lib" {')).toBe(true);
  });

  it('detects commented-out typeof check', () => {
    expect(isCommentedOutCode(' typeof value === "string" ? trim(value) : value;')).toBe(true);
  });

  it('detects commented-out instanceof guard', () => {
    expect(isCommentedOutCode(' instanceof Error ? err.message : String(err);')).toBe(true);
  });

  it('detects commented-out finally block', () => {
    expect(isCommentedOutCode(' finally { cleanup(); }')).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  //  CODE PATTERNS — ARROW, ASSIGNMENT, DOT CALLS
  // ════════════════════════════════════════════════════════════════

  it('detects commented-out arrow + chain', () => {
    expect(isCommentedOutCode(' const result = data.map(x => x * 2).filter(x => x > 10);')).toBe(
      true,
    );
  });

  it('detects arrow function in comment', () => {
    expect(isCommentedOutCode(' items.filter(x => x.active)')).toBe(true);
  });

  it('handles dot-method chain (marginal without keyword)', () => {
    // .process() matches dot-call pattern = +2, no keyword ⇒ score 2 < 3
    expect(isCommentedOutCode(' obj.process().validate()')).toBe(false);
  });

  it('detects dot-method chain with keyword', () => {
    // "const" keyword (+3) + dot-call pattern (+2) = 5 ≥ 3
    expect(isCommentedOutCode(' const result = obj.process().validate();')).toBe(true);
  });

  it('detects template literal with interpolation', () => {
    expect(isCommentedOutCode(' `Hello ${name}, you have ${count} items`')).toBe(true);
  });

  it('detects JSX-like component tag', () => {
    expect(isCommentedOutCode(' <MyComponent prop={value} />')).toBe(true);
  });

  it('detects spread operator', () => {
    expect(isCommentedOutCode(' const merged = { ...defaults, ...overrides };')).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  //  MULTI-LINE & STRUCTURAL
  // ════════════════════════════════════════════════════════════════

  it('detects multi-line commented-out code via /* */', () => {
    expect(isCommentedOutCode(' const multi = {\n   line: true,\n   removed: "yes"\n};')).toBe(
      true,
    );
  });

  it('detects multi-line code with blank line inside', () => {
    expect(isCommentedOutCode(' function setup() {\n\n  init();\n  return true;\n}')).toBe(true);
  });

  it('detects code with braces even without keyword', () => {
    // braces = 2, no keyword, no patterns that match ⇒ score 2 < 3 — marginal
    // natural language can use braces for grouping, so this is a reasonable false negative
    expect(isCommentedOutCode(' { key: "value", nested: true }')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  HASH_CODE_TOKENS TRIGGERED VIA REGEX (NOT KEYWORD)
  // ════════════════════════════════════════════════════════════════

  it('detects commented-out assignment via regex path (no leading keyword)', () => {
    // first word "data" is not a keyword, but hasCodeTokens = true via regex (=, (), ;)
    expect(isCommentedOutCode(' data.value = compute(x);')).toBe(true);
  });

  it('detects code via symbols only (parentheses and semicolon)', () => {
    // "(input)" has hasCodeTokens via regex, ; gives +2 but score = 2 < 3
    expect(isCommentedOutCode(' process(input);')).toBe(false);
  });

  it('detects code via brackets and braces only', () => {
    // "[1,2,3]" has brackets and braces via regex, but no keyword, patterns might not hit → marginal
    expect(isCommentedOutCode(' [1, 2, 3].map(fn)')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  NATURAL LANGUAGE — FALSE POSITIVE AVOIDANCE
  // ════════════════════════════════════════════════════════════════

  it('does not flag regular explanatory comment', () => {
    expect(isCommentedOutCode(' This is a regular explanatory comment')).toBe(false);
  });

  it('does not flag business logic description', () => {
    expect(isCommentedOutCode(' describing the business logic below')).toBe(false);
  });

  it('does not flag JSDoc description', () => {
    expect(isCommentedOutCode(' JSDoc for the calculateTotal function.')).toBe(false);
  });

  it('does not flag JSDoc @param tag', () => {
    expect(isCommentedOutCode(' @param items - Array of prices')).toBe(false);
  });

  it('does not flag JSDoc @returns tag', () => {
    expect(isCommentedOutCode(' @returns The sum of all prices')).toBe(false);
  });

  it('does not flag JSDoc tag with code-like content after it', () => {
    expect(isCommentedOutCode(' @deprecated use newFunction() instead')).toBe(false);
  });

  it('does not flag inline explanation comment', () => {
    expect(isCommentedOutCode(' Add up all items using reduce')).toBe(false);
  });

  it('does not flag note comment starting with "Note:"', () => {
    expect(isCommentedOutCode(' Note: this function assumes all items are non-negative')).toBe(
      false,
    );
  });

  it('does not flag formula explanation', () => {
    expect(isCommentedOutCode(' The discount formula: total * (1 - percent/100)')).toBe(false);
  });

  it('does not flag file reference comment', () => {
    expect(isCommentedOutCode(' for details.')).toBe(false);
  });

  it('does not flag empty block explanation', () => {
    expect(isCommentedOutCode(' intentional empty block ')).toBe(false);
  });

  it('does not flag bare single word', () => {
    expect(isCommentedOutCode('TODO')).toBe(false);
  });

  it('does not flag URL in comment', () => {
    expect(isCommentedOutCode(' See https://example.com/docs for more')).toBe(false);
  });

  it('does not flag inline note about field', () => {
    expect(isCommentedOutCode(' TODO: remove after v2 migration')).toBe(false);
  });

  it('does not flag plain text with parentheses', () => {
    expect(isCommentedOutCode(' uses the standard library (stdlib) for parsing')).toBe(false);
  });

  it('does not flag multi-line architecture comment', () => {
    expect(isCommentedOutCode(' Multi-line comment explaining the architecture:')).toBe(false);
  });

  it('does not flag comment that looks like a sentence', () => {
    expect(isCommentedOutCode(' This code handles edge cases for the parser')).toBe(false);
  });

  it('does not flag markdown list item', () => {
    expect(isCommentedOutCode(' - item one')).toBe(false);
  });

  it('does not flag section heading', () => {
    expect(isCommentedOutCode(' Implementation Details')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  FALSE POSITIVE PREVENTION — NATURAL LANGUAGE WITH KEYWORD WORDS
  // ════════════════════════════════════════════════════════════════

  it('does not flag natural language starting with const', () => {
    expect(isCommentedOutCode('const is used for immutable bindings')).toBe(false);
  });

  it('does not flag natural language starting with let', () => {
    expect(isCommentedOutCode('let the user decide what to do')).toBe(false);
  });

  it('does not flag natural language starting with return', () => {
    expect(isCommentedOutCode('return early to avoid errors')).toBe(false);
  });

  it('does not flag natural language starting with try', () => {
    expect(isCommentedOutCode('try this approach instead')).toBe(false);
  });

  it('does not flag natural language starting with new', () => {
    expect(isCommentedOutCode('new approach to the problem')).toBe(false);
  });

  it('does not flag natural language starting with yield', () => {
    expect(isCommentedOutCode('yield is used in generators')).toBe(false);
  });

  it('does not flag natural language starting with break', () => {
    expect(isCommentedOutCode('break the loop when the timeout fires')).toBe(false);
  });

  it('does not flag natural language starting with case', () => {
    expect(isCommentedOutCode('case matters when comparing strings')).toBe(false);
  });

  it('does not flag natural language starting with get', () => {
    expect(isCommentedOutCode('get the value from the cache')).toBe(false);
  });

  it('does not flag natural language starting with set', () => {
    expect(isCommentedOutCode('set the defaults before initializing')).toBe(false);
  });

  it('does not flag natural language starting with public', () => {
    expect(isCommentedOutCode('public API is stable and documented')).toBe(false);
  });

  it('does not flag natural language starting with private', () => {
    expect(isCommentedOutCode('private methods use underscore prefix')).toBe(false);
  });

  it('does not flag natural language starting with static', () => {
    expect(isCommentedOutCode('static analysis helps catch bugs')).toBe(false);
  });

  it('does not flag natural language starting with abstract', () => {
    expect(isCommentedOutCode('abstract thinking is required here')).toBe(false);
  });

  it('does not flag natural language starting with while', () => {
    expect(isCommentedOutCode('while this works, prefer the other approach')).toBe(false);
  });

  it('does not flag natural language starting with if', () => {
    expect(isCommentedOutCode('if needed, fall back to the default value')).toBe(false);
  });

  it('does not flag natural language starting with for (preposition use)', () => {
    expect(isCommentedOutCode('for each item in the collection')).toBe(false);
  });

  it('does not flag natural language starting with switch', () => {
    expect(isCommentedOutCode('switch to the new implementation')).toBe(false);
  });

  it('does not flag natural language starting with continue', () => {
    expect(isCommentedOutCode('continue processing after validation')).toBe(false);
  });

  it('does not flag natural language starting with class', () => {
    expect(isCommentedOutCode('class inheritance should be avoided here')).toBe(false);
  });

  it('does not flag natural language starting with import', () => {
    expect(isCommentedOutCode('import the module dynamically instead')).toBe(false);
  });

  it('does not flag natural language starting with export', () => {
    expect(isCommentedOutCode('export only what is needed')).toBe(false);
  });

  it('does not flag natural language starting with extends', () => {
    expect(isCommentedOutCode('extends the base functionality')).toBe(false);
  });

  it('does not flag natural language starting with implements', () => {
    expect(isCommentedOutCode('implements the required interface')).toBe(false);
  });

  it('does not flag natural language starting with enum', () => {
    expect(isCommentedOutCode('enum values should be documented')).toBe(false);
  });

  it('does not flag natural language starting with type', () => {
    expect(isCommentedOutCode('type safety is important')).toBe(false);
  });

  it('does not flag natural language starting with interface', () => {
    expect(isCommentedOutCode('interface should be kept simple')).toBe(false);
  });

  it('does not flag natural language starting with default', () => {
    expect(isCommentedOutCode('default behavior is acceptable')).toBe(false);
  });

  it('does not flag natural language starting with finally', () => {
    expect(isCommentedOutCode('finally clean up resources')).toBe(false);
  });

  it('does not flag natural language starting with throw', () => {
    expect(isCommentedOutCode('throw an error if validation fails')).toBe(false);
  });

  it('does not flag natural language starting with await', () => {
    expect(isCommentedOutCode('await the promise resolution')).toBe(false);
  });

  it('does not flag natural language starting with async', () => {
    expect(isCommentedOutCode('async operations are handled elsewhere')).toBe(false);
  });

  it('does not flag natural language starting with function', () => {
    expect(isCommentedOutCode('function naming conventions should be consistent')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  COMPREHENSIVE FALSE POSITIVE PREVENTION
  // ════════════════════════════════════════════════════════════════

  // --- Short identifiers & single words ---

  it('does not flag single-word identifier', () => {
    expect(isCommentedOutCode('foo')).toBe(false);
  });

  it('does not flag two-word identifier', () => {
    expect(isCommentedOutCode('my variable')).toBe(false);
  });

  // --- Labels with colons ---

  it('does not flag label-style comment', () => {
    expect(isCommentedOutCode('example:')).toBe(false);
  });

  it('does not flag note label with colon', () => {
    expect(isCommentedOutCode('Note: see above for explanation')).toBe(false);
  });

  it('does not flag step label', () => {
    expect(isCommentedOutCode('Step 1: initialize the component')).toBe(false);
  });

  // --- Capital-letter sentences ---

  it('does not flag sentence starting with capital letter', () => {
    expect(isCommentedOutCode('This module handles user authentication')).toBe(false);
  });

  it('does not flag sentence about architecture', () => {
    expect(isCommentedOutCode('We use a layered approach with three tiers')).toBe(false);
  });

  it('does not flag sentence about implementation', () => {
    expect(isCommentedOutCode('Implementation follows the strategy pattern')).toBe(false);
  });

  // --- Parenthetical asides in natural language ---

  it('does not flag parenthetical aside', () => {
    expect(isCommentedOutCode('fastpath (usually not needed)')).toBe(false);
  });

  it('does not flag recommendation in parentheses', () => {
    expect(isCommentedOutCode('use the defaults (recommended approach)')).toBe(false);
  });

  it('does not flag abbreviation in parens', () => {
    expect(isCommentedOutCode('the application programming interface (API) layer')).toBe(false);
  });

  it('does not flag cross-reference in parens', () => {
    expect(isCommentedOutCode('see the migration guide (docs/migration.md) for details')).toBe(
      false,
    );
  });

  // --- Task markers ---

  it('does not flag TODO comment', () => {
    expect(isCommentedOutCode('TODO: implement error handling')).toBe(false);
  });

  it('does not flag FIXME comment', () => {
    expect(isCommentedOutCode('FIXME: this breaks with large inputs')).toBe(false);
  });

  it('does not flag HACK comment', () => {
    expect(isCommentedOutCode('HACK: temporary workaround for safari')).toBe(false);
  });

  it('does not flag XXX comment', () => {
    expect(isCommentedOutCode('XXX: revisit when upgrading to v2')).toBe(false);
  });

  // --- Documentation patterns ---

  it('does not flag usage documentation', () => {
    expect(isCommentedOutCode('Usage: import { handler } from the module')).toBe(false);
  });

  it('does not flag returns documentation', () => {
    expect(isCommentedOutCode('Returns: a promise that resolves to the result')).toBe(false);
  });

  it('does not flag see-also reference', () => {
    expect(isCommentedOutCode('See also: RFC 1234, docs/api.md')).toBe(false);
  });

  it('does not flag markdown heading', () => {
    expect(isCommentedOutCode('## Implementation Details')).toBe(false);
  });

  it('does not flag bullet point', () => {
    expect(isCommentedOutCode('- handles edge cases for empty input')).toBe(false);
  });

  it('does not flag numbered list item', () => {
    expect(isCommentedOutCode('1. validate the input parameters')).toBe(false);
  });

  // --- ESLint / TypeScript directives ---

  it('does not flag eslint-disable directive', () => {
    expect(isCommentedOutCode('eslint-disable-next-line no-console')).toBe(false);
  });

  it('does not flag ts-expect-error directive', () => {
    expect(isCommentedOutCode('@ts-expect-error type is narrowed below')).toBe(false);
  });

  it('does not flag ts-ignore directive', () => {
    expect(isCommentedOutCode('@ts-ignore not worth fixing')).toBe(false);
  });

  // --- Inline code references in documentation ---

  it('does not flag inline code reference', () => {
    expect(isCommentedOutCode('use const assert = require("assert") in tests')).toBe(false);
  });

  // --- Natural language with "=" ---

  it('does not flag mathematical equality explanation', () => {
    expect(isCommentedOutCode('where x = y in the base case')).toBe(false);
  });

  // --- Natural language with arrows ---

  it('does not flag flow diagram arrow', () => {
    expect(isCommentedOutCode('request -> handler -> response pipeline')).toBe(false);
  });

  // --- Punctuation / separator comments ---

  it('does not flag separator comment', () => {
    expect(isCommentedOutCode('---')).toBe(false);
  });

  it('does not flag ellipsis comment', () => {
    expect(isCommentedOutCode('...')).toBe(false);
  });

  it('does not flag equals separator', () => {
    expect(isCommentedOutCode('==========')).toBe(false);
  });

  // --- Natural language with comparison operators ---

  it('does not flag explanation with equals comparison', () => {
    expect(isCommentedOutCode('when length == 0 the loop exits')).toBe(false);
  });

  it('does not flag explanation with strict equality', () => {
    expect(isCommentedOutCode('if x === null the default is used')).toBe(false);
  });

  it('does not flag explanation with not-equal', () => {
    expect(isCommentedOutCode('when status != "active" skip processing')).toBe(false);
  });

  it('does not flag explanation with greater-than', () => {
    expect(isCommentedOutCode('if count > 100 use batch mode')).toBe(false);
  });

  // --- Natural language with braces for grouping ---

  it('does not flag braces used for grouping in text', () => {
    expect(isCommentedOutCode('the {placeholder} will be replaced at runtime')).toBe(false);
  });

  // --- Natural language with quoted strings ---

  it('does not flag explanation with quoted value', () => {
    expect(isCommentedOutCode('defaults to "production" when unset')).toBe(false);
  });

  // --- Natural language with code-like words in mid-sentence ---

  it('does not flag prose containing code keywords inline', () => {
    expect(
      isCommentedOutCode(
        'this function returns a promise that resolves after the async operation completes',
      ),
    ).toBe(false);
  });

  // --- Natural language with semicolons (English punctuation) ---

  it('does not flag sentence ending with semicolon list', () => {
    expect(isCommentedOutCode('handles three cases: empty; single item; multiple items')).toBe(
      false,
    );
  });

  // ════════════════════════════════════════════════════════════════
  //  THRESHOLD BOUNDARY TESTS — score exactly at/around 3
  // ════════════════════════════════════════════════════════════════

  it('flags code with keyword + pattern (score 4 from keyword + assignment)', () => {
    // keyword "const" = 2, assignment "=" = 2, score = 4
    expect(isCommentedOutCode(' const x = 1;')).toBe(true);
  });

  it('flags code with keyword + brace (score 3 from keyword + brace)', () => {
    // keyword "class" = 2, brace = 1, score = 3 ≥ 3
    expect(isCommentedOutCode(' class Foo {')).toBe(true);
  });

  it('does not flag keyword alone without other indicators (score 2 < 3)', () => {
    // keyword "const" = 2, no other indicators, score = 2 < 3
    expect(isCommentedOutCode(' const placeholder')).toBe(false);
  });

  it('flags keyword + semicolon (score 4)', () => {
    // keyword "return" = 2, semicolon = 2, score = 4
    expect(isCommentedOutCode(' return result;')).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  //  OLD THRESHOLD BOUNDARY TESTS
  // ════════════════════════════════════════════════════════════════

  it('flags code with keyword + semicolon (score 4, keyword=2 + semicolon=2)', () => {
    expect(isCommentedOutCode(' return result;')).toBe(true);
  });

  it('flags code at threshold (score = 3 from pattern + brace)', () => {
    // semicolon pattern = 2, plus brace = 1, score = 3
    expect(isCommentedOutCode(' x = { y: z };')).toBe(true);
  });

  it('does not flag text below threshold (score = 2, semicolon only)', () => {
    // just a semicolon at end = 2, no keyword or brace
    expect(isCommentedOutCode(' hello world;')).toBe(false);
  });

  it('does not flag keyword alone without other indicators (keyword=2 < 3)', () => {
    // keyword "const" at start = 2, no other patterns, score = 2 < 3
    expect(isCommentedOutCode(' const x')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  ARTICLE / PREPOSITION PENALTY
  // ════════════════════════════════════════════════════════════════

  it('penalizes comment starting with article even with code-like content', () => {
    // "the" triggers natural language penalty (-3), has "=" assignment (+2)
    // score = -1 < 3, should be false
    expect(isCommentedOutCode(' the value = compute(x);')).toBe(false);
  });

  it('flags code starting with article but with strong signals', () => {
    // "the" penalty (-3), but "const" keyword (+3 * lines?), brace (+1),
    // assignment (+2), semicolon (+2) — score > 3
    // Actually "the const" — first word is "the" which is not a keyword
    // But "const" is on a different line? No, same line.
    // Let me use: "the" penalty but braces + assignment + keyword from a later line
    expect(isCommentedOutCode(' the x = { value: 1 };')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  NATURAL LANGUAGE SENTENCE PENALTY
  // ════════════════════════════════════════════════════════════════

  it('penalizes sentence-like comment starting with capital letter', () => {
    expect(isCommentedOutCode(' We process orders in batches of 100')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  COMBINED PENALTIES AND BONUSES
  // ════════════════════════════════════════════════════════════════

  it('correctly balances keyword bonus with natural language penalty', () => {
    // Starting with "the" penalty (-3), but has other signals
    // Keyword bonus from lines: none (first word is "the")
    // Patterns: semicolon (+2) — score = -1 → false
    expect(isCommentedOutCode(' the quick brown;')).toBe(false);
  });

  it('correctly accumulates score from multiple patterns', () => {
    // const (keyword +3), = assignment (+2), ; semicolon (+2), => arrow (+2)
    // score = 3 + 2 + 2 + 2 = 9 → true
    expect(isCommentedOutCode(' const fn = (x: number) => x * 2;')).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════
  //  FAST-PATH (SHORT EXIT) TESTS
  // ════════════════════════════════════════════════════════════════

  it('short-circuits on very short text (< 3 chars)', () => {
    expect(isCommentedOutCode('ab')).toBe(false);
  });

  it('short-circuits on empty string', () => {
    expect(isCommentedOutCode('')).toBe(false);
  });

  it('fast-exits on text with no code tokens and no keywords', () => {
    // "hello world" — no special chars, no keywords, no code-like words
    expect(isCommentedOutCode(' hello world')).toBe(false);
  });

  it('detects code with keyword inline (secondary regex check)', () => {
    // "function" appears anywhere in text ⇒ passes secondary regex, goes to scoring
    // first word "this" not keyword, but "function" is in the secondary regex
    // No keyword at start, patterns: none strongly match. Score = 0 < 3.
    expect(isCommentedOutCode(' this is a function call example')).toBe(false);
  });

  it('detects code with return in natural language context', () => {
    // "return" passes secondary regex but "the" penalty (-3) offsets, score stays low
    expect(isCommentedOutCode(' the return value is')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  EDGE CASES — WHITESPACE, FORMATTING
  // ════════════════════════════════════════════════════════════════

  it('handles leading whitespace', () => {
    expect(isCommentedOutCode('    const x = 1;')).toBe(true);
  });

  it('handles trailing whitespace', () => {
    expect(isCommentedOutCode('const x = 1;   ')).toBe(true);
  });

  it('handles comment with only whitespace after trim', () => {
    expect(isCommentedOutCode('   ')).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════
  //  EDGE CASES — RARE KEYWORDS
  // ════════════════════════════════════════════════════════════════

  it('detects commented-out catch with variable', () => {
    expect(isCommentedOutCode(' catch (error) { log(error); }')).toBe(true);
  });

  it('detects commented-out finally', () => {
    expect(isCommentedOutCode(' finally {')).toBe(true);
  });
});

describe('fixture files', () => {
  function extractComments(source: string): string[] {
    const comments: string[] = [];
    // single-line comments
    const singleLineRe = /\/\/\s*(.*)$/gm;
    let match: RegExpExecArray | null;
    while ((match = singleLineRe.exec(source)) !== null) {
      comments.push(match[1]);
    }
    // multi-line comments
    const multiLineRe = /\/\*\s*([\s\S]*?)\s*\*\//g;
    let multiMatch: RegExpExecArray | null;
    while ((multiMatch = multiLineRe.exec(source)) !== null) {
      comments.push(multiMatch[1]);
    }
    return comments;
  }

  it('valid fixture contains zero commented-out code', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const codeComments = extractComments(source).filter(isCommentedOutCode);
    expect(codeComments).toHaveLength(0);
  });

  it('invalid fixture contains many commented-out code blocks', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const codeComments = extractComments(source).filter(isCommentedOutCode);
    expect(codeComments.length).toBeGreaterThanOrEqual(15);
  });

  it('blank file contains zero commented-out code', () => {
    expect(extractComments('').filter(isCommentedOutCode)).toHaveLength(0);
  });
});
