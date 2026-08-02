import { expect, it } from 'vitest';
import hasRequiredFunctionDocs from '../../src/rules/require-function-doc';

it('checks later exports separated from export by non-space whitespace', (): void => {
  const source = '/** The first export. */ export const first = 1;\nexport\tconst second = 2;';

  expect(hasRequiredFunctionDocs(source)).toBe(false);
});
