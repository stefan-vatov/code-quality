import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../../src/rules/effect-ast';
import type { ImportedEffectCallMatcher } from '../../src/rules/effect-imported-call-matcher';
import { isSchemaTaggedErrorSuperclass } from '../../src/rules/effect-yieldable-schema-superclass';
import { scanSourceComments } from '../../src/rules/plugin-commented-out-code-source-scanner';

type MutableNode = ASTNode & Record<string, unknown>;

const ast = (type: string, properties: Record<string, unknown> = {}): MutableNode =>
  Object.assign({ type }, properties);

const identifier = (name: string): ASTNode => ast('Identifier', { name });

const literal = (value: string): ASTNode => ast('Literal', { value });

const nestedTemplateSource = (depth: number): string => {
  let expression = '0';
  for (let index = 0; index < depth; index += 1) {
    expression = '`${' + expression + '}`';
  }
  return `const value = ${expression};\n`;
};

const schemaSuperclass = (factoryCallee: ASTNode): ASTNode => {
  const factory = ast('CallExpression', {
    arguments: [literal('Tag')],
    callee: factoryCallee,
  });
  return ast('CallExpression', {
    arguments: [literal('Tag'), ast('ObjectExpression', { properties: [] })],
    callee: factory,
  });
};

const memberChain = (depth: number): ASTNode => {
  let current = identifier('Schema');
  for (let index = 0; index < depth; index += 1) {
    current = ast('MemberExpression', {
      computed: false,
      object: current,
      optional: false,
      property: identifier(index === depth - 1 ? 'TaggedError' : `part${index}`),
    });
  }
  return current;
};

const matcher = (matches: (node: object | undefined) => boolean): ImportedEffectCallMatcher => ({
  initialize(): void {},
  matches,
});

describe('final source scanner depth audit', (): void => {
  it.each([1, 100, 2_000, 10_000])(
    'scans nested template interpolations at depth %i without exhausting the stack',
    (depth): void => {
      let comments = 0;
      expect((): void => {
        scanSourceComments(nestedTemplateSource(depth), (): void => {
          comments += 1;
        });
      }).not.toThrow();
      expect(comments).toBe(0);
    },
  );
});

describe('final Schema.TaggedError superclass depth audit', (): void => {
  it('preserves shallow exact superclass recognition', (): void => {
    const factoryCallee = memberChain(1);
    const superclass = schemaSuperclass(factoryCallee);

    expect(
      isSchemaTaggedErrorSuperclass(
        superclass,
        matcher((node): boolean => node === factoryCallee),
      ),
    ).toBe(true);
  });

  it.each([2_000, 10_000])(
    'rejects a deep member chain at depth %i without exhausting the stack',
    (depth): void => {
      const superclass = schemaSuperclass(memberChain(depth));
      let result: boolean | undefined;

      expect((): void => {
        result = isSchemaTaggedErrorSuperclass(
          superclass,
          matcher((): boolean => false),
        );
      }).not.toThrow();
      expect(result).toBe(false);
    },
  );

  it('rejects a cyclic member chain without exhausting the stack', (): void => {
    const cyclic = ast('MemberExpression', {
      computed: false,
      optional: false,
      property: identifier('loop'),
    });
    Object.assign(cyclic, { object: cyclic });
    let result: boolean | undefined;

    expect((): void => {
      result = isSchemaTaggedErrorSuperclass(
        schemaSuperclass(cyclic),
        matcher((): boolean => false),
      );
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
