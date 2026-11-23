import { describe, expect, it } from 'vitest';
import config from '../../src/index';
import { effectDefaultRuleNames } from '../../src/internal/effect-rule-names';
import { runRule } from './effect-rule-test-utils';

const rule = 'effect-no-throwing-parse-in-sync';
const imports = 'import { Effect, Schema } from "effect";\n';

describe('effect-no-throwing-parse-in-sync', () => {
  it('is a default Effect rule enabled as an error', () => {
    expect(effectDefaultRuleNames).toContain(rule);
    expect(config({ effect: true }).rules).toHaveProperty(`thethracian/${rule}`, 'error');
  });

  it.each([
    [
      'JSON.parse in an Effect.sync expression body',
      'const p = Effect.sync(() => JSON.parse(text));',
    ],
    [
      'JSON.parse in an Effect.sync block body',
      'const p = Effect.sync(() => { const value = JSON.parse(body); return value.id; });',
    ],
    ['eager JSON.parse passed to Effect.succeed', 'const p = Effect.succeed(JSON.parse(body));'],
    ['decodeURIComponent in Effect.sync', 'const p = Effect.sync(() => decodeURIComponent(path));'],
    ['decodeURI in Effect.sync', 'const p = Effect.sync(() => decodeURI(url));'],
    [
      'aliased Effect import',
      'import { Effect as E } from "effect";\nconst p = E.sync(() => JSON.parse(text));',
    ],
  ])('reports %s', (_name, source) => {
    expect(runRule(rule, imports + source)).toHaveLength(1);
  });

  it.each([
    [
      'Effect.try with a typed catch',
      'const p = Effect.try({ try: () => JSON.parse(text), catch: (cause) => new ParseError({ cause }) });',
    ],
    ['JSON.stringify in Effect.sync', 'const p = Effect.sync(() => JSON.stringify(value));'],
    ['a plain value in Effect.succeed', 'const p = Effect.succeed(value);'],
    ['a parser returned for later use', 'const p = Effect.sync(() => () => JSON.parse(text));'],
    [
      'a locally shadowed JSON object',
      'const JSON = { parse: (input: string) => input };\nconst p = Effect.sync(() => JSON.parse(text));',
    ],
    [
      'JSON.parse guarded by a local try block (the try ban reports it separately)',
      'const p = Effect.sync(() => { try { return JSON.parse(text); } catch { return undefined; } });',
    ],
    ['Schema.parseJson decoding', 'const p = Schema.decodeUnknown(Schema.parseJson(User))(text);'],
  ])('allows %s', (_name, source) => {
    expect(runRule(rule, imports + source)).toHaveLength(0);
  });

  it.each(['src/user.test.ts', 'packages/api/test/fixtures/server.ts', 'src/__tests__/user.ts'])(
    'leaves test and fixture code alone: %s',
    (filename) => {
      expect(
        runRule(rule, `${imports}const p = Effect.sync(() => JSON.parse(text));`, filename),
      ).toHaveLength(0);
    },
  );
});
