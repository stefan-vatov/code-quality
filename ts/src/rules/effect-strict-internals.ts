/* -------------------------------------------------------------------------- */
/*       AST and source predicates for opt-in strict Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, pipe } from 'effect';
import { effectAPIAliases, effectFunctionAliases, effectImportAliases } from './effect-rule-core';
import {
  exportedDeclarationTexts,
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { isConfiguredPath } from './effect-path-options';

export { hasEffectSignal, hasRuntimeCall } from './effect-rule-core';

interface RuleContext {
  filename?: string;
  options?: object[];
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: object;
  }) => void;
}

type ASTValue = boolean | null | number | object | string | undefined;
type IndexedMatch = RegExpExecArray;

const astValueTypes = HashSet.make('boolean', 'number', 'object', 'string');

const matchesIn = (source: string, pattern: RegExp): readonly IndexedMatch[] =>
  pipe(source.matchAll(pattern), Array.fromIterable);

const matchIndexOrFalse = (match: RegExpExecArray | null): number | false =>
  pipe(
    Option.fromNullable(match),
    Option.map((value): number => value.index),
    Option.getOrElse((): false => false),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const reportAST = (context: RuleContext, message: string, node: object): void => {
  context.report({ message, node });
};

const isASTValue = (value: unknown): value is ASTValue =>
  value === undefined || value === null || HashSet.has(astValueTypes, typeof value);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const objectValue = (node: ASTValue, key: string): ASTValue => {
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(node, key);
  if (isASTValue(value)) {
    return value;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrayValue = (node: ASTValue): ASTValue[] => {
  if (globalThis.Array.isArray(node)) {
    return pipe(node, Array.filter(isASTValue));
  }
  return [];
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const nodeType = (node: ASTValue): string | undefined => {
  const type = objectValue(node, 'type');
  if (typeof type === 'string') {
    return type;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const identifierName = (node: ASTValue): string | undefined => {
  if (nodeType(node) === 'Identifier') {
    const name = objectValue(node, 'name');
    if (typeof name === 'string') {
      return name;
    }
    return undefined;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const literalValue = (node: ASTValue): ASTValue => {
  if (nodeType(node) === 'Literal') {
    return objectValue(node, 'value');
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isVoidZero = (node: ASTValue): boolean => {
  if (nodeType(node) !== 'UnaryExpression') {
    return false;
  }
  return (
    objectValue(node, 'operator') === 'void' && literalValue(objectValue(node, 'argument')) === 0
  );
};

const memberParts = (node: ASTValue): { objectName?: string; propertyName?: string } => {
  if (nodeType(node) !== 'MemberExpression') {
    return {};
  }
  return {
    objectName: identifierName(objectValue(node, 'object')),
    propertyName: identifierName(objectValue(node, 'property')),
  };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isMember = (node: ASTValue, objectName: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return parts.objectName === objectName && parts.propertyName === propertyName;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isSchemaMember = (node: ASTValue, source: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return Boolean(
    parts.objectName &&
    parts.propertyName === propertyName &&
    pipe(effectAPIAliases(source, 'Schema'), Array.contains(parts.objectName)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallPredicate = (
  source: string,
  names: readonly string[],
): ((callee: ASTValue) => boolean) => {
  const memberNames = HashSet.fromIterable(names);
  const importAliases = pipe(effectImportAliases(source), HashSet.fromIterable);
  const functionAliases = pipe(
    names,
    Array.flatMap((name): readonly string[] => effectFunctionAliases(source, 'Effect', name)),
    HashSet.fromIterable,
  );

  return (callee: ASTValue): boolean => {
    const { objectName, propertyName } = memberParts(callee);
    if (objectName && propertyName) {
      return HashSet.has(importAliases, objectName) && HashSet.has(memberNames, propertyName);
    }

    const calleeName = identifierName(callee);
    return Boolean(calleeName && HashSet.has(functionAliases, calleeName));
  };
};

const literalStringValue = (node: ASTValue): string | undefined => {
  const value = literalValue(node);
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const contextTagServiceKey = (innerArguments: ASTValue): string | undefined =>
  pipe(
    arrayValue(innerArguments),
    Array.head,
    Option.flatMapNullable(literalStringValue),
    Option.getOrUndefined,
  );

const effectServiceKey = (outerArguments: ASTValue): string | undefined =>
  pipe(
    arrayValue(outerArguments),
    Array.head,
    Option.flatMapNullable(literalStringValue),
    Option.getOrUndefined,
  );

const contextTagKeyFromMember = (
  member: { objectName?: string; propertyName?: string },
  innerArguments: ASTValue,
): string | undefined => {
  if (
    member.objectName === 'Context' &&
    (member.propertyName === 'Tag' || member.propertyName === 'GenericTag')
  ) {
    return contextTagServiceKey(innerArguments);
  }
  return undefined;
};

const effectServiceKeyFromMember = (
  source: string,
  member: { objectName?: string; propertyName?: string },
  outerArguments: ASTValue,
): string | undefined => {
  if (
    member.objectName &&
    pipe(effectImportAliases(source), Array.contains(member.objectName)) &&
    member.propertyName === 'Service'
  ) {
    return effectServiceKey(outerArguments);
  }
  return undefined;
};

const serviceClassSuperCallParts = (
  node: ASTValue,
): { className?: string; inner: ASTValue; outerArguments: ASTValue } | undefined => {
  const superClass = objectValue(node, 'superClass');
  const className = identifierName(objectValue(node, 'id'));
  if (nodeType(superClass) !== 'CallExpression') {
    return undefined;
  }
  const inner = objectValue(superClass, 'callee');
  if (!inner || nodeType(inner) !== 'CallExpression') {
    return undefined;
  }
  return { className, inner, outerArguments: objectValue(superClass, 'arguments') };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const serviceKeyFromClass = (
  node: ASTValue,
  source: string,
): { className?: string; key?: string } => {
  const className = identifierName(objectValue(node, 'id'));
  const parts = serviceClassSuperCallParts(node);
  if (!parts) {
    return { className };
  }
  const innerArguments = objectValue(parts.inner, 'arguments');
  const member = memberParts(objectValue(parts.inner, 'callee'));
  const key =
    contextTagKeyFromMember(member, innerArguments) ??
    effectServiceKeyFromMember(source, member, parts.outerArguments);
  if (key) {
    return { className, key };
  }
  return { className };
};

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

const functionBodySegment = (code: string, matchIndex: number): string | undefined => {
  const bodyStart = code.indexOf('{', matchIndex);
  if (bodyStart === -1) {
    return undefined;
  }
  const bodyEnd = findMatchingBrace(code, bodyStart);
  if (bodyEnd === -1) {
    return undefined;
  }
  return code.slice(bodyStart, bodyEnd + 1);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRunSyncInServerRequestHandler = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return (
    pipe(
      matchesIn(code, /\b(?:handler|route|loader|action)\s*=/g),
      Array.some((match): boolean => {
        const segment = code.slice(match.index, findStatementEnd(code, match.index) + 1);
        return /\bEffect\.runSync\s*\(/.test(segment);
      }),
    ) ||
    pipe(
      matchesIn(code, /\bfunction\s+(?:handler|route|loader|action)\s*\(/g),
      Array.some((match): boolean =>
        pipe(
          Option.fromNullable(functionBodySegment(code, match.index)),
          Option.exists((body): boolean => /\bEffect\.runSync\s*\(/.test(body)),
        ),
      ),
    )
  );
};

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

const nonDeterministicServiceKeyIndex = (code: string, pattern: RegExp): number | undefined =>
  pipe(
    matchesIn(code, pattern),
    Array.findFirst((match): boolean => {
      const [, className, key] = match;
      return className !== key && !key.endsWith(`/${className}`);
    }),
    Option.map((match): number => match.index),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasNonDeterministicServiceKey = (source: string): number | false => {
  const code = stripComments(source);
  const legacyPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:Context\.Tag|Effect\.Service|Effect\.Tag)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const legacyIndex = nonDeterministicServiceKeyIndex(code, legacyPattern);
  if (legacyIndex !== undefined) {
    return legacyIndex;
  }

  const servicePattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*[A-Z][\w$]*\s*>\s*\(\s*\)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  return nonDeterministicServiceKeyIndex(code, servicePattern) ?? false;
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
  matchIndexOrFalse(
    /\bfrom\s+['"]node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)['"]/.exec(
      stripComments(source),
    ),
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
