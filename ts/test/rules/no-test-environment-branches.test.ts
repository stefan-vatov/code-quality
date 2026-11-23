import { RuleTester } from 'oxlint/plugins-dev';

import { noTestEnvironmentBranchesRule } from '../../src/rules/internal/no-test-environment-branches';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'testEnvironmentBranch' };
const source = 'src/billing/charge.ts';

tester.run('thethracian/no-test-environment-branches', noTestEnvironmentBranchesRule, {
  valid: [
    { filename: source, code: 'export const port = process.env.PORT ?? "3000";' },
    {
      filename: source,
      code: 'export const isProduction = process.env.NODE_ENV === "production";',
    },
    { filename: source, code: 'export const mode = process.env.NODE_ENV;' },
    {
      filename: source,
      code: 'if (import.meta.vitest) { const { it } = import.meta.vitest; it("adds", () => {}); }',
    },
    { filename: source, code: 'export const label = "VITEST is a test runner";' },
    { filename: 'src/billing/charge.test.ts', code: 'if (process.env.VITEST) { setup(); }' },
    {
      filename: 'test/fixtures/server.ts',
      code: 'export const testing = process.env.NODE_ENV === "test";',
    },
    {
      filename: 'vitest.config.ts',
      code: 'export default { test: { pool: process.env.VITEST_POOL_ID } };',
    },
    { filename: 'src/test-setup.ts', code: 'if (typeof vi !== "undefined") vi.useFakeTimers();' },
  ],
  invalid: [
    {
      name: 'NODE_ENV compared with test',
      filename: source,
      code: 'if (process.env.NODE_ENV === "test") { return true; }',
      errors: [error],
    },
    {
      name: 'reversed comparison',
      filename: source,
      code: 'export const skip = "test" !== process.env.NODE_ENV;',
      errors: [error],
    },
    {
      name: 'switch on NODE_ENV with a test case',
      filename: source,
      code: 'switch (process.env.NODE_ENV) { case "test": break; default: break; }',
      errors: [error],
    },
    {
      name: 'VITEST flag',
      filename: source,
      code: 'export const charge = () => (process.env.VITEST ? 0 : compute());',
      errors: [error],
    },
    {
      name: 'computed JEST_WORKER_ID key',
      filename: source,
      code: 'export const worker = process.env["JEST_WORKER_ID"];',
      errors: [error],
    },
    {
      name: 'destructured VITEST',
      filename: source,
      code: 'const { VITEST } = process.env; export const testing = VITEST;',
      errors: [error],
    },
    {
      name: 'Effect Config key',
      filename: source,
      code: 'const testing = Config.boolean("VITEST");',
      errors: [error],
    },
    {
      name: 'import.meta.env test mode',
      filename: source,
      code: 'export const testing = import.meta.env.MODE === "test";',
      errors: [error],
    },
    {
      name: 'typeof test global',
      filename: source,
      code: 'export const testing = typeof vi !== "undefined";',
      errors: [error],
    },
    {
      name: 'globalThis test global',
      filename: source,
      code: 'export const testing = Boolean(globalThis.jest);',
      errors: [error],
    },
  ],
});
