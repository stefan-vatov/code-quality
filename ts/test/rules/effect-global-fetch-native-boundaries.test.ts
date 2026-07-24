import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';

const ruleName = 'effect-no-global-fetch';
const domainFile = 'src/domain/http-client.ts';

type SourceCase = {
  name: string;
  source: string;
};

const globalFetchCases: readonly SourceCase[] = [
  {
    name: 'multiline Effect.tryPromise object callbacks',
    source: `
      import { Effect } from "effect";

      export const request = Effect.tryPromise({
        try: () =>
          fetch(
            "/users",
            { method: "GET" },
          ),
        catch: (error) => error,
      });
    `,
  },
  {
    name: 'multiline Effect.promise callbacks',
    source: `
      import { Effect } from "effect";

      export const request = Effect.promise(
        () =>
          fetch(
            "/users",
          ),
      );
    `,
  },
  {
    name: 'nested formatting inside an Effect wrapper',
    source: `
      import { Effect } from "effect";

      export const request = Effect.tryPromise({
        try: () =>
          addRequestHeaders(
            fetch(
              "/users",
            ),
          ),
        catch: (error) => error,
      });
    `,
  },
  {
    name: 'a root Effect namespace alias',
    source: `
      import { Effect as Fx } from "effect";

      export const request = Fx.tryPromise({
        try: () =>
          fetch(
            "/users",
          ),
        catch: (error) => error,
      });
    `,
  },
  {
    name: 'an effect/Effect namespace alias',
    source: `
      import * as Fx from "effect/Effect";

      export const request = Fx.promise(
        () =>
          fetch(
            "/users",
          ),
      );
    `,
  },
  {
    name: 'an aliased named effect/Effect wrapper',
    source: `
      import { tryPromise as attempt } from "effect/Effect";

      export const request = attempt({
        try: () =>
          fetch(
            "/users",
          ),
        catch: (error) => error,
      });
    `,
  },
];

const shadowedFetchCases: readonly SourceCase[] = [
  {
    name: 'a callback parameter',
    source: `
      import { Effect } from "effect";

      export const request = (fetch: (url: string) => Promise<Response>) =>
        Effect.tryPromise(() => fetch("/users"));
    `,
  },
  {
    name: 'a local const binding',
    source: `
      import { Effect } from "effect";

      const fetch = client.fetch;
      export const request = Effect.tryPromise(() => fetch("/users"));
    `,
  },
  {
    name: 'a local function declaration',
    source: `
      import { Effect } from "effect";

      function fetch(url: string): Promise<Response> {
        return client.get(url);
      }
      export const request = Effect.tryPromise(() => fetch("/users"));
    `,
  },
  {
    name: 'an imported value',
    source: `
      import { Effect } from "effect";
      import { fetch } from "./http-adapter";

      export const request = Effect.tryPromise(() => fetch("/users"));
    `,
  },
  {
    name: 'an aliased imported value',
    source: `
      import { Effect as Fx } from "effect";
      import { request as fetch } from "./http-adapter";

      export const request = Fx.tryPromise(() => fetch("/users"));
    `,
  },
  {
    name: 'a lexical TDZ binding declared after the wrapper',
    source: `
      import { Effect } from "effect";

      export const request = Effect.tryPromise(() => fetch("/users"));
      const fetch = client.fetch;
    `,
  },
  {
    name: 'a nested function parameter',
    source: `
      import * as Fx from "effect/Effect";

      export const request = Fx.tryPromise(() => {
        const execute = (fetch: (url: string) => Promise<Response>) => fetch("/users");
        return execute(client.fetch);
      });
    `,
  },
];

describe('effect-no-global-fetch native reference boundaries', (): void => {
  it('is registered as an executable custom rule', (): void => {
    expect(plugin.rules).toHaveProperty(ruleName);
  });

  it.each(globalFetchCases)('reports global fetch through $name', ({ source }): void => {
    expect(runRule(ruleName, source, domainFile)).toHaveLength(1);
  });

  it.each(shadowedFetchCases)('allows fetch resolved to $name', ({ source }): void => {
    expect(runRule(ruleName, source, domainFile)).toHaveLength(0);
  });

  it('reports only the true global reference when a local fetch also exists', (): void => {
    const source = `
      import { Effect } from "effect";

      const localRequest = (fetch: (url: string) => Promise<Response>) =>
        Effect.tryPromise(() => fetch("/local"));
      const globalRequest = Effect.tryPromise(() => fetch("/global"));
      void localRequest;
      void globalRequest;
    `;

    expect(runRule(ruleName, source, domainFile)).toHaveLength(1);
  });

  it.each(['src/adapters/http.ts', 'src/platform/http.ts', 'src/infrastructure/http.ts'])(
    'keeps the default adapter-layer exemption for %s',
    (filename): void => {
      const source = `
        import { Effect } from "effect";
        export const request = Effect.tryPromise(() => fetch("/users"));
      `;

      expect(runRule(ruleName, source, filename)).toHaveLength(0);
    },
  );

  it('keeps configured adapter-layer exemptions', (): void => {
    const source = `
      import { Effect } from "effect";
      export const request = Effect.tryPromise(() => fetch("/users"));
    `;

    expect(
      runRule(ruleName, source, 'src/ports/http.ts', {
        adapterLayers: ['src/ports/**'],
      }),
    ).toHaveLength(0);
  });

  it('does not broaden the rule to fetch calls outside Effect async wrappers', (): void => {
    const source = `
      import { Effect } from "effect";
      const response = fetch("/users");
      export const request = Effect.succeed(response);
    `;

    expect(runRule(ruleName, source, domainFile)).toHaveLength(0);
  });
});
