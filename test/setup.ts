import { afterEach, vi } from 'vitest';

process.env.NODE_ENV ??= 'test';

const inheritedGITConfigCount = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10);
const gitConfigCount = Number.isSafeInteger(inheritedGITConfigCount) ? inheritedGITConfigCount : 0;
process.env[`GIT_CONFIG_KEY_${gitConfigCount}`] = 'commit.gpgSign';
process.env[`GIT_CONFIG_VALUE_${gitConfigCount}`] = 'false';
process.env.GIT_CONFIG_COUNT = String(gitConfigCount + 1);

afterEach((): void => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
