import { describe, expect, it } from 'vitest';
import { preferConciseArrowBodies } from '../../src/codemods/arrow-body-style';

describe('preferConciseArrowBodies', () => {
  it('converts single-return arrow blocks to concise expression bodies', () => {
    const input = `const trimName = (name: string): string => {
  return name.trim();
};
`;

    expect(preferConciseArrowBodies(input))
      .toBe(`const trimName = (name: string): string => name.trim();
`);
  });

  it('wraps returned object literals so expression semantics are preserved', () => {
    const input = `const createUser = (name: string) => {
  return { name };
};
`;

    expect(preferConciseArrowBodies(input)).toBe(`const createUser = (name: string) => ({ name });
`);
  });

  it('does not convert blocks with comments because comments carry intent', () => {
    const input = `const trimName = (name: string): string => {
  // keep the input stable before trimming
  return name.trim();
};
`;

    expect(preferConciseArrowBodies(input)).toBe(input);
  });

  it('does not convert blocks with multiple statements', () => {
    const input = `const trimName = (name: string): string => {
  const trimmed = name.trim();
  return trimmed;
};
`;

    expect(preferConciseArrowBodies(input)).toBe(input);
  });

  it('does not convert when the concise body would exceed the configured line width', () => {
    const input = `const isConfigured = (value: string): boolean => {
  return firstVeryLongPredicateName(value) && secondVeryLongPredicateName(value) && thirdVeryLongPredicateName(value) && fourthVeryLongPredicateName(value);
};
`;

    expect(preferConciseArrowBodies(input)).toBe(input);
  });
});
