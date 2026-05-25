import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

describe('Effect cycle 6 strict regression coverage', () => {
  it('enforces class service tags over GenericTag service definitions in strict mode', () => {
    const invalid = 'const UserRepo = Context.GenericTag<UserRepo>("UserRepo");';
    const valid = 'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}';

    expect(runRule('effect-require-service-class-pattern', invalid)).toHaveLength(1);
    expect(runRule('effect-require-service-class-pattern', valid)).toHaveLength(0);
  });

  it('requires identifiers for GenericTag service definitions', () => {
    const invalid = 'const UserRepo = Context.GenericTag<UserRepo>();';
    const valid = 'const UserRepo = Context.GenericTag<UserRepo>("UserRepo");';

    expect(runRule('effect-require-tag-identifier', invalid)).toHaveLength(1);
    expect(runRule('effect-require-tag-identifier', valid)).toHaveLength(0);
  });
});
