import { Predicate } from 'effect';
import { childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { canonicalIsUnbound } from './effect-canonical-scope';
import { nativeSourceCodeFor } from './effect-native-references';
import type { Context, RuleSpec, VisitorMap } from './effect-rule-core';

type Matches = (node: ASTNode | undefined, api: string, method: string) => boolean;
type Check = (node: ASTNode, matches: Matches) => boolean;

const field = (node: ASTNode | undefined, key: string): ASTNode | undefined =>
  node && childNode(node, key);
const args = (node: ASTNode | undefined): ASTNode[] => (node ? childNodes(node, 'arguments') : []);
const callee = (node: ASTNode | undefined): ASTNode | undefined => field(node, 'callee');
const isCall = (
  node: ASTNode | undefined,
  matches: Matches,
  api: string,
  method: string,
): boolean => node?.type === 'CallExpression' && matches(callee(node), api, method);

const isPureVoid = (node: ASTNode | undefined, matches: Matches): boolean =>
  (identifierName(node) === 'undefined' && matches(node, 'global', 'undefined')) ||
  (node?.type === 'UnaryExpression' &&
    node.operator === 'void' &&
    field(node, 'argument')?.type === 'Literal');

const callbackValue = (node: ASTNode | undefined): ASTNode | undefined => {
  if (node?.type !== 'ArrowFunctionExpression' || node.async === true) return undefined;
  const body = field(node, 'body');
  if (body?.type !== 'BlockStatement') return body;
  const statements = childNodes(body, 'body');
  if (statements.length === 1 && statements[0]?.type === 'ReturnStatement') {
    return field(statements[0], 'argument');
  }
  return undefined;
};

const mapsToVoid: Check = (node, matches) => {
  if (!isCall(node, matches, 'Effect', 'map')) return false;
  const callback = args(node).at(-1);
  if (
    !callback ||
    childNodes(callback, 'params').some((parameter) => parameter.type !== 'Identifier')
  )
    return false;
  const body = field(callback, 'body');
  return (
    isPureVoid(callbackValue(callback), matches) ||
    (callback?.type === 'ArrowFunctionExpression' &&
      callback.async !== true &&
      body?.type === 'BlockStatement' &&
      childNodes(body, 'body').length === 0)
  );
};

const mapFlatten: Check = (node, matches) => {
  if (isCall(node, matches, 'Effect', 'flatten')) {
    return isCall(args(node)[0], matches, 'Effect', 'map');
  }
  if (identifierName(field(callee(node), 'property')) !== 'pipe') return false;
  const argumentsList = args(node);
  return argumentsList.some(
    (argument, index) =>
      isCall(argument, matches, 'Effect', 'map') &&
      matches(argumentsList[index + 1], 'Effect', 'flatten'),
  );
};

const taggedStruct: Check = (node, matches) => {
  const object = args(node)[0];
  if (!isCall(node, matches, 'Schema', 'Struct') || object?.type !== 'ObjectExpression')
    return false;
  return childNodes(object, 'properties').some(
    (property) =>
      property.computed !== true &&
      identifierName(field(property, 'key')) === '_tag' &&
      isCall(field(property, 'value'), matches, 'Schema', 'Literal') &&
      Predicate.isString(args(field(property, 'value'))[0]?.value) &&
      args(field(property, 'value')).length === 1,
  );
};

const literalUnion: Check = (node, matches) => {
  const alternatives = args(node);
  return (
    isCall(node, matches, 'Schema', 'Union') &&
    alternatives.length > 1 &&
    alternatives.every((argument) => isCall(argument, matches, 'Schema', 'Literal'))
  );
};

const decodeMethods = [
  'decode',
  'decodeUnknown',
  'decodeSync',
  'decodeUnknownSync',
  'decodeEither',
  'decodeUnknownEither',
  'decodePromise',
  'decodeUnknownPromise',
];
const isDecode = (node: ASTNode | undefined, matches: Matches): boolean =>
  node?.type === 'CallExpression' &&
  decodeMethods.some((method) => isCall(callee(node), matches, 'Schema', method));

const parsedJSON: Check = (node, matches) => {
  if (!isDecode(node, matches)) return false;
  const input = args(node)[0];
  if (args(input).length !== 1) return false;
  const member = callee(input);
  return (
    input?.type === 'CallExpression' &&
    member?.type === 'MemberExpression' &&
    identifierName(field(member, 'object')) === 'JSON' &&
    matches(field(member, 'object'), 'global', 'JSON') &&
    identifierName(field(member, 'property')) === 'parse'
  );
};

const serviceKey: Check = (node, matches) => {
  const base = callee(field(node, 'superClass'));
  if (!isCall(base, matches, 'Context', 'Tag') && !isCall(base, matches, 'Effect', 'Service'))
    return false;
  const className = identifierName(field(node, 'id'));
  const keyCall = isCall(base, matches, 'Effect', 'Service') ? field(node, 'superClass') : base;
  const key = args(keyCall)[0]?.value;
  return Boolean(
    className && Predicate.isString(key) && key !== className && !key.endsWith(`/${className}`),
  );
};

const visitors = (context: Context, check: Check): VisitorMap => {
  const nativeSource = nativeSourceCodeFor(context);
  const matcherContext: Context = nativeSource
    ? {
        ...context,
        sourceCode: {
          scopeManager: nativeSource.scopeManager,
          isGlobalReference: (node): boolean => nativeSource.isGlobalReference?.(node) === true,
        },
      }
    : context;
  let enabled = false;
  let root: ASTNode | undefined;
  const importedNames = new Set<string>();
  const matchers = new Map<string, ImportedEffectCallMatcher>();
  const matches: Matches = (node, api, method) => {
    if (!node || !root) return false;
    if (api === 'global')
      return !importedNames.has(method) && canonicalIsUnbound(root, node, method);
    const key = `${api}.${method}`;
    let matcher = matchers.get(key);
    if (!matcher) {
      matcher = importedEffectCallMatcher(matcherContext, api, [method]);
      matcher.initialize(root);
      matchers.set(key, matcher);
    }
    return matcher.matches(node);
  };
  const visit = (node: ASTNode): void => {
    if (enabled && check(node, matches))
      context.report({ node, message: 'Use the canonical Effect pattern.' });
  };
  return {
    Program(node): void {
      root = node;
      for (const statement of childNodes(node, 'body')) {
        if (statement.type !== 'ImportDeclaration') continue;
        for (const binding of childNodes(statement, 'specifiers')) {
          const name = identifierName(field(binding, 'local'));
          if (name) importedNames.add(name);
        }
      }
      enabled = childNodes(node, 'body').some((statement) => {
        const source = field(statement, 'source')?.value;
        return (
          statement.type === 'ImportDeclaration' &&
          Predicate.isString(source) &&
          (source === 'effect' || source.startsWith('effect/'))
        );
      });
    },
    CallExpression: visit,
    ClassDeclaration: visit,
    TSAsExpression: visit,
    TSTypeAssertion: visit,
  };
};

const spec = (name: string, message: string, check: Check): RuleSpec => ({
  name: `effect-${name}`,
  message,
  ast: (context): VisitorMap =>
    visitors(
      { ...context, report: (report): void => context.report({ ...report, message }) },
      check,
    ),
});

const typePath = (node: ASTNode | undefined): string[] => {
  const parts: string[] = [];
  let current = node;
  while (current?.type === 'TSQualifiedName') {
    parts.unshift(identifierName(field(current, 'right')) ?? '');
    current = field(current, 'left');
  }
  parts.unshift(identifierName(current) ?? '');
  return parts;
};

const unknownErrorVisitor = (context: Context): VisitorMap => {
  let root: ASTNode | undefined;
  const namespaces = new Set<string>();
  const direct = new Set<string>();
  const roots = new Set<string>();
  const isEffectType = (path: readonly string[]): boolean => {
    const [binding, middle, last] = path;
    if (!binding) return false;
    if (path.length === 1) return direct.has(binding);
    if (path.length === 2) return namespaces.has(binding) && middle === 'Effect';
    return path.length === 3 && roots.has(binding) && middle === 'Effect' && last === 'Effect';
  };
  const addBinding = (binding: ASTNode, source: ASTNode['value']): void => {
    const local = identifierName(field(binding, 'local'));
    if (!local) return;
    const imported = identifierName(field(binding, 'imported'));
    if (source === 'effect' && imported === 'Effect') namespaces.add(local);
    if (source === 'effect' && binding.type === 'ImportNamespaceSpecifier') roots.add(local);
    if (source === 'effect/Effect' && binding.type === 'ImportNamespaceSpecifier')
      namespaces.add(local);
    if (source === 'effect/Effect' && imported === 'Effect') direct.add(local);
  };
  return {
    Program(node): void {
      root = node;
      for (const statement of childNodes(node, 'body')) {
        if (statement.type !== 'ImportDeclaration') continue;
        const source = field(statement, 'source')?.value;
        for (const binding of childNodes(statement, 'specifiers')) {
          addBinding(binding, source);
        }
      }
    },
    TSTypeReference(node): void {
      const path = typePath(field(node, 'typeName'));
      const binding = path[0];
      if (!root || !binding || !canonicalIsUnbound(root, node, binding)) return;
      const parameters = field(node, 'typeArguments') ?? field(node, 'typeParameters');
      if (
        isEffectType(path) &&
        parameters &&
        childNodes(parameters, 'params')[1]?.type === 'TSUnknownKeyword'
      ) {
        context.report({
          node,
          message: 'Preserve a specific Effect error channel instead of unknown.',
        });
      }
    },
  };
};

export const effectCanonicalSpecs: readonly RuleSpec[] = [
  spec(
    'no-catchAll-with-mapError',
    'Use Effect.mapError for pure error transformations.',
    (node, matches) =>
      isCall(node, matches, 'Effect', 'catchAll') &&
      isCall(callbackValue(args(node).at(-1)), matches, 'Effect', 'fail'),
  ),
  spec(
    'prefer-effect-void',
    'Use Effect.void instead of Effect.succeed(undefined).',
    (node, matches) =>
      isCall(node, matches, 'Effect', 'succeed') &&
      args(node).length === 1 &&
      isPureVoid(args(node)[0], matches),
  ),
  spec(
    'prefer-asVoid',
    'Use Effect.asVoid instead of a pure result-discarding callback.',
    mapsToVoid,
  ),
  spec(
    'prefer-flatMap-over-map-flatten',
    'Use Effect.flatMap instead of map followed by flatten.',
    mapFlatten,
  ),
  spec(
    'prefer-succeed-for-static-layers',
    'Use Layer.succeed for static services.',
    (node, matches) =>
      isCall(node, matches, 'Layer', 'effect') &&
      isCall(args(node)[1], matches, 'Effect', 'succeed'),
  ),
  spec(
    'prefer-schema-tagged-struct',
    'Use Schema.TaggedStruct for literal-tagged structs.',
    taggedStruct,
  ),
  spec(
    'prefer-single-schema-literal-union',
    'Combine plain literal alternatives in one Schema.Literal.',
    literalUnion,
  ),
  spec(
    'schema-require-parseJson-for-json-strings',
    'Use Schema.parseJson instead of JSON.parse before decoding.',
    parsedJSON,
  ),
  spec(
    'schema-no-cast-after-decode',
    'Correct the schema instead of asserting its decoded result.',
    (node, matches) =>
      (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') &&
      isDecode(field(node, 'expression'), matches),
  ),
  {
    name: 'effect-no-error-channel-widening-to-unknown',
    message: 'Preserve a specific Effect error channel instead of unknown.',
    ast: unknownErrorVisitor,
  },
  spec(
    'require-service-class-pattern',
    'Use the class-based Context.Tag service pattern.',
    (node, matches) => isCall(node, matches, 'Context', 'GenericTag'),
  ),
  spec(
    'require-deterministic-service-keys',
    'Service keys must match the class name or end with /ClassName.',
    serviceKey,
  ),
];
