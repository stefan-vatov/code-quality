/* -------------------------------------------------------------------------- */
/*      Prefer Effect.succeed for values stable when an Effect is built.      */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import type { NativeReference, NativeSourceCode } from './effect-native-references';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  effectAPIBindingsFor,
  indexEffectAPIBindingsFromProgram,
  isEffectCall,
  unwrappedExpression,
} from './effect-boundary-ast-shared';
import { nativeReferenceIndexFor, nativeSourceCodeFor } from './effect-native-references';
import { scopeContainingBinding, scopesForChild, withNodeScope } from './effect-ast-scope';
import type { ASTNode } from './effect-ast';
import type { EffectAPIBindings } from './effect-boundary-ast-shared';
import type { ScopeStack } from './effect-ast-scope';
import { diagnosticMessage } from './diagnostic-guidance';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

interface StableRuleState {
  bindings: EffectAPIBindings;
  callSites: WeakMap<object, StableCallSite>;
  references: WeakMap<object, NativeReference> | undefined;
  seen: WeakSet<object>;
  sourceCode: NativeSourceCode | undefined;
  stableConsts: WeakMap<ReadonlySet<string>, Map<string, StableConstBinding>>;
}

interface StableCallSite {
  executionContext: ASTNode;
  scopes: ScopeStack;
  switchCase?: ASTNode;
}

interface StableConstBinding {
  declarationEnd: number;
  executionContext: ASTNode;
  switchCase?: ASTNode;
}

interface ReturnedExpression {
  expression?: ASTNode;
  scopes: ScopeStack;
}

interface StableTraversalContext {
  executionContext: ASTNode;
  switchCase: ASTNode | undefined;
}

const MESSAGE = diagnosticMessage({
  example: 'const task = Effect.succeed(value)',
  fix: 'Replace Effect.sync with Effect.succeed and remove the zero-argument thunk.',
  summary: 'Effect.succeed expresses this stable value more directly than Effect.sync.',
});
const syncTokenPattern = /\bsync\b/u;

const nodeOffset = (node: ASTNode, key: 'end' | 'start'): number | undefined => {
  const value: unknown = Reflect.get(node, key);
  if (typeof value === 'number') {
    return value;
  }
  return undefined;
};

const literalString = (node: ASTNode | undefined): string | undefined => {
  const value: unknown = node && Reflect.get(node, 'value');
  if ((node?.type === 'Literal' || node?.type === 'StringLiteral') && typeof value === 'string') {
    return value;
  }
  return undefined;
};

const hasEffectImportDeclaration = (program: ASTNode): boolean => {
  for (const statement of childNodes(program, 'body')) {
    if (statement.type === 'ImportDeclaration') {
      const source = literalString(childNode(statement, 'source'));
      if (source === 'effect' || source === 'effect/Effect') {
        return true;
      }
    }
  }
  return false;
};

const indexImports = (program: ASTNode, bindings: EffectAPIBindings): void => {
  indexEffectAPIBindingsFromProgram(bindings, program);
  if (!hasEffectImportDeclaration(program)) {
    bindings.namespaces.clear();
  }
};

const hasSyncBinding = (bindings: EffectAPIBindings): boolean =>
  bindings.namespaces.size > 0 ||
  bindings.rootNamespaces.size > 0 ||
  bindings.syncFunctions.size > 0;

const scopeContaining = (name: string, scopes: ScopeStack): ReadonlySet<string> | undefined =>
  scopeContainingBinding(name, scopes);

const registerStableDeclarator = (
  declarator: ASTNode,
  scopes: ScopeStack,
  state: StableRuleState,
  executionContext: ASTNode,
  switchCase: ASTNode | undefined,
): void => {
  const binding = {
    declarationEnd: nodeOffset(declarator, 'end'),
    initializer: childNode(declarator, 'init'),
    name: identifierName(childNode(declarator, 'id')),
  };
  if (!binding.name || !binding.initializer || binding.declarationEnd === undefined) {
    return;
  }
  const scope = scopeContaining(binding.name, scopes);
  if (!scope) {
    return;
  }
  const bindings = state.stableConsts.get(scope) ?? new Map<string, StableConstBinding>();
  bindings.set(binding.name, {
    declarationEnd: binding.declarationEnd,
    executionContext,
    switchCase,
  });
  state.stableConsts.set(scope, bindings);
};

const registerStableConsts = (
  node: ASTNode,
  scopes: ScopeStack,
  state: StableRuleState,
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

const executionContextFor = (node: ASTNode, executionContext: ASTNode): ASTNode => {
  if (isFunctionContext(node)) {
    return node;
  }
  return executionContext;
};

const switchCaseFor = (node: ASTNode, switchCase: ASTNode | undefined): ASTNode | undefined => {
  if (isFunctionContext(node)) {
    return undefined;
  }
  if (node.type === 'SwitchCase') {
    return node;
  }
  return switchCase;
};

const registerCallSite = (
  node: ASTNode,
  scopes: ScopeStack,
  state: StableRuleState,
  executionContext: ASTNode,
  switchCase: ASTNode | undefined,
): void => {
  if (node.type === 'CallExpression') {
    state.callSites.set(node, { executionContext, scopes, switchCase });
  }
};

const isSupportedThunk = (node: ASTNode | undefined): node is ASTNode =>
  (node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression') &&
  childNodes(node, 'params').length === 0 &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true;

const singleReturnExpression = (body: ASTNode): ASTNode | undefined => {
  const statements = childNodes(body, 'body');
  const [statement] = statements;
  if (statements.length === 1 && statement?.type === 'ReturnStatement') {
    return childNode(statement, 'argument');
  }
  return undefined;
};

const returnedExpression = (thunk: ASTNode, scopes: ScopeStack): ReturnedExpression => {
  const thunkScopes = withNodeScope(scopes, thunk);
  const body = childNode(thunk, 'body');
  if (body?.type !== 'BlockStatement') {
    return { expression: unwrappedExpression(body), scopes: thunkScopes };
  }
  const bodyScopes = scopesForChild(thunkScopes, thunk, 'body');
  return {
    expression: unwrappedExpression(singleReturnExpression(body)),
    scopes: withNodeScope(bodyScopes, body),
  };
};

const stableLiteralNodeTypes: ReadonlySet<string> = new Set([
  'BigIntLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'NumericLiteral',
  'StringLiteral',
]);
const stableLiteralValueTypes: ReadonlySet<string> = new Set([
  'bigint',
  'boolean',
  'number',
  'string',
]);

const isStableLiteral = (node: ASTNode): boolean => {
  if (node.type === 'TemplateLiteral') {
    return childNodes(node, 'expressions').length === 0;
  }
  if (node.type !== 'Literal') {
    return stableLiteralNodeTypes.has(node.type);
  }
  const value: unknown = Reflect.get(node, 'value');
  return value === null || stableLiteralValueTypes.has(typeof value);
};

const isEarlierStableConst = (
  node: ASTNode,
  scopes: ScopeStack,
  state: StableRuleState,
  site: StableCallSite,
): boolean => {
  const name = identifierName(node);
  const referenceStart = nodeOffset(node, 'start');
  if (!name || referenceStart === undefined) {
    return false;
  }
  const scope = scopeContaining(name, scopes);
  const binding = scope && state.stableConsts.get(scope)?.get(name);
  return Boolean(
    binding &&
    binding.declarationEnd <= referenceStart &&
    binding.executionContext === site.executionContext &&
    (binding.switchCase === undefined || binding.switchCase === site.switchCase),
  );
};

const isGlobalUndefined = (node: ASTNode, scopes: ScopeStack, state: StableRuleState): boolean => {
  if (identifierName(node) !== 'undefined') {
    return false;
  }
  if (state.sourceCode) {
    return state.sourceCode.isGlobalReference?.(node) === true;
  }
  return scopeContaining('undefined', scopes) === undefined;
};

const isStableExpression = (
  expression: ASTNode | undefined,
  scopes: ScopeStack,
  state: StableRuleState,
  site: StableCallSite,
): boolean =>
  Boolean(
    expression &&
    (isStableLiteral(expression) ||
      isGlobalUndefined(expression, scopes, state) ||
      isEarlierStableConst(expression, scopes, state, site)),
  );

const supportedThunkFor = (
  call: ASTNode,
  scopes: ScopeStack,
  state: StableRuleState,
): ASTNode | undefined => {
  if (!isEffectCall(call, 'sync', state.bindings, scopes, state.references)) {
    return undefined;
  }
  const argumentsValue = childNodes(call, 'arguments');
  const [thunk] = argumentsValue;
  if (argumentsValue.length === 1 && isSupportedThunk(thunk)) {
    return thunk;
  }
  return undefined;
};

const reportStableThunk = (
  call: ASTNode,
  site: StableCallSite,
  state: StableRuleState,
  context: Context,
): void => {
  const { scopes } = site;
  const thunk = supportedThunkFor(call, scopes, state);
  if (!thunk) {
    return;
  }
  const returned = returnedExpression(thunk, scopes);
  if (isStableExpression(returned.expression, returned.scopes, state, site)) {
    context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
  }
};

const reportCandidate = (node: object, state: StableRuleState, context: Context): void => {
  const call = asNode(node);
  if (!call) {
    return;
  }
  const site = state.callSites.get(call);
  if (site) {
    reportStableThunk(call, site, state, context);
  }
};

const indexProgram = (node: object, state: StableRuleState): void => {
  const program = asNode(node);
  if (!program) {
    return;
  }
  indexImports(program, state.bindings);
  if (hasSyncBinding(state.bindings)) {
    visitASTWithStack<StableTraversalContext>({
      context: { executionContext: program, switchCase: undefined },
      onNode(
        currentNode,
        nodeScopes,
        _inheritedScopes,
        traversalContext,
      ): {
        context: StableTraversalContext;
        visitChildren: boolean;
      } {
        const nodeExecutionContext = executionContextFor(
          currentNode,
          traversalContext.executionContext,
        );
        const nodeSwitchCase = switchCaseFor(currentNode, traversalContext.switchCase);
        registerCallSite(currentNode, nodeScopes, state, nodeExecutionContext, nodeSwitchCase);
        registerStableConsts(currentNode, nodeScopes, state, nodeExecutionContext, nodeSwitchCase);
        return {
          context: { executionContext: nodeExecutionContext, switchCase: nodeSwitchCase },
          visitChildren: true,
        };
      },
      root: program,
      scopes: [],
      seenNodes: state.seen,
    });
  }
};

const visitorsFor = (
  context: Context,
  state: StableRuleState,
): ReturnType<SourceRule['create']> => ({
  CallExpression(node): void {
    reportCandidate(node, state, context);
  },
  Program(node): void {
    indexProgram(node, state);
  },
});

const rule: SourceRule = {
  create(context) {
    const source = readCachedSource(context);
    if (!syncTokenPattern.test(source)) {
      return { Program(): void {} };
    }
    const nativeSourceCode = nativeSourceCodeFor(context);
    const state: StableRuleState = {
      bindings: effectAPIBindingsFor(source),
      callSites: new WeakMap(),
      references: nativeSourceCode && nativeReferenceIndexFor(nativeSourceCode),
      seen: new WeakSet(),
      sourceCode: nativeSourceCode,
      stableConsts: new WeakMap(),
    };
    return visitorsFor(context, state);
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
