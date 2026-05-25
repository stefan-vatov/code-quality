import { describe, expect, it } from 'vitest';
import { preferFunctionExpressions } from '../../src/codemods/function-declarations';

describe('preferFunctionExpressions', () => {
  it('converts safe non-exported function declarations to const arrow expressions', () => {
    const input = `function formatName(name: string): string {
  return name.trim();
}
`;

    expect(preferFunctionExpressions(input)).toBe(`const formatName = (name: string): string => {
  return name.trim();
};
`);
  });

  it('preserves generic type parameters when converting declarations', () => {
    const input = `function identity<Value>(value: Value): Value {
  return value;
}
`;

    expect(preferFunctionExpressions(input))
      .toBe(`const identity = <Value>(value: Value): Value => {
  return value;
};
`);
  });

  it('does not convert when an earlier reference depends on function hoisting', () => {
    const input = `const formatted = formatName("Ada");

function formatName(name: string): string {
  return name.trim();
}
`;

    expect(preferFunctionExpressions(input)).toBe(input);
  });

  it('converts helpers referenced only inside earlier function bodies', () => {
    const input = `const formatAll = (names: readonly string[]): string[] => names.map(formatName);

function formatName(name: string): string {
  return name.trim();
}
`;

    expect(preferFunctionExpressions(input))
      .toBe(`const formatAll = (names: readonly string[]): string[] => names.map(formatName);

const formatName = (name: string): string => {
  return name.trim();
};
`);
  });

  it('converts safe named exported declarations without changing the named export API', () => {
    const input = `export function formatName(name: string): string {
  return name.trim();
}
`;

    expect(preferFunctionExpressions(input))
      .toBe(`export const formatName = (name: string): string => {
  return name.trim();
};
`);
  });

  it('does not convert default exported declarations because default function identity can be intentional', () => {
    const input = `export default function formatName(name: string): string {
  return name.trim();
}
`;

    expect(preferFunctionExpressions(input)).toBe(input);
  });

  it('does not convert declarations that use function this semantics', () => {
    const input = `function formatName(this: { prefix: string }, name: string): string {
  return this.prefix + name.trim();
}
`;

    expect(preferFunctionExpressions(input)).toBe(input);
  });

  it('converts safe nested function declarations without overlapping parent rewrites', () => {
    const input = `const outer = (): void => {
  function visit(value: string): void {
    sink(value);
  }

  visit("ready");
};
`;

    expect(preferFunctionExpressions(input)).toBe(`const outer = (): void => {
  const visit = (value: string): void => {
    sink(value);
  };

  visit("ready");
};
`);
  });

  it('does not convert a nested declaration when an earlier reference depends on hoisting', () => {
    const input = `const outer = (): void => {
  visit("ready");

  function visit(value: string): void {
    sink(value);
  }
};
`;

    expect(preferFunctionExpressions(input)).toBe(input);
  });

  it('converts same-named nested declarations in independent scopes', () => {
    const input = `const first = (): void => {
  function visit(value: string): void {
    sink(value);
  }
  visit("first");
};

const second = (): void => {
  function visit(value: string): void {
    sink(value);
  }
  visit("second");
};
`;

    expect(preferFunctionExpressions(input)).toBe(`const first = (): void => {
  const visit = (value: string): void => {
    sink(value);
  };
  visit("first");
};

const second = (): void => {
  const visit = (value: string): void => {
    sink(value);
  };
  visit("second");
};
`);
  });
});
