// Thx-testing:runtime:start
import { afterEach, vi } from 'vitest';

process.env.NODE_ENV ??= 'test';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
// Thx-testing:runtime:end
