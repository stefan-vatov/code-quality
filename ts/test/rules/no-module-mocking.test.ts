import { RuleTester } from 'oxlint/plugins-dev';

import { noModuleMockingRule } from '../../src/rules/no-module-mocking';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'moduleMock' };

tester.run('thethracian/no-module-mocking', noModuleMockingRule, {
  valid: [
    'const store = new InMemoryUserStore();',
    "vi.spyOn(store, 'save');",
    'const vi = { mock() {} }; vi.mock();',
    'function test(jest: { mock(): void }) { jest.mock(); }',
    "import { vi as localVi } from './helpers'; localVi.mock('./module');",
    "import * as api from './helpers'; api.vi.mock('./module');",
    "import * as api from 'vitest'; api.vi.spyOn(store, 'save');",
    "import * as api from 'vitest'; function run(api: LocalApi) { api.vi.mock('./module'); }",
    "import * as api from 'vitest'; api.mock('./module');",
    "import * as api from '@jest/globals'; api.mock('./module');",
  ],
  invalid: [
    { code: "vi.mock('./user-store');", errors: [error] },
    { code: "jest.mock('./user-store');", errors: [error] },
    { code: "vi['doMock']('./user-store');", errors: [error] },
    { code: "jest.unstable_mockModule('./user-store');", errors: [error] },
    { code: "import { vi } from 'vitest'; vi.mock('./user-store');", errors: [error] },
    {
      code: "import { vi as testApi } from 'vitest'; testApi.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import { jest } from '@jest/globals'; jest.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import * as api from 'vitest'; api.vi.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import * as api from '@jest/globals'; api.jest.mock('./user-store');",
      errors: [error],
    },
    {
      code: "import * as api from 'vitest'; api['vi']['doMock']('./user-store');",
      errors: [error],
    },
    {
      code: "import * as api from '@jest/globals'; api.jest.unstable_mockModule('./user-store');",
      errors: [error],
    },
  ],
});
