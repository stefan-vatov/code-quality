/* -------------------------------------------------------------------------- */
/*        Prefer Option nullish getters over manual isSome extraction.        */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import type { NativeSourceCode } from './effect-native-references';
import type { ScopeStack } from './effect-ast-scope';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { nativeSourceCodeFor } from './effect-native-references';
import { readCachedSource } from './source-cache';
import { scopeContainingBinding } from './effect-ast-scope';
import { strictPathOptionsSchema } from './effect-path-options';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

export {
  default as preferCollectionDiscardOverAsVoidRule,
  preferAllDiscardRule,
  preferForEachDiscardRule,
} from './effect-prefer-collection-discard-over-asvoid';

interface CandidateSite {
  executionContext: ASTNode;
  scopes: ScopeStack;
  switchCase?: ASTNode;
}

interface StableConstBinding {
  declarationEnd: number;
  executionContext: ASTNode;
  switchCase?: ASTNode;
}

interface RuleState {
  candidates: WeakMap<object, CandidateSite>;
  importedValueNames: Set<string>;
  isSome: ImportedEffectCallMatcher;
  rootPackageNamespaces: Set<string>;
  seen: WeakSet<object>;
  sourceCode: NativeSourceCode | undefined;
  stableConsts: WeakMap<ReadonlySet<string>, Map<string, StableConstBinding>>;
}

interface OptionTraversalContext {
  executionContext: ASTNode;
  switchCase: ASTNode | undefined;
}

const MESSAGE = diagnosticMessage({
  example: 'import { Option } from "effect"\n\nconst value = Option.getOrUndefined(decoded)',
  fix: 'Replace the conditional with the matching Option nullish getter.',
  summary:
    'Use Option.getOrNull or Option.getOrUndefined instead of manually extracting the value from Option.isSome.',
});

const nodeOffset = (node: ASTNode, key: 'end' | 'start'): number | undefined => {
  const value: unknown = Reflect.get(node, key);
  if (typeof value === 'number') {
    return value;
  }
  return undefined;
};

const literalString = (node: ASTNode | undefined): string | undefined => {
  const value: unknown = node && Reflect.get(node, 'value');
  if (node?.type === 'Literal' && typeof value === 'string') {
    return value;
  }
  return undefined;
};

const isTypeImport = (node: ASTNode): boolean => Reflect.get(node, 'importKind') === 'type';

const isEffectImport = (statement: ASTNode): boolean => {
  if (statement.type !== 'ImportDeclaration') {
    return false;
  }
  const source = literalString(childNode(statement, 'source'));
  return source === 'effect' || source === 'effect/Option';
};

const hasEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isEffectImport);

const addImportedUndefined = (names: Set<string>, specifier: ASTNode): void => {
  if (!isTypeImport(specifier) && identifierName(childNode(specifier, 'local')) === 'undefined') {
    names.add('undefined');
  }
};

const indexImportedUndefined = (program: ASTNode, names: Set<string>): void => {
  for (const statement of childNodes(program, 'body')) {
    if (statement.type === 'ImportDeclaration' && !isTypeImport(statement)) {
      for (const specifier of childNodes(statement, 'specifiers')) {
        addImportedUndefined(names, specifier);
      }
    }
  }
};

const addRootPackageNamespace = (names: Set<string>, specifier: ASTNode): void => {
  if (specifier.type !== 'ImportNamespaceSpecifier' || isTypeImport(specifier)) {
    return;
  }
  const name = identifierName(childNode(specifier, 'local'));
  if (name) {
    names.add(name);
  }
};

const rootPackageNamespaces = (program: ASTNode): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const statement of childNodes(program, 'body')) {
    if (
      statement.type === 'ImportDeclaration' &&
      !isTypeImport(statement) &&
      literalString(childNode(statement, 'source')) === 'effect'
    ) {
      for (const specifier of childNodes(statement, 'specifiers')) {
        addRootPackageNamespace(names, specifier);
      }
    }
  }
  return names;
};

const scopeContaining = (name: string, scopes: ScopeStack): ReadonlySet<string> | undefined =>
  scopeContainingBinding(name, scopes);

const registerStableDeclarator = (
  declarator: ASTNode,
  scopes: ScopeStack,
  state: RuleState,
  executionContext: ASTNode,
  switchCase: ASTNode | undefined,
): void => {
  const name = identifierName(childNode(declarator, 'id'));
  const declarationEnd = nodeOffset(declarator, 'end');
  if (!name || !childNode(declarator, 'init') || declarationEnd === undefined) {
    return;
  }
  const scope = scopeContaining(name, scopes);
  if (!scope) {
    return;
  }
  const bindings = state.stableConsts.get(scope) ?? new Map<string, StableConstBinding>();
  bindings.set(name, { declarationEnd, executionContext, switchCase });
  state.stableConsts.set(scope, bindings);
};

const registerStableConsts = (
  node: ASTNode,
  scopes: ScopeStack,
  state: RuleState,
  executionContext: ASTNode,
  switchCase: ASTNode | undefined,
): void => {
  if (node.type !== 'VariableDeclaration' || Reflect.get(node, 'kind') !== 'const') {
    return;
  }
  for (const declarator of childNodes(node, 'declarations')) {
    registerStableDeclarator(declarator, scopes, state, executionContext, switchCase);
  }
};

const isFunctionContext = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

const executionContextFor = (node: ASTNode, current: ASTNode): ASTNode => {
  if (isFunctionContext(node)) {
    return node;
  }
  return current;
};

const switchCaseFor = (node: ASTNode, current: ASTNode | undefined): ASTNode | undefined => {
  if (isFunctionContext(node)) {
    return undefined;
  }
  if (node.type === 'SwitchCase') {
    return node;
  }
  return current;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

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

const exactArgument = (call: ASTNode): ASTNode | undefined => {
  if (
    Reflect.get(call, 'optional') === true ||
    hasTypeArguments(call) ||
    hasOptionalMemberAccess(childNode(call, 'callee'))
  ) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  const [argument] = callArguments;
  if (callArguments.length !== 1 || argument?.type === 'SpreadElement') {
    return undefined;
  }
  return argument;
};

const isDirectRootPackageCall = (callee: ASTNode, namespaces: ReadonlySet<string>): boolean =>
  callee.type === 'MemberExpression' &&
  namespaces.has(String(identifierName(childNode(callee, 'object'))));

const isEarlierStableConst = (node: ASTNode, state: RuleState, site: CandidateSite): boolean => {
  const name = String(identifierName(node));
  const referenceStart = Number(nodeOffset(node, 'start'));
  const scope = scopeContaining(name, site.scopes);
  const binding = scope && state.stableConsts.get(scope)?.get(name);
  return Boolean(
    binding &&
    binding.declarationEnd <= referenceStart &&
    binding.executionContext === site.executionContext &&
    (binding.switchCase === undefined || binding.switchCase === site.switchCase),
  );
};

const testedIdentifier = (
  conditional: ASTNode,
  state: RuleState,
  site: CandidateSite,
): ASTNode | undefined => {
  const test = childNode(conditional, 'test');
  if (test?.type !== 'CallExpression') {
    return undefined;
  }
  const callee = childNode(test, 'callee');
  const argument = exactArgument(test);
  if (
    !callee ||
    !argument ||
    !identifierName(argument) ||
    isDirectRootPackageCall(callee, state.rootPackageNamespaces) ||
    !state.isSome.matches(callee) ||
    !isEarlierStableConst(argument, state, site)
  ) {
    return undefined;
  }
  return argument;
};

const isMatchingValueAccess = (node: ASTNode | undefined, name: string): boolean =>
  node?.type === 'MemberExpression' &&
  Reflect.get(node, 'computed') !== true &&
  Reflect.get(node, 'optional') !== true &&
  identifierName(childNode(node, 'object')) === name &&
  identifierName(childNode(node, 'property')) === 'value';

const isGlobalUndefined = (node: ASTNode, site: CandidateSite, state: RuleState): boolean => {
  if (identifierName(node) !== 'undefined') {
    return false;
  }
  if (state.sourceCode) {
    return state.sourceCode.isGlobalReference?.(node) === true;
  }
  return (
    !state.importedValueNames.has('undefined') &&
    scopeContaining('undefined', site.scopes) === undefined
  );
};

const isNullishFallback = (node: ASTNode, site: CandidateSite, state: RuleState): boolean => {
  const value: unknown = Reflect.get(node, 'value');
  return value === null || isGlobalUndefined(node, site, state);
};

const matchingCallee = (conditional: ASTNode, state: RuleState): ASTNode | undefined => {
  const site = state.candidates.get(conditional);
  if (!site) {
    return undefined;
  }
  const tested = testedIdentifier(conditional, state, site);
  const testedName = tested && identifierName(tested);
  const fallback = childNode(conditional, 'alternate');
  if (
    !testedName ||
    !isMatchingValueAccess(childNode(conditional, 'consequent'), testedName) ||
    !fallback ||
    !isNullishFallback(fallback, site, state)
  ) {
    return undefined;
  }
  const test = childNode(conditional, 'test');
  return test && childNode(test, 'callee');
};

const reportCandidate = (value: object, state: RuleState, context: Context): void => {
  const conditional = asNode(value);
  if (!conditional) {
    return;
  }
  const callee = matchingCallee(conditional, state);
  if (callee) {
    context.report({ message: MESSAGE, node: callee });
  }
};

const indexProgram = (value: object, state: RuleState): void => {
  const program = asNode(value);
  if (!program) {
    return;
  }
  state.isSome.initialize(program);
  if (!hasEffectImport(program)) {
    return;
  }
  indexImportedUndefined(program, state.importedValueNames);
  for (const name of rootPackageNamespaces(program)) {
    state.rootPackageNamespaces.add(name);
  }
  visitASTWithStack<OptionTraversalContext>({
    context: { executionContext: program, switchCase: undefined },
    onNode(
      node,
      nodeScopes,
      _inheritedScopes,
      traversalContext,
    ): {
      context: OptionTraversalContext;
      visitChildren: boolean;
    } {
      const nodeExecutionContext = executionContextFor(node, traversalContext.executionContext);
      const nodeSwitchCase = switchCaseFor(node, traversalContext.switchCase);
      if (node.type === 'ConditionalExpression') {
        state.candidates.set(node, {
          executionContext: nodeExecutionContext,
          scopes: nodeScopes,
          switchCase: nodeSwitchCase,
        });
      }
      registerStableConsts(node, nodeScopes, state, nodeExecutionContext, nodeSwitchCase);
      return {
        context: { executionContext: nodeExecutionContext, switchCase: nodeSwitchCase },
        visitChildren: true,
      };
    },
    root: program,
    scopes: [],
    seenNodes: state.seen,
  });
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('isSome') &&
  (source.includes('null') || source.includes('undefined'));

const rule: SourceRule = {
  create(context) {
    const source = readCachedSource(context);
    if (!hasCandidateTokens(source)) {
      return { Program(): void {} };
    }
    const state: RuleState = {
      candidates: new WeakMap(),
      importedValueNames: new Set(),
      isSome: importedEffectCallMatcher(context, 'Option', ['isSome']),
      rootPackageNamespaces: new Set(),
      seen: new WeakSet(),
      sourceCode: nativeSourceCodeFor(context),
      stableConsts: new WeakMap(),
    };
    return {
      ConditionalExpression(node): void {
        reportCandidate(node, state, context);
      },
      Program(node): void {
        indexProgram(node, state);
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
