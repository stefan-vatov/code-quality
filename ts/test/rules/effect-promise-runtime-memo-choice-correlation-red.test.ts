import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';
import { runRule } from './effect-rule-test-utils';
import ts from 'typescript';

interface CorrelationCase {
  name: string;
  reports: 0 | 1;
  source: string;
}

const ruleName = 'effect-no-sync-for-promise';

const runtimeSource = (execution: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  type UserTask = Effect.Effect<UserResult>;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  let supplied: UserResult = user;
  const task: UserTask = Effect.sync(() => load(supplied));
  ${execution}
`;

const dynamicTaskSource = (execution: string): string => `
  import { Effect } from "effect";
  const user = { id: 1 };
  type UserResult = typeof user | Promise<typeof user> | undefined;
  type UserTask = Effect.Effect<UserResult>;
  function load(value: UserResult = Promise.resolve(user)): UserResult {
    return value;
  }
  function make(value: UserResult): UserTask {
    return Effect.sync(() => load(value));
  }
  function execute(value: UserTask): UserResult {
    return Effect.runSync(value);
  }
  ${execution}
`;

const dynamicTaskCases: readonly CorrelationCase[] = [
  {
    name: 'distinguishes a later unsafe dynamic task instance after a safe instance',
    reports: 1,
    source: dynamicTaskSource(`
      const safe = make(user);
      const unsafe = make(void 0);
      execute(safe);
      execute(unsafe);
    `),
  },
  {
    name: 'retains an earlier unsafe dynamic task instance before a safe instance',
    reports: 1,
    source: dynamicTaskSource(`
      const unsafe = make(void 0);
      const safe = make(user);
      execute(unsafe);
      execute(safe);
    `),
  },
  {
    name: 'accepts two safe dynamic task instances from the same static sync site',
    reports: 0,
    source: dynamicTaskSource(`
      const first = make(user);
      const second = make(user);
      execute(first);
      execute(second);
    `),
  },
];

const choicePropagationCases: readonly CorrelationCase[] = [
  {
    name: 'joins distinct branch object identities that both carry an unsafe task',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      let selected: { value: UserTask };
      if (condition) {
        selected = { value: task };
      } else {
        selected = { value: task };
      }
      supplied = void 0;
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'does not prove an unsafe task from divergent branch object identities',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      let selected: { value: UserTask };
      if (condition) {
        selected = { value: task };
      } else {
        selected = { value: Effect.succeed(user) };
      }
      supplied = void 0;
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'joins distinct branch closure identities that both run an unsafe task',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      let execute: () => UserResult;
      if (condition) {
        execute = () => Effect.runSync(task);
      } else {
        execute = () => Effect.runSync(task);
      }
      supplied = void 0;
      execute();
    `),
  },
  {
    name: 'does not prove an unsafe task from divergent branch closures',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      let execute: () => UserResult;
      if (condition) {
        execute = () => Effect.runSync(task);
      } else {
        execute = () => user;
      }
      supplied = void 0;
      execute();
    `),
  },
  {
    name: 'joins fresh unsafe task holders allocated through one helper site',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      function makeHolder(value: UserResult): { value: UserTask } {
        return { value: Effect.sync(() => load(value)) };
      }
      function choose(value: boolean): { value: UserTask } {
        if (value) {
          return makeHolder(void 0);
        }
        return makeHolder(void 0);
      }
      const selected = choose(condition);
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'does not prove an unsafe fresh task holder from divergent helper calls',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      function makeHolder(value: UserResult): { value: UserTask } {
        return { value: Effect.sync(() => load(value)) };
      }
      function choose(value: boolean): { value: UserTask } {
        if (value) {
          return makeHolder(void 0);
        }
        return makeHolder(user);
      }
      const selected = choose(condition);
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'does not prove an unsafe fresh task holder from reversed divergent helper calls',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      function makeHolder(value: UserResult): { value: UserTask } {
        return { value: Effect.sync(() => load(value)) };
      }
      function choose(value: boolean): { value: UserTask } {
        if (value) {
          return makeHolder(user);
        }
        return makeHolder(void 0);
      }
      const selected = choose(condition);
      Effect.runSync(selected.value);
    `),
  },
];

const choiceWriteCases: readonly CorrelationCase[] = [
  {
    name: 'does not project a choice write onto one possible target identity',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const left: { value: UserTask } = { value: Effect.succeed(user) };
      const right: { value: UserTask } = { value: Effect.succeed(user) };
      const selected = condition ? left : right;
      selected.value = task;
      supplied = void 0;
      Effect.runSync(left.value);
    `),
  },
  {
    name: 'observes a choice write through the selected target on every path',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const left: { value: UserTask } = { value: Effect.succeed(user) };
      const right: { value: UserTask } = { value: Effect.succeed(user) };
      const selected = condition ? left : right;
      selected.value = task;
      supplied = void 0;
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'observes a safe overwrite through the selected target on every path',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const left = { value: task };
      const right = { value: task };
      const selected = condition ? left : right;
      selected.value = Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'does not project a safe choice overwrite onto one possible target identity',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const left = { value: task };
      const right = { value: task };
      const selected = condition ? left : right;
      selected.value = Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(left.value);
    `),
  },
  {
    name: 'observes Object.assign through the selected target on every path',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const left = { value: Effect.succeed(user) };
      const right = { value: Effect.succeed(user) };
      const selected = condition ? left : right;
      Object.assign(selected, { value: task });
      supplied = void 0;
      Effect.runSync(selected.value);
    `),
  },
  {
    name: 'does not project Object.assign onto one possible target identity',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const left = { value: Effect.succeed(user) };
      const right = { value: Effect.succeed(user) };
      const selected = condition ? left : right;
      Object.assign(selected, { value: task });
      supplied = void 0;
      Effect.runSync(left.value);
    `),
  },
  {
    name: 'keeps a holder conservative for a safe-or-unsafe Object.assign source',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder = { value: Effect.succeed(user) };
      const source = condition
        ? { value: Effect.succeed(user) }
        : { value: task };
      Object.assign(holder, source);
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
  {
    name: 'keeps a holder conservative for an unsafe-or-safe Object.assign source',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const holder = { value: Effect.succeed(user) };
      const source = condition
        ? { value: task }
        : { value: Effect.succeed(user) };
      Object.assign(holder, source);
      supplied = void 0;
      Effect.runSync(holder.value);
    `),
  },
];

const abruptInvocationCases: readonly CorrelationCase[] = [
  {
    name: 'does not continue after a choice whose undefined run path is abrupt',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected: UserTask | undefined = condition
        ? void 0
        : Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(selected!);
      Effect.runSync(task);
    `),
  },
  {
    name: 'continues after a choice whose alternatives are both safe tasks',
    reports: 1,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected: UserTask = condition
        ? Effect.succeed(user)
        : Effect.succeed(user);
      supplied = void 0;
      Effect.runSync(selected);
      Effect.runSync(task);
    `),
  },
  {
    name: 'does not continue after a choice whose alternatives are both undefined',
    reports: 0,
    source: runtimeSource(`
      declare const condition: boolean;
      const selected: UserTask | undefined = condition ? void 0 : void 0;
      supplied = void 0;
      Effect.runSync(selected!);
      Effect.runSync(task);
    `),
  },
];

const allCases = [
  ...dynamicTaskCases,
  ...choicePropagationCases,
  ...choiceWriteCases,
  ...abruptInvocationCases,
] as const;

const strictTypeScriptDiagnostics = (): readonly string[] => {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const directory = new URL('.', import.meta.url).pathname;
  const sources = new Map(
    allCases.map(({ source }, index): readonly [string, string] => [
      `${directory}runtime-memo-choice-correlation-${index}.fixture.ts`,
      source,
    ]),
  );
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (filename): boolean => sources.has(filename) || fileExists(filename);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(filename);
    if (source === undefined) {
      return getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
    }
    return ts.createSourceFile(filename, source, languageVersion, true);
  };
  host.readFile = (filename): string | undefined => sources.get(filename) ?? readFile(filename);
  return ts
    .getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host))
    .map((diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

describe('effect-no-sync-for-promise runtime memo and choice correlation', (): void => {
  it.each(allCases)('$name', ({ reports, source }): void => {
    expect(
      parseSync('runtime-memo-choice-correlation.ts', source, { sourceType: 'module' }).errors,
    ).toHaveLength(0);
    expect(runRule(ruleName, source)).toHaveLength(reports);
  });

  it('type-checks every memo-choice fixture in strict mode', (): void => {
    expect(strictTypeScriptDiagnostics()).toEqual([]);
  }, 30_000);
});
