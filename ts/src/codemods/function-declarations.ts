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
  typeof value === 'object' && value !== null;

const applyReplacements = (source: string, replacements: readonly Replacement[]): string =>
  [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end),
      source,
    );

const nodeStart = (node: unknown): number => {
  if (isObjectRecord(node)) {
    const { start } = node;
    if (typeof start === 'number') {
      return start;
    }
  }
  throw new Error('jscodeshift node is missing a start offset');
};

const nodeEnd = (node: unknown): number => {
  if (isObjectRecord(node)) {
    const { end } = node;
    if (typeof end === 'number') {
      return end;
    }
  }
  throw new Error('jscodeshift node is missing an end offset');
};

const sourceForNode = (source: string, node: unknown): string => {
  if (!node) {
    return '';
  }
  return source.slice(nodeStart(node), nodeEnd(node));
};

const nodeKey = (node: unknown): string => `${nodeStart(node)}:${nodeEnd(node)}`;

const isIdentifier = (node: unknown): node is Identifier =>
  isObjectRecord(node) && node.type === 'Identifier' && typeof node.name === 'string';

const isFunctionDeclaration = (node: unknown): node is FunctionDeclaration =>
  isObjectRecord(node) && node.type === 'FunctionDeclaration';

const typeParameterText = (source: string, declaration: FunctionDeclaration): string =>
  sourceForNode(source, declaration.typeParameters).trim();

const parameterText = (source: string, declaration: FunctionDeclaration): string => {
  const [firstParameter] = declaration.params;
  const lastParameter = declaration.params.at(-1);
  if (!firstParameter || !lastParameter) {
    return '';
  }
  return source.slice(nodeStart(firstParameter), nodeEnd(lastParameter));
};

const hasThisParameter = (node: FunctionDeclaration): boolean =>
  node.params.some((parameter): boolean => {
    if (isIdentifier(parameter)) {
      return parameter.name === 'this';
    }
    return false;
  });

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
  return Object.values(value).some((entry): boolean => hasEarlierReferenceInValue(entry, search));
};

const hasEarlierReferenceInValue = (value: unknown, search: ReferenceSearch): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry): boolean => hasEarlierReferenceInValue(entry, search));
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

const asyncPrefixFor = (node: FunctionDeclaration): string => {
  if (node.async) {
    return 'async ';
  }
  return '';
};

const returnTypeFor = (source: string, node: FunctionDeclaration): string => {
  if (node.returnType) {
    return sourceForNode(source, node.returnType);
  }
  return '';
};

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

const collectExportInfo = (source: string): ReadonlyMap<string, ExportInfo> => {
  const exportsByFunction = new Map<string, ExportInfo>();
  const root = codemodAPI(source);

  root.find(codemodAPI.ExportNamedDeclaration).forEach((path): void => {
    const { declaration } = path.value;
    if (isFunctionDeclaration(declaration)) {
      exportsByFunction.set(nodeKey(declaration), {
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
      exportsByFunction.set(nodeKey(declaration), {
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
  const scopes: (Program | BlockStatement)[] = [];
  const root = codemodAPI(source);

  root.find(codemodAPI.Program).forEach((path): void => {
    scopes.push(path.value);
  });
  root.find(codemodAPI.BlockStatement).forEach((path): void => {
    scopes.push(path.value);
  });

  return scopes;
};

const scopeForDeclaration = (
  scopes: readonly (Program | BlockStatement)[],
  declaration: FunctionDeclaration,
): Program | BlockStatement | undefined => {
  const start = nodeStart(declaration);
  const end = nodeEnd(declaration);
  return scopes
    .filter((scope): boolean => nodeStart(scope) <= start && nodeEnd(scope) >= end)
    .sort(
      (left, right) => nodeEnd(left) - nodeStart(left) - (nodeEnd(right) - nodeStart(right)),
    )[0];
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
  exportsByFunction: ReadonlyMap<string, ExportInfo>,
  scopes: readonly (Program | BlockStatement)[],
): Replacement | undefined => {
  const { value: node } = path;
  const exportInfo = exportsByFunction.get(nodeKey(node));
  if (!canReplaceDeclaration(node, exportInfo)) {
    return undefined;
  }

  const { end, start } = replacementSpanForDeclaration(node, exportInfo);
  const root = scopeForDeclaration(scopes, node);
  if (root && hasEarlierReference(root, node.id.name, start)) {
    return undefined;
  }

  return {
    end,
    start,
    text: declarationText(source, node, node.id.name, exportInfo),
  };
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
      const replacement = replacementForDeclaration(source, path, exportsByFunction, scopes);
      if (replacement) {
        replacements.push(replacement);
      }
    });

  return applyReplacements(source, replacements);
};
