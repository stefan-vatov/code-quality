/* -------------------------------------------------------------------------- */
/*          Callable and initializer segments for exported surfaces.          */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  advanceDepths,
  braceDeclarationKind,
  declarationBodyStart,
} from './effect-export-declaration-boundaries';
import { stripCommentsAndStrings } from './effect-source-scan';

const findAssignmentEquals = (declaration: string): number =>
  pipe(
    Array.range(0, declaration.length - 1),
    Array.findFirst((index): boolean => {
      const char = declaration[index];
      const previousChar = declaration[index - 1];
      const nextChar = declaration[index + 1];
      return (
        char === '=' &&
        previousChar !== '=' &&
        previousChar !== '!' &&
        previousChar !== '<' &&
        previousChar !== '>' &&
        nextChar !== '=' &&
        nextChar !== '>'
      );
    }),
    Option.getOrElse((): number => -1),
  );

const outerArrowIndex = (source: string): number => {
  const code = stripCommentsAndStrings(source);
  let depths = 0;
  let index = 0;
  while (index < code.length - 1) {
    const char = code[index];
    if (char === '=' && code[index + 1] === '>' && depths === 0) {
      return index;
    }
    depths = advanceDepths(depths, code.charCodeAt(index));
    index += 1;
  }
  return -1;
};

const arrowValueSegment = (value: string): string => {
  const arrowIndex = outerArrowIndex(value);
  return Match.value(arrowIndex).pipe(
    Match.when(-1, (): string => value),
    Match.orElse((index): string => value.slice(index + 2)),
  );
};

const declarationInitializerValue = (declaration: string): string => {
  const equalsIndex = findAssignmentEquals(declaration);
  return Match.value(equalsIndex).pipe(
    Match.when(-1, (): string => declaration),
    Match.orElse((index): string => declaration.slice(index + 1)),
  );
};

const braceBodySegment = (declaration: string): string => {
  const kind = braceDeclarationKind(declaration);
  const bodyStart = declarationBodyStart(
    declaration,
    stripCommentsAndStrings(declaration),
    0,
    kind,
  );
  return Match.value(bodyStart).pipe(
    Match.when(-1, (): string => declaration),
    Match.orElse((start): string => declaration.slice(start)),
  );
};

/**
 * Projects one exported declaration to the value or body analyzed by source rules.
 */
export const exportedDeclarationSegment = (declaration: string): string =>
  Match.value(declaration).pipe(
    Match.when(
      (value): boolean =>
        /^\s*export\s+default\s+(?:(?:async\s+)?function|(?:abstract\s+)?class)\b/.test(value),
      braceBodySegment,
    ),
    Match.when(
      (value): boolean => /^\s*export\s+default\b/.test(value),
      (value): string => arrowValueSegment(value.replace(/^\s*export\s+default\s+/, '')),
    ),
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:const|let|var)\b/.test(value),
      (value): string => arrowValueSegment(declarationInitializerValue(value)),
    ),
    Match.orElse(braceBodySegment),
  );

const callableFunctionSegment = (declaration: string): string[] => {
  const segment = braceBodySegment(declaration);
  if (segment === declaration) {
    return [];
  }
  return [segment];
};

const callableArrowSegment = (value: string): string[] => {
  const arrowIndex = outerArrowIndex(value);
  return Match.value(arrowIndex).pipe(
    Match.when(-1, (): string[] => []),
    Match.orElse((index): string[] => [value.slice(index + 2)]),
  );
};

const callableDefaultSegment = (declaration: string): string[] =>
  callableArrowSegment(declaration.replace(/^\s*export\s+default\s+/, ''));

const callableVariableSegment = (declaration: string): string[] =>
  callableArrowSegment(declarationInitializerValue(declaration));

/**
 * Returns callable bodies only, excluding value, class, type, and ambient projections.
 */
export const exportedCallableDeclarationSegment = (declaration: string): string[] =>
  Match.value(declaration).pipe(
    Match.when(
      (value): boolean => /^\s*export\s+default\s+(?:async\s+)?function\b/.test(value),
      callableFunctionSegment,
    ),
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:async\s+)?function\b/.test(value),
      callableFunctionSegment,
    ),
    Match.when((value): boolean => /^\s*export\s+default\b/.test(value), callableDefaultSegment),
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:const|let|var)\b/.test(value),
      callableVariableSegment,
    ),
    Match.orElse((): string[] => []),
  );
