/* -------------------------------------------------------------------------- */
/*            Prefer Effect.asSome over mapping with Option.some.             */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import type { NativeReference, NativeSourceCode } from './effect-native-references';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  isImportReference,
  nativeReferenceIndexFor,
  nativeSourceCodeFor,
} from './effect-native-references';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { scopeHasBinding } from './effect-ast-scope';
import { strictPathOptionsSchema } from './effect-path-options';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

type OptionBinding = 'namespace' | 'rootNamespace' | 'some';

interface OptionReference {
  expression: ASTNode;
  importIdentifier: ASTNode;
}

interface OptionReferenceState {
  bindings: Map<string, OptionBinding>;
  fallbackReferences: WeakSet<object>;
  nativeReferences: WeakMap<object, NativeReference> | undefined;
  sourceCode: NativeSourceCode | undefined;
}

const MESSAGE = diagnosticMessage({
  example: 'import { Effect } from "effect"\n\nconst optional = Effect.asSome(program)',
  fix: 'Use the asSome export from the same Effect import style instead of mapping with Option.some.',
  summary:
    'Effect.asSome expresses mapping an Effect success value to Option.some more directly than Effect.map(Option.some).',
});

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const isTypeImport = (node: ASTNode): boolean => Reflect.get(node, 'importKind') === 'type';

const addRootBinding = (
  bindings: Map<string, OptionBinding>,
  specifier: ASTNode,
  localName: string,
): void => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    bindings.set(localName, 'rootNamespace');
  } else if (identifierName(childNode(specifier, 'imported')) === 'Option') {
    bindings.set(localName, 'namespace');
  }
};

const addOptionBinding = (
  bindings: Map<string, OptionBinding>,
  specifier: ASTNode,
  localName: string,
): void => {
  if (specifier.type === 'ImportNamespaceSpecifier') {
    bindings.set(localName, 'namespace');
  } else if (identifierName(childNode(specifier, 'imported')) === 'some') {
    bindings.set(localName, 'some');
  }
};

const addSpecifierBinding = (
  bindings: Map<string, OptionBinding>,
  specifier: ASTNode,
  source: string,
): void => {
  const localName = identifierName(childNode(specifier, 'local'));
  if (!localName || isTypeImport(specifier)) {
    return;
  }
  if (source === 'effect') {
    addRootBinding(bindings, specifier, localName);
  } else {
    addOptionBinding(bindings, specifier, localName);
  }
};

const addImportBindings = (bindings: Map<string, OptionBinding>, declaration: ASTNode): void => {
  if (declaration.type !== 'ImportDeclaration' || isTypeImport(declaration)) {
    return;
  }
  const source = literalString(childNode(declaration, 'source'));
  if (source !== 'effect' && source !== 'effect/Option') {
    return;
  }
  for (const specifier of childNodes(declaration, 'specifiers')) {
    addSpecifierBinding(bindings, specifier, source);
  }
};

const indexOptionImports = (program: ASTNode, bindings: Map<string, OptionBinding>): void => {
  bindings.clear();
  for (const statement of childNodes(program, 'body')) {
    addImportBindings(bindings, statement);
  }
};

const parenthesizedExpression = (node: ASTNode | undefined): ASTNode | undefined => {
  let expression = node;
  while (expression?.type === 'ParenthesizedExpression') {
    expression = childNode(expression, 'expression');
  }
  return expression;
};

const isPlainMember = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'MemberExpression' &&
  Reflect.get(node, 'computed') !== true &&
  Reflect.get(node, 'optional') !== true;

const directSomeReference = (
  expression: ASTNode,
  state: OptionReferenceState,
): OptionReference | undefined => {
  const name = identifierName(expression);
  if (name && state.bindings.get(name) === 'some') {
    return { expression, importIdentifier: expression };
  }
  return undefined;
};

const namespaceSomeReference = (
  expression: ASTNode,
  state: OptionReferenceState,
): OptionReference | undefined => {
  if (!isPlainMember(expression) || identifierName(childNode(expression, 'property')) !== 'some') {
    return undefined;
  }
  const object = childNode(expression, 'object');
  const objectName = identifierName(object);
  if (object && objectName && state.bindings.get(objectName) === 'namespace') {
    return { expression, importIdentifier: object };
  }
  return undefined;
};

const rootSomeReference = (
  expression: ASTNode,
  state: OptionReferenceState,
): OptionReference | undefined => {
  if (!isPlainMember(expression) || identifierName(childNode(expression, 'property')) !== 'some') {
    return undefined;
  }
  const optionMember = childNode(expression, 'object');
  if (
    !isPlainMember(optionMember) ||
    identifierName(childNode(optionMember, 'property')) !== 'Option'
  ) {
    return undefined;
  }
  const root = childNode(optionMember, 'object');
  const rootName = identifierName(root);
  if (root && rootName && state.bindings.get(rootName) === 'rootNamespace') {
    return { expression, importIdentifier: root };
  }
  return undefined;
};

const optionSomeReference = (
  value: ASTNode | undefined,
  state: OptionReferenceState,
): OptionReference | undefined => {
  const expression = parenthesizedExpression(value);
  if (!expression) {
    return undefined;
  }
  return (
    directSomeReference(expression, state) ??
    namespaceSomeReference(expression, state) ??
    rootSomeReference(expression, state)
  );
};

const isShadowed = (name: string, scopes: ScopeStack): boolean => scopeHasBinding(name, scopes);

const addFallbackReference = (
  node: ASTNode,
  state: OptionReferenceState,
  scopes: ScopeStack,
): void => {
  const reference = optionSomeReference(node, state);
  const name = reference && identifierName(reference.importIdentifier);
  if (reference && name && !isShadowed(name, scopes)) {
    state.fallbackReferences.add(reference.expression);
  }
};

const nativeReferencesFor = (
  state: OptionReferenceState,
): WeakMap<object, NativeReference> | undefined => {
  const mutableState = state;
  if (!mutableState.nativeReferences && mutableState.sourceCode) {
    mutableState.nativeReferences = nativeReferenceIndexFor(mutableState.sourceCode);
  }
  return mutableState.nativeReferences;
};

const isImportedSomeReference = (
  value: ASTNode | undefined,
  state: OptionReferenceState,
): boolean => {
  const reference = optionSomeReference(value, state);
  if (!reference) {
    return false;
  }
  if (state.sourceCode) {
    return isImportReference(reference.importIdentifier, nativeReferencesFor(state));
  }
  return state.fallbackReferences.has(reference.expression);
};

const hasTypeArguments = (call: ASTNode): boolean =>
  Boolean(childNode(call, 'typeArguments') || childNode(call, 'typeParameters'));

const hasOptionalMemberAccess = (node: ASTNode | undefined): boolean => {
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression' && !seen.has(current)) {
    seen.add(current);
    if (Reflect.get(current, 'optional') === true) {
      return true;
    }
    current = childNode(current, 'object');
  }
  return false;
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasOptionalMemberAccess(childNode(call, 'callee'));

const mapCallback = (call: ASTNode): ASTNode | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== 1 && callArguments.length !== 2) {
    return undefined;
  }
  for (const callArgument of callArguments) {
    if (callArgument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments[callArguments.length - 1];
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('map') && source.includes('some');

const rule: SourceRule = {
  create(context: Context) {
    const source = readCachedSource(context);
    if (!hasCandidateTokens(source)) {
      return { Program(): void {} };
    }

    const effectMap = importedEffectCallMatcher(context, 'Effect', ['map']);
    const state: OptionReferenceState = {
      bindings: new Map(),
      fallbackReferences: new WeakSet(),
      nativeReferences: undefined,
      sourceCode: nativeSourceCodeFor(context),
    };
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (!call) {
          return;
        }
        const callback = mapCallback(call);
        if (
          callback &&
          effectMap.matches(childNode(call, 'callee')) &&
          isImportedSomeReference(callback, state)
        ) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program) {
          return;
        }
        indexOptionImports(program, state.bindings);
        if (state.bindings.size === 0) {
          return;
        }
        isInitialized = true;
        effectMap.initialize(program);
        if (!state.sourceCode) {
          visitASTWithStack({
            context: state,
            onNode(node, nodeScopes): { context: OptionReferenceState; visitChildren: boolean } {
              addFallbackReference(node, state, nodeScopes);
              return { context: state, visitChildren: true };
            },
            root: program,
            scopes: [],
          });
        }
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
