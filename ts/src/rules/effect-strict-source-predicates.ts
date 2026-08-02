/* -------------------------------------------------------------------------- */
/*           Source predicates for opt-in strict Effect lint rules.           */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
import {
  exportedDeclarationTexts,
  findBalancedCallEnd,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { hasRunSyncInServerRequestHandlerSource } from './effect-strict-server-handler-source';
import { isConfiguredPath } from './effect-path-options';

interface RuleContext {
  filename?: string;
  options?: object[];
}

type IndexedMatch = RegExpExecArray;

const matchesIn = (source: string, pattern: RegExp): readonly IndexedMatch[] =>
  pipe(source.matchAll(pattern), Array.fromIterable);

const matchIndexOrFalse = (match: RegExpExecArray | null): number | false =>
  pipe(
    Option.fromNullable(match),
    Option.map((value): number => value.index),
    Option.getOrElse((): false => false),
  );

const codeMatchIndexOrFalse = (
  commentFreeSource: string,
  codeOnlySource: string,
  pattern: RegExp,
  predicate: (match: IndexedMatch) => boolean = (): boolean => true,
): number | false =>
  pipe(
    matchesIn(commentFreeSource, pattern),
    Array.findFirst((match): boolean => codeOnlySource[match.index] !== ' ' && predicate(match)),
    Option.map((match): number => match.index),
    Option.getOrElse((): false => false),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRetryScheduleWithoutJitter = (source: string): boolean =>
  pipe(
    matchesIn(source, /\bEffect\.retry\s*\(/g),
    Array.some((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      const callBody = source.slice(
        openParenIndex + 1,
        findBalancedCallEnd(source, openParenIndex),
      );
      return /\bSchedule\./.test(callBody) && !/\bjitter(?:ed)?\b/.test(callBody);
    }),
  );

const declarationBeforeBody = (declaration: string): string => {
  const bodyStart = declaration.indexOf('{');
  if (bodyStart === -1) {
    return declaration;
  }
  return declaration.slice(0, bodyStart);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const publicAPIDeclarationSignature = (declaration: string): string => {
  if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(declaration)) {
    return declarationBeforeBody(declaration);
  }

  if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
    return declarationBeforeBody(declaration);
  }

  return declaration;
};

const hasClassPromiseReturningPublicMember = (declaration: string): boolean => {
  if (!/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(declaration)) {
    return false;
  }

  const signatureSource = stripCommentsAndStrings(declaration);
  const publicMemberPrefix = String.raw`(?!private\b|protected\b)(?:(?:public|static|abstract|override|declare|readonly)\s+)*`;
  const memberName = String.raw`[A-Za-z_$][\w$]*`;
  const memberStart = `(?:^|[{\\n;]\\s*)${publicMemberPrefix}${memberName}`;
  const accessorStart = `(?:^|[{\\n;]\\s*)${publicMemberPrefix}`;
  return (
    new RegExp(`${memberStart}\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`(?:^|[{\\n;]\\s*)${publicMemberPrefix}async\\s+${memberName}\\s*\\([^)]*\\)`).test(
      signatureSource,
    ) ||
    new RegExp(`${memberStart}\\s*=\\s*async\\b`).test(signatureSource) ||
    new RegExp(`${memberStart}\\s*=\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`${memberStart}\\s*:\\s*[^;\\n=]*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`${accessorStart}get\\s+${memberName}\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(
      signatureSource,
    ) ||
    new RegExp(`${accessorStart}accessor\\s+${memberName}\\s*:\\s*[^;\\n=]*Promise\\s*<`).test(
      signatureSource,
    )
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasPromiseReturningPublicAPI = (source: string): boolean =>
  pipe(
    exportedDeclarationTexts(source),
    Array.some((declaration): boolean => {
      if (/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(declaration)) {
        return hasClassPromiseReturningPublicMember(declaration);
      }

      const signature = stripCommentsAndStrings(publicAPIDeclarationSignature(declaration));
      return (
        /\bPromise\s*</.test(signature) ||
        /^\s*(?:export\s+)?async\s+function\b/.test(signature) ||
        /=\s*async\b/.test(signature)
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasExportedRunPromiseAPI = (source: string): boolean =>
  pipe(
    exportedDeclarationTexts(source),
    Array.some((declaration): boolean =>
      /\bEffect\.runPromise\s*\(/.test(stripCommentsAndStrings(declaration)),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRunSyncInServerRequestHandler = hasRunSyncInServerRequestHandlerSource;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasCryptoRandomUUID = (source: string): number | false =>
  matchIndexOrFalse(/\bcrypto\.randomUUID\s*\(/.exec(stripCommentsAndStrings(source)));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSchemaInstanceof = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  return matchIndexOrFalse(/\binstanceof\s+[A-Z][\w$]*(?:Schema|Request)\b/.exec(code));
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSchemaStructWithTag = (source: string): number | false =>
  matchIndexOrFalse(
    /\bSchema\.Struct\s*\(\s*{[\s\S]*?_tag\s*:\s*Schema\.Literal\s*\(/.exec(
      stripCommentsAndStrings(source),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSchemaUnionOfLiterals = (source: string): number | false =>
  matchIndexOrFalse(
    /\bSchema\.Union\s*\(\s*Schema\.Literal\s*\([^)]*\)\s*,\s*Schema\.Literal\s*\(/.exec(
      stripCommentsAndStrings(source),
    ),
  );

const nonDeterministicServiceKeyIndex = (
  code: string,
  codeOnly: string,
  pattern: RegExp,
): number | false =>
  codeMatchIndexOrFalse(code, codeOnly, pattern, (match): boolean => {
    const [, className, key] = match;
    return className !== key && !key.endsWith(`/${className}`);
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasNonDeterministicServiceKey = (source: string): number | false => {
  const code = stripComments(source);
  const codeOnly = stripCommentsAndStrings(source);
  const legacyPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:Context\.Tag|Effect\.Service|Effect\.Tag)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const legacyIndex = nonDeterministicServiceKeyIndex(code, codeOnly, legacyPattern);
  if (legacyIndex !== false) {
    return legacyIndex;
  }

  const servicePattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*[A-Z][\w$]*\s*>\s*\(\s*\)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  return nonDeterministicServiceKeyIndex(code, codeOnly, servicePattern);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMultipleProvideChain = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  return matchIndexOrFalse(
    /\.pipe\s*\([\s\S]*?Effect\.provide\s*\([\s\S]*?Effect\.provide\s*\(/.exec(code),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasLayerEffectWithScope = (source: string): number | false => {
  const code = stripCommentsAndStrings(source);
  return matchIndexOrFalse(/\bLayer\.effect\s*\([\s\S]*?\b(?:Scope\.Scope|Scope)\b/.exec(code));
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasNodeBuiltinImport = (source: string): number | false =>
  codeMatchIndexOrFalse(
    stripComments(source),
    stripCommentsAndStrings(source),
    /\bfrom\s+['"]node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)['"]/g,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasGlobalFetch = (source: string, context: RuleContext): number | false => {
  const code = stripCommentsAndStrings(source);
  if (isConfiguredPath(context, 'adapterLayers')) {
    return false;
  }

  return pipe(
    matchesIn(code, /\bfetch\s*\(/g),
    Array.findFirst((match): boolean => Boolean(effectWrapperStatement(code, match.index))),
    Option.map((match): number => match.index),
    Option.getOrElse((): false => false),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasEffectSucceedWithVoid = (source: string): number | false =>
  matchIndexOrFalse(
    /\bEffect\.succeed\s*\(\s*(?:undefined|void\s+0)?\s*\)/.exec(stripCommentsAndStrings(source)),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMapToVoid = (source: string): number | false =>
  matchIndexOrFalse(
    /\bEffect\.map\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|void\s+0|\{\s*\})\s*\)/.exec(
      stripCommentsAndStrings(source),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMapFlatten = (source: string): number | false =>
  matchIndexOrFalse(
    /\bEffect\.map\s*\([\s\S]*?\)\s*,\s*Effect\.flatten\b|\bEffect\.map\s*\([\s\S]*?\)\.pipe\s*\(\s*Effect\.flatten\b/.exec(
      stripCommentsAndStrings(source),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectWrapperStatement = (source: string, targetIndex: number): string | undefined => {
  const statementStart = Math.max(
    source.lastIndexOf(';', targetIndex) + 1,
    source.lastIndexOf('\n', targetIndex) + 1,
  );
  const statementEnd = findStatementEnd(source, statementStart);
  const statement = source.slice(statementStart, statementEnd + 1);
  if (/\bEffect\.(?:promise|tryPromise)\s*\(/.test(statement)) {
    return statement;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasDirectPlatformAccess = (source: string, context: RuleContext): boolean => {
  if (isConfiguredPath(context, 'adapterLayers')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\b(?:fetch|readFileSync|writeFileSync|createReadStream)\s*\(/g),
    Array.some((match): boolean => {
      if (!match[0].startsWith('fetch')) {
        return true;
      }

      return !effectWrapperStatement(code, match.index);
    }),
  );
};
