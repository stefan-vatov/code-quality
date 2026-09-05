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

export const effectDefaultCompatibilitySpecs = [
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
