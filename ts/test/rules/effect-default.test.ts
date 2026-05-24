import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin.js';

type Report = {
  message: string;
  node: object;
};

const programNode = { type: 'Program', range: [0, 0] };

function runRule(ruleName: string, source: string, filename = 'src/domain/user.ts'): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-rule-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    const rule = plugin.rules[ruleName as keyof typeof plugin.rules];
    expect(rule, `${ruleName} must be registered`).toBeDefined();
    const visitors = rule.create({
      filename: filePath,
      report(report: Report) {
        reports.push(report);
      },
    });

    visitors.Program?.(programNode);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return reports;
}

describe('Effect default custom rules', () => {
  it('reports nested Effect.flatMap callback pyramids without banning flat pipes', () => {
    const invalid = `
      import { Effect, Option } from "effect";

      const program = firstCandidatePath(commonPaths).pipe(
        Effect.flatMap((commonResult) =>
          Option.isSome(commonResult)
            ? Effect.succeed(commonResult)
            : detectViaWhichEffect(binaryName).pipe(
                Effect.flatMap((whichResult) =>
                  Option.isSome(whichResult)
                    ? Effect.succeed(whichResult)
                    : detectViaLoginShellEffect(binaryName)
                )
              )
        )
      );
    `;

    const valid = `
      import { Effect } from "effect";

      const program = fetchData.pipe(
        Effect.timeout("5 seconds"),
        Effect.retry(policy),
        Effect.flatMap((data) => enrich(data)),
        Effect.tap((data) => Effect.logInfo(data))
      );
    `;

    expect(runRule('effect-prefer-gen-for-nested-flatmap', invalid)[0]?.message).toContain(
      'Replace nested Effect.flatMap callbacks with Effect.gen',
    );
    expect(runRule('effect-prefer-gen-for-nested-flatmap', valid)).toHaveLength(0);
  });

  it('reports named or exported functions returning Effect.gen', () => {
    const invalid = `
      import { Effect } from "effect";

      export function loadUser(id: string) {
        return Effect.gen(function* () {
          return yield* UserRepo.load(id);
        });
      }
    `;

    const valid = `
      import { Effect } from "effect";

      export const loadUser = Effect.fn("loadUser")(function* (id: string) {
        return yield* UserRepo.load(id);
      });
    `;

    expect(runRule('effect-no-function-returning-gen', invalid)[0]?.message).toContain(
      'Use Effect.fn for exported effectful functions',
    );
    expect(runRule('effect-no-function-returning-gen', valid)).toHaveLength(0);
  });

  it('reports runtime execution inside effects and exported APIs', () => {
    const insideEffect = `
      import { Effect } from "effect";

      const program = Effect.gen(function* () {
        const user = yield* Effect.promise(() => Effect.runPromise(loadUser()));
        return user;
      });
    `;

    const exportedRun = `
      import { Effect } from "effect";

      export const loadUserNow = (id: string) => Effect.runPromise(loadUser(id));
    `;

    const exportedEffect = `
      import { Effect } from "effect";

      export const loadUser = (id: string) => loadUserEffect(id);
    `;

    expect(runRule('effect-no-run-inside-effect', insideEffect)[0]?.message).toContain(
      'Do not run an Effect from inside another Effect',
    );
    expect(runRule('effect-no-runpromise-in-exported-api', exportedRun)[0]?.message).toContain(
      'Exported APIs should expose Effect values',
    );
    expect(runRule('effect-no-runpromise-in-exported-api', exportedEffect)).toHaveLength(0);
  });

  it('reports untyped Effect failures and thrown errors inside Effect workflows', () => {
    const thrown = `
      import { Effect } from "effect";

      const program = Effect.gen(function* () {
        throw new Error("not found");
      });
    `;

    const untagged = `
      import { Effect } from "effect";

      const one = Effect.fail("not found");
      const two = Effect.fail(new Error("not found"));
    `;

    expect(runRule('effect-no-throw', thrown)[0]?.message).toContain(
      'Use typed Effect failures instead of throw',
    );
    expect(runRule('effect-no-untagged-errors', untagged)).toHaveLength(1);
  });

  it('reports unsafe fallible boundaries', () => {
    const invalid = `
      import { Effect } from "effect";

      const fetchUser = Effect.tryPromise(() => fetch("/users/1"));
      const parsed = Effect.sync(() => JSON.parse(payload));
      const promised = Effect.sync(() => fetch("/users/1"));
    `;

    expect(runRule('effect-require-typed-error-in-trypromise', invalid)[0]?.message).toContain(
      'Use Effect.tryPromise({ try, catch })',
    );
    expect(runRule('effect-no-sync-for-throwing-ops', invalid)[0]?.message).toContain(
      'Use Effect.try for synchronous code that can throw',
    );
    expect(runRule('effect-no-sync-for-promise', invalid)[0]?.message).toContain(
      'Use Effect.tryPromise for Promise-returning code',
    );
  });

  it('reports JSON casts, obsolete imports, and known fake APIs', () => {
    const invalid = `
      import { Effect as LegacyEffect } from "@effect/io";
      import { Effect } from "effect";

      const payload = JSON.parse(body) as UserPayload;
      const program = Effect.fromPromise(() => fetch("/users/1"));
    `;

    expect(runRule('effect-no-json-parse-cast', invalid)[0]?.message).toContain(
      'Decode external JSON with Schema',
    );
    expect(runRule('effect-no-obsolete-imports', invalid)[0]?.message).toContain(
      'Import Effect APIs from the main effect package',
    );
    expect(runRule('effect-no-known-fake-api', invalid)[0]?.message).toContain(
      'is not a known Effect API for the configured version',
    );
  });

  it('reports manual Effect runtime usage in tests', () => {
    const invalid = `
      import { Effect } from "effect";
      import { it, expect } from "vitest";

      it("loads", async () => {
        const user = await Effect.runPromise(loadUser("1"));
        expect(user.id).toBe("1");
      });
    `;

    const valid = `
      import { it } from "@effect/vitest";

      it.effect("loads", () => loadUser("1"));
    `;

    expect(runRule('effect-test-no-runpromise', invalid, 'src/user.test.ts')[0]?.message).toContain(
      'Use @effect/vitest it.effect',
    );
    expect(runRule('effect-test-no-runpromise', valid, 'src/user.test.ts')).toHaveLength(0);
  });
});
