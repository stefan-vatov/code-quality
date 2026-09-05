import type { Fixture } from './performance-gate-support';

export const nativeRuleFixtures: readonly Fixture[] = [
  {
    filename: 'src/domain/assertions.ts',
    source: `
      type User = { readonly id: string };
      const source = { id: 'user' };
      const widened: unknown = source;
      const restored = widened as User;
      const chained = input as unknown as User;
      const spread = { ...(enabled ? source : {}) };
    `,
  },
  {
    filename: 'src/domain/boundaries.ts',
    source: `
      type Payload = unknown;
      type Values = Record<string, unknown>;
      function read(input: unknown): unknown { return input; }
      function write(input: object): void { consume(input); }
      const payloadShape = 1;
      const kind = typeof input;
    `,
  },
  {
    filename: 'src/domain/reflection.ts',
    source: `
      Reflect.get(owner, key);
      Reflect.apply(callback, owner, args);
      function local(Reflect: Reader) { return Reflect.get(owner, key); }
    `,
  },
  {
    filename: 'tests/unit/user.test.ts',
    source: `
      import { vi } from 'vitest';
      import { makeUserService } from '../../src/user';
      vi.mock('../../src/user');
    `,
  },
  {
    filename: 'src/domain/service.ts',
    source: `import { makeUserService } from './user'; export const service = makeUserService();`,
  },
  {
    filename: 'src/domain/justified.ts',
    source: `
      // SAFETY: the boundary validated this input against UserSchema.
      export const user = input as User;
      const names = ['user'] as const;
      const Reflect = { get() { return 1; }, apply() { return 2; } };
      Reflect.get(); Reflect.apply();
    `,
  },
  {
    filename: 'src/domain/clean.ts',
    source: `
      interface User { readonly id: string }
      function read(user: User): string { return user.id; }
      export const user = { id: 'user' } satisfies User;
    `,
  },
];
