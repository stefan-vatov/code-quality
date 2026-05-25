/* -------------------------------------------------------------------------- */
/*       Conservative codemod for safe func-style declaration rewrites.       */
/* -------------------------------------------------------------------------- */
import type {
  ASTPath,
  BlockStatement,
  FunctionDeclaration,
  Identifier,
  Program,
} from 'jscodeshift';
import { Array, HashMap, Option, Order, Predicate, pipe } from 'effect';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface ExportInfo {
  end: number;
  isDefault: boolean;
  prefix: string;
  start: number;
}

interface ReferenceSearch {
  before: number;
  name: string;
  seen: WeakSet<object>;
}

const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value);

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  pipe(
    replacements,
    Array.sortWith((replacement) => -replacement.start, Order.number),
    Array.reduce(
      source,
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
    ),
  );

const nodeStart = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.start),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing a start offset')),
  );

const nodeEnd = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.end),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing an end offset')),
  );

const sourceForNode = (source: string, node: unknown): string =>
  pipe(
    Option.fromNullable(node),
    Option.match({
      onNone: (): string => '',
      onSome: (value): string => source.slice(nodeStart(value), nodeEnd(value)),
    }),
  );

const nodeKey = (node: unknown): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const isFunctionDeclaration = (node: unknown): node is FunctionDeclaration =>
  isObjectRecord(node) && node.type === 'FunctionDeclaration';

const typeParameterText = (source: string, declaration: FunctionDeclaration): string =>
  sourceForNode(source, declaration.typeParameters).trim();

const parameterText = (source: string, declaration: FunctionDeclaration): string =>
  pipe(
    Option.all({
      firstParameter: Array.head(declaration.params),
      lastParameter: Array.last(declaration.params),
    }),
    Option.match({
      onNone: (): string => '',
      onSome: ({ firstParameter, lastParameter }): string =>
        source.slice(nodeStart(firstParameter), nodeEnd(lastParameter)),
    }),
  );

const hasThisParameter = (node: FunctionDeclaration): boolean =>
  pipe(
    node.params,
    Array.some((parameter): boolean => isIdentifier(parameter) && parameter.name === 'this'),
  );

const hasThisExpression = (node: FunctionDeclaration): boolean =>
  codemodAPI(node.body).find(codemodAPI.ThisExpression).size() > 0;

const hasThisSemantics = (node: FunctionDeclaration): boolean =>
  hasThisParameter(node) || hasThisExpression(node);

const isFunctionBoundary = (node: unknown): boolean =>
  isObjectRecord(node) &&
  (node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ObjectMethod');

const nodeStartsAtOrAfter = (value: Record<string, unknown>, before: number): boolean => {
  const { start } = value;
  return typeof start === 'number' && start >= before;
};

const hasEarlierReferenceInRecord = (
  value: Record<string, unknown>,
  search: ReferenceSearch,
): boolean => {
  if (search.seen.has(value)) {
    return false;
  }
  search.seen.add(value);
  if (nodeStartsAtOrAfter(value, search.before)) {
    return false;
  }
  if (isIdentifier(value)) {
    return value.name === search.name;
  }
  if (isFunctionBoundary(value)) {
    return false;
  }
  return pipe(
    Object.values(value),
    Array.some((entry): boolean => hasEarlierReferenceInValue(entry, search)),
  );
};

const hasEarlierReferenceInValue = (value: unknown, search: ReferenceSearch): boolean => {
  if (globalThis.Array.isArray(value)) {
    return pipe(
      value,
      Array.some((entry): boolean => hasEarlierReferenceInValue(entry, search)),
    );
  }
  if (!isObjectRecord(value)) {
    return false;
  }
  return hasEarlierReferenceInRecord(value, search);
};

const hasEarlierReference = (
  root: Program | BlockStatement,
  name: string,
  before: number,
): boolean => hasEarlierReferenceInValue(root, { before, name, seen: new WeakSet() });

const asyncPrefixFor = (node: FunctionDeclaration): string =>
  pipe(
    Option.some(node.async),
    Option.filter(Boolean),
    Option.match({
      onNone: (): string => '',
      onSome: (): string => 'async ',
    }),
  );

const returnTypeFor = (source: string, node: FunctionDeclaration): string =>
  pipe(
    Option.fromNullable(node.returnType),
    Option.match({
      onNone: (): string => '',
      onSome: (returnType): string => sourceForNode(source, returnType),
    }),
  );

const declarationText = (
  source: string,
  node: FunctionDeclaration,
  name: string,
  exportInfo: ExportInfo | undefined,
): string => {
  const typeParameters = typeParameterText(source, node);
  const parameters = parameterText(source, node);
  const body = sourceForNode(source, node.body);
  return [
    `${exportInfo?.prefix ?? ''}const ${name} = `,
    `${asyncPrefixFor(node)}${typeParameters}(${parameters})`,
    `${returnTypeFor(source, node)} => ${body};`,
  ].join('');
};

const collectExportInfo = (source: string): HashMap.HashMap<string, ExportInfo> => {
  let exportsByFunction = HashMap.empty<string, ExportInfo>();
  const root = codemodAPI(source);

  root.find(codemodAPI.ExportNamedDeclaration).forEach((path): void => {
    const { declaration } = path.value;
    if (isFunctionDeclaration(declaration)) {
      exportsByFunction = HashMap.set(exportsByFunction, nodeKey(declaration), {
        end: nodeEnd(path.value),
        isDefault: false,
        prefix: 'export ',
        start: nodeStart(path.value),
      });
    }
  });

  root.find(codemodAPI.ExportDefaultDeclaration).forEach((path): void => {
    const { declaration } = path.value;
    if (isFunctionDeclaration(declaration)) {
      exportsByFunction = HashMap.set(exportsByFunction, nodeKey(declaration), {
        end: nodeEnd(path.value),
        isDefault: true,
        prefix: '',
        start: nodeStart(path.value),
      });
    }
  });

  return exportsByFunction;
};

const collectScopes = (source: string): readonly (Program | BlockStatement)[] => {
  let scopes: readonly (Program | BlockStatement)[] = [];
  const root = codemodAPI(source);

  root.find(codemodAPI.Program).forEach((path): void => {
    scopes = Array.append(scopes, path.value);
  });
  root.find(codemodAPI.BlockStatement).forEach((path): void => {
    scopes = Array.append(scopes, path.value);
  });

  return scopes;
};

const scopeForDeclaration = (
  scopes: readonly (Program | BlockStatement)[],
  declaration: FunctionDeclaration,
): Program | BlockStatement | undefined => {
  const start = nodeStart(declaration);
  const end = nodeEnd(declaration);
  return pipe(
    scopes,
    Array.filter((scope): boolean => nodeStart(scope) <= start && nodeEnd(scope) >= end),
    Array.sortWith((scope) => nodeEnd(scope) - nodeStart(scope), Order.number),
    Array.head,
    Option.getOrUndefined,
  );
};

const replacementSpanForDeclaration = (
  node: FunctionDeclaration,
  exportInfo: ExportInfo | undefined,
): { end: number; start: number } => ({
  end: exportInfo?.end ?? nodeEnd(node),
  start: exportInfo?.start ?? nodeStart(node),
});

const canReplaceDeclaration = (
  node: FunctionDeclaration,
  exportInfo: ExportInfo | undefined,
): node is FunctionDeclaration & { id: Identifier } => {
  if (!isIdentifier(node.id) || !node.body) {
    return false;
  }
  if (exportInfo?.isDefault) {
    return false;
  }
  return !hasThisSemantics(node);
};

const replacementForDeclaration = (
  source: string,
  path: ASTPath<FunctionDeclaration>,
  exportsByFunction: HashMap.HashMap<string, ExportInfo>,
  scopes: readonly (Program | BlockStatement)[],
): Replacement | undefined => {
  const { value: node } = path;
  const exportInfo = pipe(HashMap.get(exportsByFunction, nodeKey(node)), Option.getOrUndefined);
  if (!canReplaceDeclaration(node, exportInfo)) {
    return undefined;
  }

  const { end, start } = replacementSpanForDeclaration(node, exportInfo);
  return pipe(
    Option.fromNullable(scopeForDeclaration(scopes, node)),
    Option.filter((root): boolean => hasEarlierReference(root, node.id.name, start)),
    Option.match({
      onNone: (): Replacement => ({
        end,
        start,
        text: declarationText(source, node, node.id.name, exportInfo),
      }),
      onSome: (): Replacement | undefined => undefined,
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const preferFunctionExpressions = (source: string): string => {
  const replacements: Replacement[] = [];
  const exportsByFunction = collectExportInfo(source);
  const scopes = collectScopes(source);

  codemodAPI(source)
    .find(codemodAPI.FunctionDeclaration)
    .forEach((path): void => {
      pipe(
        Option.fromNullable(replacementForDeclaration(source, path, exportsByFunction, scopes)),
        Option.map((replacement): number => replacements.push(replacement)),
      );
    });

  return applyReplacements(source, replacements);
};
