import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const runtimeASTURL = new URL('../../src/rules/effect-ast.ts', import.meta.url).href;
const runtimeTasksURL = new URL('../../src/rules/effect-promise-runtime-tasks.ts', import.meta.url)
  .href;
const sequentialOutcomeCount = 2_000;
const probeTimeoutMS = 5_000;

const outcomeSource = (count: number): string => {
  const statements = Array.from(
    { length: count },
    (): string => '  if (condition()) { return; }',
  ).join('\n');
  return [
    'import { Effect } from "effect";',
    'const task = Effect.sync(() => Promise.resolve("value"));',
    'declare function condition(): boolean;',
    'function run(): void {',
    statements,
    '  Effect.runSync(task);',
    '}',
    'run();',
  ].join('\n');
};

describe('runtime outcome continuation stack safety', (): void => {
  it(
    'indexes thousands of sequential outcome-producing statements within a bounded child process',
    { timeout: probeTimeoutMS + 2_000 },
    (): void => {
      const probeSource = `
        import { parseSync } from 'oxc-parser';
        import { childNode, identifierName } from ${JSON.stringify(runtimeASTURL)};
        import { indexPromiseRuntimeTasks } from ${JSON.stringify(runtimeTasksURL)};
        const callName = (node) => {
          if (node.type !== 'CallExpression') return undefined;
          const callee = childNode(node, 'callee');
          if (callee?.type !== 'MemberExpression') return undefined;
          if (identifierName(childNode(callee, 'object')) !== 'Effect') return undefined;
          return identifierName(childNode(callee, 'property'));
        };
        const source = ${JSON.stringify(outcomeSource(sequentialOutcomeCount))};
        const program = parseSync('runtime-outcome-stack-safety.ts', source, {
          sourceType: 'module',
        }).program;
        let syncCall;
        const tasks = indexPromiseRuntimeTasks(
          program,
          (node) => {
            if (callName(node) !== 'sync') return false;
            syncCall = node;
            return true;
          },
          (node) => callName(node) === 'runSync',
          undefined,
          { isEffectCall: (node) => callName(node) !== undefined, isObjectAssignCall: () => false },
        );
        process.stdout.write(
          JSON.stringify({ deferred: syncCall !== undefined && tasks.deferredSyncCalls.has(syncCall) }),
        );
      `;
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          maxBuffer: 50_000,
          timeout: probeTimeoutMS,
        },
      );
      const diagnostics = [result.error?.message, result.stderr, result.stdout]
        .filter((value): value is string => Boolean(value))
        .join('\n');

      expect(result.status, diagnostics).toBe(0);
      expect(result.stdout.trim()).toBe('{"deferred":true}');
    },
  );
});
