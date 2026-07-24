/* -------------------------------------------------------------------------- */
/*       Prefer Effect.map when flatMap only returns an Effect.succeed.       */
/* -------------------------------------------------------------------------- */
import type { Context, SourceRule } from './effect-rule-core';
import type { NativeReference, NativeSourceCode } from './effect-native-references';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  isImportReference,
  nativeReferenceIndexFor,
  nativeSourceCodeFor,
} from './effect-native-references';
import { scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { diagnosticMessage } from './diagnostic-guidance';
import { strictPathOptionsSchema } from './effect-path-options';

type EffectAPI = 'flatMap' | 'namespace' | 'rootNamespace' | 'succeed';
type EffectModuleSource = 'effect' | 'effect/Effect';

interface EffectBinding {
  API: EffectAPI;
  localName: string;
}

type EffectBindingResolver = (
  specifier: ASTNode,
  importedName: string | undefined,
  localName: string,
) => EffectBinding | undefined;

interface RuleState {
  imports: Map<string, EffectAPI>;
  nativeReferences: WeakMap<object, NativeReference> | undefined;
  seen: WeakSet<object>;
  sourceCode: NativeSourceCode | undefined;
}

const MESSAGE = diagnosticMessage({
  example: 'const result = program.pipe(Effect.map((value) => value + 1))',
  fix: 'Replace Effect.flatMap with Effect.map and return the value directly from the callback.',
  summary:
    'Effect.map expresses this success-value transformation more directly than Effect.flatMap followed by Effect.succeed.',
});

const isShadowed = (name: string, scopes: ScopeStack): boolean =>
  scopes.some((scope): boolean => scope.has(name));

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (node?.type === 'Literal' && typeof value === 'string') {
    return value;
  }
  return undefined;
};

const namespaceImportReference = (
  callee: ASTNode | undefined,
  API: Exclude<EffectAPI, 'namespace' | 'rootNamespace'>,
): ASTNode | undefined => {
  if (
    callee?.type !== 'MemberExpression' ||
    Reflect.get(callee, 'computed') === true ||
    identifierName(childNode(callee, 'property')) !== API
  ) {
    return undefined;
  }
  return childNode(callee, 'object');
};

const rootNamespaceImportReference = (
  callee: ASTNode | undefined,
  API: Exclude<EffectAPI, 'namespace' | 'rootNamespace'>,
): ASTNode | undefined => {
  if (
    callee?.type !== 'MemberExpression' ||
    Reflect.get(callee, 'computed') === true ||
    identifierName(childNode(callee, 'property')) !== API
  ) {
    return undefined;
  }
  const effectMember = childNode(callee, 'object');
  if (
    effectMember?.type !== 'MemberExpression' ||
    Reflect.get(effectMember, 'computed') === true ||
    identifierName(childNode(effectMember, 'property')) !== 'Effect'
  ) {
    return undefined;
  }
  return childNode(effectMember, 'object');
};

const isImportedBinding = (
  reference: ASTNode | undefined,
  API: EffectAPI,
  state: RuleState,
  scopes: ScopeStack,
): boolean => {
  const name = identifierName(reference);
  if (!name || state.imports.get(name) !== API) {
    return false;
  }
  if (state.sourceCode) {
    return isImportReference(reference, nativeReferencesFor(state));
  }
  return !isShadowed(name, scopes);
};

const nativeReferencesFor = (state: RuleState): WeakMap<object, NativeReference> | undefined => {
  const mutableState = state;
  if (!mutableState.nativeReferences && mutableState.sourceCode) {
    mutableState.nativeReferences = nativeReferenceIndexFor(mutableState.sourceCode);
  }
  return mutableState.nativeReferences;
};

const isImportedAPI = (
  callee: ASTNode | undefined,
  API: Exclude<EffectAPI, 'namespace' | 'rootNamespace'>,
  state: RuleState,
  scopes: ScopeStack,
): boolean => {
  if (callee?.type === 'Identifier') {
    return isImportedBinding(callee, API, state, scopes);
  }
  return (
    isImportedBinding(namespaceImportReference(callee, API), 'namespace', state, scopes) ||
    isImportedBinding(rootNamespaceImportReference(callee, API), 'rootNamespace', state, scopes)
  );
};

const singleReturnExpression = (body: ASTNode): ASTNode | undefined => {
  const statements = childNodes(body, 'body');
  const [statement] = statements;
  if (statements.length === 1 && statement?.type === 'ReturnStatement') {
    return childNode(statement, 'argument');
  }
  return undefined;
};

const returnedExpression = (
  callback: ASTNode,
  scopes: ScopeStack,
): { expression?: ASTNode; scopes: ScopeStack } => {
  const callbackScopes = withNodeScope(scopes, callback);
  const body = childNode(callback, 'body');
  if (body?.type !== 'BlockStatement') {
    return { expression: body, scopes: callbackScopes };
  }
  const bodyScopes = scopesForChild(callbackScopes, callback, 'body');
  return {
    expression: singleReturnExpression(body),
    scopes: withNodeScope(bodyScopes, body),
  };
};

const nativeReturnedExpression = (
  callback: ASTNode,
  scopes: ScopeStack,
): { expression?: ASTNode; scopes: ScopeStack } => {
  const body = childNode(callback, 'body');
  if (body?.type === 'BlockStatement') {
    return { expression: singleReturnExpression(body), scopes };
  }
  return { expression: body, scopes };
};

const returnedExpressionFor = (
  callback: ASTNode,
  state: RuleState,
  scopes: ScopeStack,
): { expression?: ASTNode; scopes: ScopeStack } => {
  if (state.nativeReferences) {
    return nativeReturnedExpression(callback, scopes);
  }
  return returnedExpression(callback, scopes);
};

const isCallbackFunction = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

const hasTypeParameters = (transform: ASTNode): boolean => {
  const typeParameters = childNode(transform, 'typeParameters');
  return Boolean(typeParameters && childNodes(typeParameters, 'params').length > 0);
};

const isSupportedCallback = (transform: ASTNode | undefined): transform is ASTNode =>
  isCallbackFunction(transform) &&
  Reflect.get(transform, 'async') !== true &&
  Reflect.get(transform, 'generator') !== true &&
  !hasTypeParameters(transform);

const isSucceedOnlyCallback = (
  callback: ASTNode | undefined,
  state: RuleState,
  scopes: ScopeStack,
): boolean => {
  if (!isSupportedCallback(callback)) {
    return false;
  }
  const returned = returnedExpressionFor(callback, state, scopes);
  return (
    returned.expression?.type === 'CallExpression' &&
    childNodes(returned.expression, 'arguments').length === 1 &&
    isImportedAPI(childNode(returned.expression, 'callee'), 'succeed', state, returned.scopes)
  );
};

const flatMapCallback = (node: ASTNode): ASTNode | undefined => {
  const args = childNodes(node, 'arguments');
  if (args.length === 1) {
    return args[0];
  }
  if (args.length === 2) {
    return args[1];
  }
  return undefined;
};

const visitChildValue = (
  value: unknown,
  state: RuleState,
  scopes: ScopeStack,
  context: Context,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitChildValue(item, state, scopes, context);
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    visitNode(child, state, scopes, context);
  }
};

const visitChildren = (
  node: ASTNode,
  state: RuleState,
  nodeScopes: ScopeStack,
  context: Context,
): void => {
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'parent') {
      visitChildValue(value, state, scopesForChild(nodeScopes, node, key), context);
    }
  }
};

const visitNode = (node: ASTNode, state: RuleState, scopes: ScopeStack, context: Context): void => {
  if (state.seen.has(node)) {
    return;
  }
  state.seen.add(node);
  const nodeScopes = withNodeScope(scopes, node);
  if (
    node.type === 'CallExpression' &&
    isImportedAPI(childNode(node, 'callee'), 'flatMap', state, nodeScopes) &&
    isSucceedOnlyCallback(flatMapCallback(node), state, nodeScopes)
  ) {
    context.report({ message: MESSAGE, node: childNode(node, 'callee') ?? node });
  }
  visitChildren(node, state, nodeScopes, context);
};

const reportNativeCandidate = (value: object, state: RuleState, context: Context): void => {
  if (state.imports.size === 0) {
    return;
  }
  const node = asNode(value);
  if (
    node?.type === 'CallExpression' &&
    isImportedAPI(childNode(node, 'callee'), 'flatMap', state, []) &&
    isSucceedOnlyCallback(flatMapCallback(node), state, [])
  ) {
    context.report({ message: MESSAGE, node: childNode(node, 'callee') ?? node });
  }
};

const isEffectFunctionAPI = (name: string | undefined): name is 'flatMap' | 'succeed' =>
  name === 'flatMap' || name === 'succeed';

const rootPackageBinding = (
  specifier: ASTNode,
  importedName: string | undefined,
  localName: string,
): EffectBinding | undefined => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return { API: 'rootNamespace', localName };
  }
  if (importedName === 'Effect') {
    return { API: 'namespace', localName };
  }
  return undefined;
};

const effectModuleBinding = (
  specifier: ASTNode,
  importedName: string | undefined,
  localName: string,
): EffectBinding | undefined => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return { API: 'namespace', localName };
  }
  if (isEffectFunctionAPI(importedName)) {
    return { API: importedName, localName };
  }
  return undefined;
};

const effectBindingResolvers: Readonly<Record<EffectModuleSource, EffectBindingResolver>> = {
  effect: rootPackageBinding,
  'effect/Effect': effectModuleBinding,
};

const effectBindingForSpecifier = (
  source: EffectModuleSource,
  specifier: ASTNode,
): EffectBinding | undefined => {
  const names = {
    importedName: identifierName(childNode(specifier, 'imported')),
    localName: identifierName(childNode(specifier, 'local')),
  };
  const { importedName, localName } = names;
  if (!localName) {
    return undefined;
  }
  return effectBindingResolvers[source](specifier, importedName, localName);
};

const isTypeImport = (node: ASTNode): boolean => Reflect.get(node, 'importKind') === 'type';

const isEffectModuleSource = (source: string | undefined): source is EffectModuleSource =>
  source === 'effect' || source === 'effect/Effect';

const addSpecifierBinding = (
  imports: Map<string, EffectAPI>,
  source: EffectModuleSource,
  specifier: ASTNode,
): void => {
  if (isTypeImport(specifier)) {
    return;
  }
  const binding = effectBindingForSpecifier(source, specifier);
  if (binding) {
    imports.set(binding.localName, binding.API);
  }
};

const addImportBindings = (imports: Map<string, EffectAPI>, declaration: ASTNode): void => {
  const source = literalString(childNode(declaration, 'source'));
  if (!isEffectModuleSource(source)) {
    return;
  }
  if (isTypeImport(declaration)) {
    return;
  }
  for (const specifier of childNodes(declaration, 'specifiers')) {
    addSpecifierBinding(imports, source, specifier);
  }
};

const indexEffectImports = (program: ASTNode, imports: Map<string, EffectAPI>): void => {
  imports.clear();
  for (const statement of childNodes(program, 'body')) {
    if (statement.type === 'ImportDeclaration') {
      addImportBindings(imports, statement);
    }
  }
};

const sourceTextFor = (context: Context): string | undefined =>
  context.sourceCode?.text ?? context.sourceCode?.getText?.();

const hasSupportedCallbackToken = (source: string | undefined): boolean =>
  source === undefined || source.includes('=>') || source.includes('function');

const initializeNativeState = (value: object, state: RuleState): void => {
  const program = asNode(value);
  if (!program) {
    return;
  }
  indexEffectImports(program, state.imports);
};

const initializeFallbackState = (value: object, state: RuleState, context: Context): void => {
  const program = asNode(value);
  if (!program) {
    return;
  }
  indexEffectImports(program, state.imports);
  if (state.imports.size > 0) {
    visitNode(program, state, [], context);
  }
};

const rule: SourceRule = {
  create(context) {
    const sourceCode = nativeSourceCodeFor(context);
    const hasCallbackCandidate = hasSupportedCallbackToken(sourceTextFor(context));
    const state: RuleState = {
      imports: new Map(),
      nativeReferences: undefined,
      seen: new WeakSet(),
      sourceCode,
    };
    if (sourceCode) {
      const visitors: ReturnType<SourceRule['create']> = {
        Program(node): void {
          initializeNativeState(node, state);
        },
      };
      if (hasCallbackCandidate) {
        visitors.CallExpression = (node): void => {
          reportNativeCandidate(node, state, context);
        };
      }
      return visitors;
    }
    return {
      Program(node): void {
        initializeFallbackState(node, state, context);
      },
    };
  },
  meta: {
    docs: {
      description: MESSAGE,
    },
    schema: strictPathOptionsSchema,
    type: 'problem',
  },
};

export default rule;
