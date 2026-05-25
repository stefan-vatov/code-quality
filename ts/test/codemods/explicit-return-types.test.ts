import { describe, expect, it } from 'vitest';
import { addVoidReturnTypes } from '../../src/codemods/explicit-return-types';

describe('addVoidReturnTypes', () => {
  it('adds void to block-bodied arrow functions without returned values', () => {
    const input = `const logValue = (value: string) => {
  sink(value);
};
`;

    expect(addVoidReturnTypes(input)).toBe(`const logValue = (value: string): void => {
  sink(value);
};
`);
  });

  it('adds Promise<void> to async functions without returned values', () => {
    const input = `const persist = async (value: string) => {
  await sink(value);
};
`;

    expect(addVoidReturnTypes(input))
      .toBe(`const persist = async (value: string): Promise<void> => {
  await sink(value);
};
`);
  });

  it('adds void to object literal methods without returned values', () => {
    const input = `const visitor = {
  Program(node) {
    report(node);
  },
};
`;

    expect(addVoidReturnTypes(input)).toBe(`const visitor = {
  Program(node): void {
    report(node);
  },
};
`);
  });

  it('does not add a return type when any branch returns a value', () => {
    const input = `const getValue = (enabled: boolean) => {
  if (enabled) {
    return "value";
  }
};
`;

    expect(addVoidReturnTypes(input)).toBe(input);
  });

  it('adds string to expression-bodied arrows with locally provable string method returns', () => {
    const input = `const parseValue = (value: string) => value.trim();
`;

    expect(addVoidReturnTypes(input))
      .toBe(`const parseValue = (value: string): string => value.trim();
`);
  });

  it('adds boolean to expression-bodied arrows with syntactic boolean expressions', () => {
    const input = `const isEnabled = (value: string) => value.length > 0;
`;

    expect(addVoidReturnTypes(input))
      .toBe(`const isEnabled = (value: string): boolean => value.length > 0;
`);
  });

  it('adds boolean to return statements that call RegExp.test', () => {
    const input = `const hasToken = (source: string) => {
  return /Effect\\./.test(source);
};
`;

    expect(addVoidReturnTypes(input)).toBe(`const hasToken = (source: string): boolean => {
  return /Effect\\./.test(source);
};
`);
  });

  it('adds boolean to predicate-style check property arrows', () => {
    const input = `const rule = {
  check: (source: string, context: Context) =>
    isConfiguredPath(context) && hasEffectSignal(source),
};
`;

    expect(addVoidReturnTypes(input)).toBe(`const rule = {
  check: (source: string, context: Context): boolean =>
    isConfiguredPath(context) && hasEffectSignal(source),
};
`);
  });

  it('adds visitor-map return types to ast property factories', () => {
    const input = `const rule = {
  ast: (context: Context, source: string) => ({
    CallExpression(node): void {
      report(context, source, node);
    },
  }),
};
`;

    expect(addVoidReturnTypes(input)).toBe(`const rule = {
  ast: (context: Context, source: string): Record<string, (node: object) => void> => ({
    CallExpression(node): void {
      report(context, source, node);
    },
  }),
};
`);
  });

  it('does not touch functions that already have return types', () => {
    const input = `const logValue = (value: string): void => {
  sink(value);
};
`;

    expect(addVoidReturnTypes(input)).toBe(input);
  });
});
