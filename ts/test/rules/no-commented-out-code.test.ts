import { describe, expect, it } from 'vitest';
import isCommentedOutCode from '../../src/rules/no-commented-out-code.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('isCommentedOutCode heuristic', () => {
  // ── STRONG CODE INDICATORS ────────────────────────────────────

  it('detects commented-out const declaration', () => {
    expect(isCommentedOutCode(' const oldFunction = () => { return "removed"; };')).toBe(true);
  });

  it('detects commented-out import statement', () => {
    expect(isCommentedOutCode(" import { deprecated } from 'old-module';")).toBe(true);
  });

  it('detects commented-out let assignment', () => {
    expect(isCommentedOutCode(' let unused = oldFunction();')).toBe(true);
  });

  it('detects commented-out if block', () => {
    expect(isCommentedOutCode(' if (condition) {')).toBe(true);
  });

  it('detects commented-out class definition', () => {
    expect(isCommentedOutCode(' class OldClass {')).toBe(true);
  });

  it('detects commented-out function', () => {
    expect(
      isCommentedOutCode(
        ' function oldHelper(param: string): boolean { return param.length > 0; }',
      ),
    ).toBe(true);
  });

  it('detects commented-out export', () => {
    expect(isCommentedOutCode(' export default function legacyEntry() { return null; }')).toBe(
      true,
    );
  });

  it('detects commented-out await', () => {
    expect(isCommentedOutCode(" await fetch('https://example.com');")).toBe(true);
  });

  it('detects commented-out arrow + chain', () => {
    expect(isCommentedOutCode(' const result = data.map(x => x * 2).filter(x => x > 10);')).toBe(
      true,
    );
  });

  it('detects commented-out try/catch', () => {
    expect(isCommentedOutCode(' try {')).toBe(true);
  });

  it('detects commented-out type alias', () => {
    expect(isCommentedOutCode(' type OldType = { name: string; value: number };')).toBe(true);
  });

  it('detects commented-out interface', () => {
    expect(isCommentedOutCode(' interface OldInterface { validate(): boolean; }')).toBe(true);
  });

  it('detects commented-out throw', () => {
    expect(isCommentedOutCode(' throw new Error("never reached");')).toBe(true);
  });

  it('detects commented-out for loop', () => {
    expect(isCommentedOutCode(' for (let i = 0; i < 10; i++) {')).toBe(true);
  });

  it('detects multi-line commented-out code via /* */', () => {
    expect(isCommentedOutCode(' const multi = {\n   line: true,\n   removed: "yes"\n};')).toBe(
      true,
    );
  });

  // ── NATURAL LANGUAGE (FALSE POSITIVE AVOIDANCE) ───────────────

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

  it('does not flag inline explanation comment', () => {
    expect(isCommentedOutCode(' Add up all items using reduce')).toBe(false);
  });

  it('does not flag note comment', () => {
    expect(isCommentedOutCode(' Note: this function assumes all items are non-negative')).toBe(
      false,
    );
  });

  it('does not flag formula explanation', () => {
    expect(isCommentedOutCode(' The discount formula: total * (1 - percent/100)')).toBe(false);
  });

  it('does not flag multi-line architecture comment', () => {
    expect(isCommentedOutCode(' Multi-line comment explaining the architecture:')).toBe(false);
  });

  it('does not flag file reference comment', () => {
    expect(isCommentedOutCode(' for details.')).toBe(false);
  });

  it('does not flag empty block explanation', () => {
    expect(isCommentedOutCode(' intentional empty block ')).toBe(false);
  });

  // ── EDGE CASES ─────────────────────────────────────────────────

  it('does not flag bare single word', () => {
    expect(isCommentedOutCode('TODO')).toBe(false);
  });

  it('does not flag URL in comment', () => {
    expect(isCommentedOutCode(' See https://example.com/docs for more')).toBe(false);
  });

  it('flags commented-out while loop', () => {
    expect(isCommentedOutCode(' while (true) { doWork(); }')).toBe(true);
  });

  it('flags commented-out switch', () => {
    expect(isCommentedOutCode(' switch (value) { case 1: break; }')).toBe(true);
  });

  it('flags commented-out return statement', () => {
    expect(isCommentedOutCode(' return computedValue;')).toBe(true);
  });

  it('flags commented-out async function', () => {
    expect(isCommentedOutCode(' async function fetchData() { await delay(); }')).toBe(true);
  });

  it('flags commented-out new expression', () => {
    expect(isCommentedOutCode(' new Promise((resolve) => { setTimeout(resolve, 100); });')).toBe(
      true,
    );
  });

  it('flags commented-out yield', () => {
    expect(isCommentedOutCode(' yield getNext();')).toBe(true);
  });

  it('does not flag inline note about field', () => {
    expect(isCommentedOutCode(' TODO: remove after v2 migration')).toBe(false);
  });

  it('does not flag JSDoc tag with code-like content after it', () => {
    expect(isCommentedOutCode(' @deprecated use newFunction() instead')).toBe(false);
  });

  it('does not flag plain text with parentheses', () => {
    expect(isCommentedOutCode(' uses the standard library (stdlib) for parsing')).toBe(false);
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
});
