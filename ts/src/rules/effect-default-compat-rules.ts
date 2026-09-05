/* -------------------------------------------------------------------------- */
/*             Compatibility and runtime-tail Effect rule specs.              */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
import {
  effectServiceSelfName,
  identifierName,
  objectValue,
  reportAST,
} from './effect-default-ast';
import { stripComments, stripCommentsAndStrings } from './effect-source-helpers';
import type { RuleSpec, VisitorMap } from './effect-rule-core';
import { asNode } from './effect-ast';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';

const serviceMismatchIndex = (code: string, pattern: RegExp): number | undefined =>
  pipe(
    Array.fromIterable(code.matchAll(pattern)),
    Array.findFirst((match): boolean => match[1] !== match[2]),
    Option.flatMap((match) => Option.fromNullable(match.index)),
    Option.getOrUndefined,
  );

const hasServiceSelfMismatch = (source: string): number | false => {
  const code = stripComments(source);
  const contextTagPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Context\.Tag\s*<\s*([A-Z][\w$]*)\s*>/g;
  const contextTagIndex = serviceMismatchIndex(code, contextTagPattern);
  return pipe(
    Option.fromNullable(contextTagIndex),
    Option.match({
      onNone: (): number | false => {
        const servicePattern =
          /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*([A-Z][\w$]*)\s*>/g;
        return pipe(
          Option.fromNullable(serviceMismatchIndex(code, servicePattern)),
          Option.getOrElse((): false => false),
        );
      },
      onSome: (index): number => index,
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDefaultCompatibilitySpecs = [
  {
    message:
      'Import Effect APIs from the main effect package; deprecated split packages are blocked.',
    name: 'effect-no-obsolete-imports',
    patterns: [/from\s+['"]@effect\/(?:io|data)['"]/],
    tokens: ['@effect/io', '@effect/data'],
  },
  {
    ast: (context): VisitorMap => {
      const fakeEffectAPI = importedEffectCallMatcher(context, 'Effect', [
        'bracket',
        'fromEither',
        'fromPromise',
        'tryCatch',
      ]);
      let hasReported = false;
      return {
        CallExpression(node): void {
          if (!hasReported && fakeEffectAPI.matches(asNode(objectValue(node, 'callee')))) {
            hasReported = true;
            reportAST(context, 'This is not a known Effect API for the configured version.', node);
          }
        },
        Program: fakeEffectAPI.initialize,
      };
    },
    check: (source): boolean =>
      /\bEffect\.(?:fromPromise|tryCatch|bracket|fromEither)\s*\(/.test(
        stripCommentsAndStrings(source),
      ),
    message: 'This is not a known Effect API for the configured version.',
    name: 'effect-no-known-fake-api',
    tokens: ['fromPromise', 'tryCatch', 'bracket', 'fromEither'],
  },
  {
    message: 'Use Schema from effect/Schema instead of @effect/schema.',
    name: 'effect-no-deprecated-schema-package',
    patterns: [/from\s+['"]@effect\/schema['"]/],
    tokens: ['@effect/schema'],
  },
  {
    message: 'Use the current Context.Tag class/service pattern instead of deprecated tag helpers.',
    name: 'effect-no-deprecated-context-tag-function',
    patterns: [
      /\b(?:const|let|var)\s+[A-Z][\w$]*\s*=\s*Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
      /(?:^|[;\n]\s*)Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
    ],
    tokens: ['Context.Tag'],
  },
  {
    ast: (context, source): VisitorMap => ({
      ClassDeclaration(node): void {
        const className = identifierName(objectValue(node, 'id'));
        const selfName = effectServiceSelfName(objectValue(node, 'superClass'), source);
        if (className !== undefined && selfName !== undefined && className !== selfName) {
          reportAST(
            context,
            'Effect service/tag self type must match the declaring class name.',
            node,
          );
        }
      },
    }),
    check: hasServiceSelfMismatch,
    message: 'Effect service/tag self type must match the declaring class name.',
    name: 'effect-require-service-self-match',
    tokenGroups: [['class'], ['extends'], ['Context', 'Service', 'Tag']],
  },
] satisfies readonly RuleSpec[];
