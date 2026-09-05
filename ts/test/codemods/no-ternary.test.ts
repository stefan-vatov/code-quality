import { describe, expect, it } from 'vitest';
import { preferExplicitBranches } from '../../src/codemods/no-ternary';

describe('preferExplicitBranches', (): void => {
  it('converts return-position ternaries to explicit branches', (): void => {
    const input = `function label(enabled: boolean): string {
  return enabled ? "on" : "off";
}
`;

    expect(preferExplicitBranches(input)).toBe(`function label(enabled: boolean): string {
  if (enabled) {
    return "on";
  }
  return "off";
}
`);
  });

  it('converts expression-bodied arrows that directly return a ternary', (): void => {
    const input = `const label = (enabled: boolean): string => enabled ? "on" : "off";
`;

    expect(preferExplicitBranches(input)).toBe(`const label = (enabled: boolean): string => {
  if (enabled) {
    return "on";
  }
  return "off";
};
`);
  });

  it('converts parenthesized expression-bodied arrows without leaving invalid parentheses', (): void => {
    const input = `const label = (enabled: boolean): string => (enabled ? "on" : "off");
`;

    expect(preferExplicitBranches(input)).toBe(`const label = (enabled: boolean): string => {
  if (enabled) {
    return "on";
  }
  return "off";
};
`);
  });

  it('does not convert nested ternaries because the resulting control flow needs judgment', (): void => {
    const input = `function label(enabled: boolean, pending: boolean): string {
  return enabled ? "on" : pending ? "pending" : "off";
}
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });

  it('converts simple variable initializer ternaries to explicit branches', (): void => {
    const input = `const label = enabled ? "on" : "off";
`;

    expect(preferExplicitBranches(input)).toBe(`const label = ((): string => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
`);
  });

  it('preserves type annotations when converting variable initializer ternaries', (): void => {
    const input = `const label: string = enabled ? "on" : "off";
`;

    expect(preferExplicitBranches(input)).toBe(`const label: string = ((): string => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
`);
  });

  it('does not convert exported variable initializer ternaries because public binding mutability is observable', (): void => {
    const input = `export const label = enabled ? "on" : "off";
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });

  it('does not convert multi-declarator variable initializer ternaries', (): void => {
    const input = `const label = enabled ? "on" : "off", count = 1;
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });

  it('does not convert untyped variable initializer ternaries when branch types cannot be proven locally', (): void => {
    const input = `const label = enabled ? createOnLabel() : createOffLabel();
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });
});

describe('preferExplicitBranches assignments and IIFEs', (): void => {
  it('converts plain assignment ternaries to explicit branches', (): void => {
    const input = `let label = "";

label = enabled ? "on" : "off";
`;

    expect(preferExplicitBranches(input)).toBe(`let label = "";

if (enabled) {
  label = "on";
} else {
  label = "off";
}
`);
  });

  it('does not convert compound assignment ternaries', (): void => {
    const input = `count += enabled ? 1 : 2;
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });

  it('repairs uninitialized declarations followed by exhaustive branch assignment', (): void => {
    const input = `let label;
if (enabled) {
  label = "on";
} else {
  label = "off";
}
`;

    expect(preferExplicitBranches(input)).toBe(`const label = ((): string => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
`);
  });

  it('keeps let when a repaired branch-assigned variable is reassigned later', (): void => {
    const input = `let label;
if (enabled) {
  label = "on";
} else {
  label = "off";
}
label = "manual";
`;

    expect(preferExplicitBranches(input)).toBe(`let label = ((): string => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
label = "manual";
`);
  });

  it('adds missing return types to primitive arrow IIFEs produced by earlier fixes', (): void => {
    const input = `const label = (() => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
`;

    expect(preferExplicitBranches(input)).toBe(`const label = ((): string => {
  if (enabled) {
    return "on";
  }
  return "off";
})();
`);
  });

  it('uses the declaration annotation when repairing arrow IIFE return types', (): void => {
    const input = `const label: Label = (() => {
  if (enabled) {
    return createOnLabel();
  }
  return createOffLabel();
})();
`;

    expect(preferExplicitBranches(input)).toBe(`const label: Label = ((): Label => {
  if (enabled) {
    return createOnLabel();
  }
  return createOffLabel();
})();
`);
  });

  it('does not add guessed return types to untyped arrow IIFEs with non-literal returns', (): void => {
    const input = `const label = (() => {
  if (enabled) {
    return createOnLabel();
  }
  return createOffLabel();
})();
`;

    expect(preferExplicitBranches(input)).toBe(input);
  });
});
