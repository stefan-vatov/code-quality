import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';

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
  });

  it('reports JSON casts, obsolete imports, and known fake APIs', () => {
    const invalid = `
      import { Effect as LegacyEffect } from "@effect/io";
      import { Effect } from "effect";

      const payload = JSON.parse(body) as UserPayload;
      const program = Effect.fromPromise(() => fetch("/users/1"));
    `;

    expect(runRule('effect-no-obsolete-imports', invalid)[0]?.message).toContain(
      'Import Effect APIs from the main effect package',
    );
    expect(runRule('effect-no-known-fake-api', invalid)[0]?.message).toContain(
      'is not a known Effect API for the configured version',
    );
  });
});
