import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const configurationPath = new URL('../mise.toml', import.meta.url);
const configuration = () =>
  existsSync(configurationPath) ? readFileSync(configurationPath, 'utf8') : '';

describe('repository mise toolchain', () => {
  it.each([
    ['node', '24.14.0'],
    ['pnpm', '10.12.4'],
    ['erlang', '27.3'],
    ['elixir', '1.18.4-otp-27'],
  ])('pins %s to the CI-compatible runtime %s', (tool, version) => {
    expect(configuration()).toContain('[tools]');
    expect(configuration()).toContain(`${tool} = "${version}"`);
  });

  it('documents installing and running the repository toolchain', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('mise install');
    expect(readme).toContain('mise exec -- pnpm run check');
  });

  it('keeps pinned tools ahead of inherited PATH entries in child processes', () => {
    expect(configuration()).toContain('[settings]');
    expect(configuration()).toContain('activate_aggressive = true');
  });
});
