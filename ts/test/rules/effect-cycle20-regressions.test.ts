import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 20 regression coverage', () => {
  it('ignores Effect-looking text in workflow strings', () => {
    const yieldDocs =
      'Effect.gen(function* () { const docs = "yield Effect.succeed(1)"; return 1; });';
    const runSyncDocs = 'const handler = () => { const docs = "Effect.runSync(program)"; };';

    expect(runRule('effect-require-yield-star', yieldDocs)).toHaveLength(0);
    expect(runRule('effect-no-runSync-in-server-request-handlers', runSyncDocs)).toHaveLength(0);
  });

  it('does not add a strict console rule or globally ban contextual console use', () => {
    const config = theThracianOxlint({
      effect: true,
    });

    expect(config.rules).not.toHaveProperty('no-console');
    expect(config.rules).not.toHaveProperty(
      'thethracian/effect-no-direct-console-outside-logger-layer',
    );
  });
});
