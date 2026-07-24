import { describe, expect, it } from 'vitest';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationTexts,
} from '../../src/rules/effect-exported-declarations';
import {
  hasExportedRunPromiseAPI,
  hasPromiseReturningPublicAPI,
} from '../../src/rules/effect-strict-internals';
import { runRule } from './effect-rule-test-utils';

const sourceLines = (...lines: string[]): string => lines.join('\n');

const promiseDeclaration = 'const load = async (): Promise<void> => Effect.runPromise(program);';
const promiseCallableSegment = ' Effect.runPromise(program);';

const expectProjectedPromiseBinding = (exportedExpression: string): void => {
  const source = sourceLines(promiseDeclaration, `export default ${exportedExpression};`);

  expect.soft(exportedDeclarationTexts(source)).toEqual([promiseDeclaration]);
  expect.soft(exportedCallableDeclarationSegments(source)).toEqual([promiseCallableSegment]);
  expect.soft(hasPromiseReturningPublicAPI(source)).toBe(true);
  expect.soft(hasExportedRunPromiseAPI(source)).toBe(true);
  expect.soft(runRule('effect-no-promise-returning-public-api', source)).toHaveLength(1);
  expect.soft(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(1);
};

const expectUnprojectedWrappedExpression = (exportedExpression: string): void => {
  const exportDeclaration = `export default ${exportedExpression};`;
  const source = sourceLines(promiseDeclaration, exportDeclaration);

  expect.soft(exportedDeclarationTexts(source)).toEqual([exportDeclaration]);
  expect.soft(exportedCallableDeclarationSegments(source)).toEqual([]);
  expect.soft(hasPromiseReturningPublicAPI(source)).toBe(false);
  expect.soft(hasExportedRunPromiseAPI(source)).toBe(false);
  expect.soft(runRule('effect-no-promise-returning-public-api', source)).toHaveLength(0);
  expect.soft(runRule('effect-no-runpromise-in-exported-api', source)).toHaveLength(0);
};

describe('Effect default-export TypeScript identifier wrappers', (): void => {
  it('projects an identifier through an as assertion', (): void => {
    expectProjectedPromiseBinding('load as PublicLoader');
  });

  it('recursively projects an identifier through parenthesized as assertion chains', (): void => {
    expectProjectedPromiseBinding('(((load)) as unknown as PublicLoader)');
  });

  it('projects an identifier through a non-null assertion', (): void => {
    expectProjectedPromiseBinding('load!');
  });

  it('projects an identifier through a non-TSX angle-bracket assertion', (): void => {
    expectProjectedPromiseBinding('<PublicLoader>load');
  });
});

describe('Effect default-export non-identifier wrapper controls', (): void => {
  it.each([
    ['a member expression', 'api.load as PublicLoader'],
    ['an invoked identifier', 'load() as PublicLoader'],
    ['an object expression', '({ version: 1 } as PublicLoader)'],
  ])('does not project %s to a same-named module binding', (_name, exportedExpression): void => {
    expectUnprojectedWrappedExpression(exportedExpression);
  });
});
