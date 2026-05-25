import { describe, expect, it } from 'vitest';
import { sortImportDeclarations } from '../../src/codemods/sort-imports';

describe('sortImportDeclarations', (): void => {
  it('sorts import declarations by syntax group and source text', (): void => {
    const input = `/** Docs. */
import zed from "./zed.js";
import { beta } from "./beta.js";
import alpha from "./alpha.js";
import * as names from "./names.js";

const value = alpha;
`;

    expect(sortImportDeclarations(input)).toBe(`/** Docs. */
import * as names from "./names.js";
import alpha from "./alpha.js";
import { beta } from "./beta.js";
import zed from "./zed.js";

const value = alpha;
`);
  });

  it('sorts named imports alphabetically inside an import declaration', (): void => {
    const input = `import { zebra, alpha, beta as renamedBeta } from "./letters.js";
`;

    expect(sortImportDeclarations(input))
      .toBe(`import { alpha, beta as renamedBeta, zebra } from "./letters.js";
`);
  });

  it('keeps sorted named imports single-line when the original import is single-line', (): void => {
    const input = `import { zebra, alpha, delta, beta } from "./letters.js";
`;

    expect(sortImportDeclarations(input))
      .toBe(`import { alpha, beta, delta, zebra } from "./letters.js";
`);
  });

  it('uses Oxlint sort-imports syntax groups where one named member is single syntax', (): void => {
    const input = `import { singleMember } from "./single.js";
import { beta, alpha } from "./multiple.js";
import defaultMember from "./default.js";
import defaultWithNamed, { helper } from "./default-with-named.js";
`;

    expect(sortImportDeclarations(input)).toBe(`import { alpha, beta } from "./multiple.js";
import defaultWithNamed, { helper } from "./default-with-named.js";
import defaultMember from "./default.js";
import { singleMember } from "./single.js";
`);
  });

  it('sorts declarations by first imported member or alias name inside each syntax group', (): void => {
    const input = `import zebraDefault from "./zebra.js";
import { singleMember } from "./single.js";
import alphaDefault from "./alpha.js";
import { beta, alpha } from "./letters.js";
import { gamma, delta } from "./greek.js";
`;

    expect(sortImportDeclarations(input)).toBe(`import { alpha, beta } from "./letters.js";
import { delta, gamma } from "./greek.js";
import alphaDefault from "./alpha.js";
import { singleMember } from "./single.js";
import zebraDefault from "./zebra.js";
`);
  });

  it('sorts aliased named imports by local binding name between import declarations', (): void => {
    const input = `import { Array as EffectArray, Option } from "effect";
import type {
  ArrowFunctionExpression,
  AssignmentExpression,
} from "jscodeshift";
import { collectBranchInitializerRepairs } from "./no-ternary-branch-initializers";
`;

    expect(sortImportDeclarations(input)).toBe(`import type {
  ArrowFunctionExpression,
  AssignmentExpression,
} from "jscodeshift";
import { Array as EffectArray, Option } from "effect";
import { collectBranchInitializerRepairs } from "./no-ternary-branch-initializers";
`);
  });

  it('does not reorder side-effect imports', (): void => {
    const input = `import "./setup.js";
import zed from "./zed.js";
import { alpha } from "./alpha.js";
`;

    expect(sortImportDeclarations(input)).toBe(input);
  });
});
