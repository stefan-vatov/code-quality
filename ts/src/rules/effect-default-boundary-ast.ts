/* -------------------------------------------------------------------------- */
/*     Promise and recursion boundary visitors for default Effect rules.      */
/* -------------------------------------------------------------------------- */

import type { NativeReference, NativeSourceCode } from './effect-native-references';
import type { PromiseRuntimeTasks, PromiseTaskExecutionSite } from './effect-promise-runtime-tasks';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import {
  callableBinding,
  containerHelperScopes,
  functionHeaderScopes,
} from './effect-promise-callables';
import {
  couldBeEffectCall,
  indexEffectAPIBindingsFromProgram,
  isEffectCall,
  isFunctionNode,
  isShadowed,
} from './effect-boundary-ast-shared';
import {
  helperScopesForNativeFrame,
  visitNativePromiseProgram,
} from './effect-promise-program-traversal';
import {
  indexPromiseRuntimeTasks,
  isDeferredPromiseSync,
  recordPromiseTaskSite,
} from './effect-promise-runtime-tasks';
import { isGlobalObjectAssignCall, staticMemberNames } from './effect-object-assign-provenance';
import { nativeReferenceIndexFor, nativeSourceCodeFor } from './effect-native-references';
import { programBindingsFor, sourceBindingsFor } from './effect-promise-rule-bindings';
import type { ASTNode } from './effect-ast';
import type { Context } from './effect-rule-core';
import type { HelperScopes } from './effect-promise-callables';
import type { NativeHelperFrame } from './effect-promise-program-traversal';
import { PROMISE_STATIC_METHODS } from './effect-promise-ast-values';
import type { PromiseBindingState } from './effect-promise-rule-bindings';
import type { ScopeStack } from './effect-ast-scope';
import { hasExecutedPromiseBoundary } from './effect-promise-execution-ast';
import { reportPromiseRuntimeTask } from './effect-promise-runtime-reporting';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

export { effectRecursionAST } from './effect-recursion-ast';

type VisitorMap = Record<string, (node: object) => void>;

interface PromiseRuleState extends PromiseBindingState {
  context: Context;
  fileBindings: Set<string>;
  helperScopesAt: WeakMap<object, HelperScopes>;
  indexedPrograms: WeakSet<object>;
  nativeRootFrame: NativeHelperFrame | undefined;
  programCalls: WeakSet<object>;
  runtimeTasks: PromiseRuntimeTasks | undefined;
  scopesAt: WeakMap<object, ScopeStack>;
  source: string;
  sourceCode: NativeSourceCode | undefined;
  seenSyncCalls: WeakSet<object>;
}

const emptyHelperScopes: HelperScopes = [];
const emptyScopeStack: ScopeStack = [];

const helperContainerScopes = (
  node: ASTNode,
  scopes: ScopeStack,
  inherited: HelperScopes,
): HelperScopes => {
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    return containerHelperScopes(node, scopes, inherited);
  }
  return inherited;
};

const functionChildHelperScopes = (
  node: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): HelperScopes => {
  if (isFunctionNode(node)) {
    return functionHeaderScopes(node, { helperScopes, node, scopes });
  }
  return helperScopes;
};

const visitTree = (
  node: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  visit: (node: ASTNode, scopes: ScopeStack, helperScopes: HelperScopes) => boolean,
): void => {
  visitASTWithStack({
    context: helperScopes,
    onNode(
      currentNode,
      nodeScopes,
      inheritedScopes,
      inheritedHelperScopes,
    ): {
      context: HelperScopes;
      visitChildren: boolean;
    } {
      const nodeHelperScopes = helperContainerScopes(
        currentNode,
        nodeScopes,
        inheritedHelperScopes,
      );
      if (!visit(currentNode, nodeScopes, nodeHelperScopes)) {
        return { context: nodeHelperScopes, visitChildren: false };
      }
      return {
        context: functionChildHelperScopes(currentNode, inheritedScopes, nodeHelperScopes),
        visitChildren: true,
      };
    },
    root: node,
    scopes,
  });
};

const isTypeOnlyImportDefinition = (definition: object): boolean => {
  const declaration: unknown = Reflect.get(definition, 'parent');
  const specifier: unknown = Reflect.get(definition, 'node');
  return Boolean(
    (declaration &&
      typeof declaration === 'object' &&
      Reflect.get(declaration, 'importKind') === 'type') ||
    (specifier && typeof specifier === 'object' && Reflect.get(specifier, 'importKind') === 'type'),
  );
};

const isTypeOnlyImportReference = (state: PromiseRuleState, node: ASTNode | undefined): boolean => {
  if (!node) {
    return false;
  }
  const definitions = referencesFor(state)?.get(node)?.resolved?.defs;
  return definitions?.some(isTypeOnlyImportDefinition) ?? false;
};

const isNativeGlobalReference = (state: PromiseRuleState, node: ASTNode | undefined): boolean =>
  Boolean(
    node && (state.sourceCode?.isGlobalReference?.(node) || isTypeOnlyImportReference(state, node)),
  );

const isGlobalIdentifier = (
  state: PromiseRuleState,
  name: string,
  node: ASTNode | undefined,
  scopes: ScopeStack,
): boolean => {
  if (state.sourceCode) {
    return isNativeGlobalReference(state, node);
  }
  return !isShadowed(name, scopes);
};

const isGlobalFetchCall = (state: PromiseRuleState, node: ASTNode, scopes: ScopeStack): boolean => {
  const callee = childNode(node, 'callee');
  if (node.type !== 'CallExpression') {
    return false;
  }
  if (identifierName(callee) === 'fetch') {
    return isGlobalIdentifier(state, 'fetch', callee, scopes);
  }
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  const { objectName, propertyName } = staticMemberNames(callee);
  const object = childNode(callee, 'object');
  return (
    objectName === 'globalThis' &&
    propertyName === 'fetch' &&
    isGlobalIdentifier(state, 'globalThis', object, scopes)
  );
};

const isGlobalPromiseStaticCall = (
  state: PromiseRuleState,
  node: ASTNode,
  scopes: ScopeStack,
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(node, 'callee');
  let object: ASTNode | undefined = undefined;
  if (callee) {
    object = childNode(callee, 'object');
  }
  const { objectName, propertyName } = staticMemberNames(callee);
  return Boolean(
    objectName === 'Promise' &&
    propertyName &&
    PROMISE_STATIC_METHODS.has(propertyName) &&
    isGlobalIdentifier(state, 'Promise', object, scopes),
  );
};

const isGlobalPromiseConstruction = (
  state: PromiseRuleState,
  node: ASTNode,
  scopes: ScopeStack,
): boolean => {
  const callee = childNode(node, 'callee');
  return (
    node.type === 'NewExpression' &&
    identifierName(callee) === 'Promise' &&
    isGlobalIdentifier(state, 'Promise', callee, scopes)
  );
};

const promiseBoundaryAt = (state: PromiseRuleState, node: ASTNode, scopes: ScopeStack): boolean =>
  isGlobalFetchCall(state, node, scopes) ||
  isGlobalPromiseStaticCall(state, node, scopes) ||
  isGlobalPromiseConstruction(state, node, scopes);

const hasPromiseBoundary = (
  state: PromiseRuleState,
  functionNode: ASTNode | undefined,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
): boolean => {
  const binding = callableBinding(functionNode, scopes, helperScopes);
  if (!binding) {
    return false;
  }
  return hasExecutedPromiseBoundary({
    functionNode: binding.node,
    helperScopes: binding.helperScopes,
    isBoundary: (node, nodeScopes): boolean => promiseBoundaryAt(state, node, nodeScopes),
    isNativeGlobal: (name, node, nodeScopes): boolean =>
      isGlobalIdentifier(state, name, node, nodeScopes),
    scopes: binding.scopes,
    visitorKeys: state.sourceCode?.visitorKeys,
  });
};

const addImportShadowBindings = (state: PromiseRuleState, declaration: ASTNode): void => {
  if (Reflect.get(declaration, 'importKind') === 'type') {
    return;
  }
  for (const specifier of childNodes(declaration, 'specifiers')) {
    if (Reflect.get(specifier, 'importKind') !== 'type') {
      const localName = identifierName(childNode(specifier, 'local'));
      const bindings = programBindingsFor(state);
      if (
        localName &&
        !bindings.namespaces.has(localName) &&
        !bindings.rootNamespaces.has(localName) &&
        !bindings.directFunctions.has(localName)
      ) {
        state.fileBindings.add(localName);
      }
    }
  }
};

const referencesFor = (state: PromiseRuleState): WeakMap<object, NativeReference> | undefined => {
  if (state.sourceCode) {
    return nativeReferenceIndexFor(state.sourceCode);
  }
  return undefined;
};

const reportPromiseViolation = (state: PromiseRuleState, node: ASTNode): void => {
  state.context.report({
    message: 'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.',
    node,
  });
};

const verifiedPromiseSyncCall = (
  state: PromiseRuleState,
  node: ASTNode,
  scopes: ScopeStack,
): boolean => {
  const bindings = sourceBindingsFor(state);
  return (
    couldBeEffectCall(node, 'sync', bindings) &&
    isEffectCall(node, 'sync', bindings, scopes, referencesFor(state))
  );
};

const verifiedPromiseEffectCall = (
  state: PromiseRuleState,
  node: ASTNode,
  APIName: string | undefined,
): boolean =>
  isEffectCall(node, APIName, sourceBindingsFor(state), emptyScopeStack, referencesFor(state));

const verifiedObjectAssignCall = (state: PromiseRuleState, node: ASTNode): boolean =>
  isGlobalObjectAssignCall(
    node,
    state.scopesAt.get(node) ?? [state.fileBindings],
    (object, scopes): boolean => isGlobalIdentifier(state, 'Object', object, scopes),
  );

const promiseBoundaryForSync = (
  state: PromiseRuleState,
  node: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  nativeFrame: NativeHelperFrame | undefined,
): boolean => {
  const [functionNode] = childNodes(node, 'arguments');
  if (hasPromiseBoundary(state, functionNode, scopes, helperScopes)) {
    return true;
  }
  if (!nativeFrame) {
    return false;
  }
  const exactHelperScopes = helperScopesForNativeFrame(nativeFrame);
  return (
    exactHelperScopes !== helperScopes &&
    hasPromiseBoundary(state, functionNode, scopes, exactHelperScopes)
  );
};

const reportPromiseSync = (
  state: PromiseRuleState,
  node: ASTNode,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  nativeFrame?: NativeHelperFrame,
): void => {
  if (state.seenSyncCalls.has(node)) {
    return;
  }
  if (isDeferredPromiseSync(state.runtimeTasks, node)) {
    return;
  }
  if (!verifiedPromiseSyncCall(state, node, scopes)) {
    return;
  }
  if (promiseBoundaryForSync(state, node, scopes, helperScopes, nativeFrame)) {
    state.seenSyncCalls.add(node);
    reportPromiseViolation(state, node);
  }
};

const executeIndexedRun = (state: PromiseRuleState, runCall: ASTNode): void => {
  const violations = reportPromiseRuntimeTask(
    state.runtimeTasks,
    runCall,
    (syncCall: ASTNode, site: PromiseTaskExecutionSite, helperScopes: HelperScopes): boolean =>
      verifiedPromiseSyncCall(state, syncCall, site.scopes) &&
      promiseBoundaryForSync(state, syncCall, site.scopes, helperScopes, site.frame),
  );
  for (const syncCall of violations) {
    if (!state.seenSyncCalls.has(syncCall)) {
      state.seenSyncCalls.add(syncCall);
      reportPromiseViolation(state, syncCall);
    }
  }
};

const indexFallbackImports = (state: PromiseRuleState, program: ASTNode): void => {
  for (const declaration of childNodes(program, 'body')) {
    if (declaration.type === 'ImportDeclaration') {
      addImportShadowBindings(state, declaration);
    }
  }
};

const visitNativeProgram = (
  state: PromiseRuleState,
  program: ASTNode,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): void => {
  const rootFrame = visitNativePromiseProgram({
    onCall(node, frame): void {
      recordPromiseTaskSite(state.runtimeTasks, node, {
        frame,
        helperScopes: emptyHelperScopes,
        scopes: emptyScopeStack,
      });
      executeIndexedRun(state, node);
      reportPromiseSync(state, node, emptyScopeStack, emptyHelperScopes, frame);
    },
    program,
    seenCalls: state.programCalls,
    visitorKeys,
  });
  const mutableState = state;
  mutableState.nativeRootFrame = rootFrame;
};

const visitFallbackProgram = (state: PromiseRuleState, program: ASTNode): void => {
  visitTree(program, [state.fileBindings], [], (node, scopes, helperScopes): boolean => {
    state.scopesAt.set(node, scopes);
    state.helperScopesAt.set(node, helperScopes);
    if (node.type === 'CallExpression') {
      recordPromiseTaskSite(state.runtimeTasks, node, { helperScopes, scopes });
      executeIndexedRun(state, node);
      reportPromiseSync(state, node, scopes, helperScopes);
    }
    return true;
  });
};

const indexFallbackRuntimeScopes = (state: PromiseRuleState, program: ASTNode): void => {
  if (state.sourceCode) {
    return;
  }
  indexFallbackImports(state, program);
  visitTree(program, [state.fileBindings], [], (node, scopes, helperScopes): boolean => {
    state.scopesAt.set(node, scopes);
    state.helperScopesAt.set(node, helperScopes);
    return true;
  });
};

const indexRuntimeTasks = (state: PromiseRuleState, program: ASTNode): void => {
  if (!state.source.includes('runSync')) {
    return;
  }
  const runtimeTasks = indexPromiseRuntimeTasks(
    program,
    (node): boolean => verifiedPromiseEffectCall(state, node, 'sync'),
    (node): boolean => verifiedPromiseEffectCall(state, node, 'runSync'),
    state.sourceCode?.visitorKeys,
    {
      isEffectCall: (node): boolean => verifiedPromiseEffectCall(state, node, undefined),
      isObjectAssignCall: (node): boolean => verifiedObjectAssignCall(state, node),
    },
  );
  const mutableState = state;
  mutableState.runtimeTasks = runtimeTasks;
};

const visitIndexedProgram = (state: PromiseRuleState, program: ASTNode): void => {
  const visitorKeys = state.sourceCode?.visitorKeys;
  if (visitorKeys) {
    visitNativeProgram(state, program, visitorKeys);
    return;
  }
  visitFallbackProgram(state, program);
};

const visitProgram = (state: PromiseRuleState, program: ASTNode): void => {
  if (state.indexedPrograms.has(program)) {
    return;
  }
  state.indexedPrograms.add(program);
  const bindings = programBindingsFor(state);
  indexEffectAPIBindingsFromProgram(bindings, program);
  indexFallbackRuntimeScopes(state, program);
  indexRuntimeTasks(state, program);
  visitIndexedProgram(state, program);
};

/**
 * Build Promise-returning Effect.sync boundary visitors.
 *
 * @internal
 */
export const effectSyncForPromiseAST = (context: Context, source: string): VisitorMap => {
  const state: PromiseRuleState = {
    bindings: undefined,
    context,
    fileBindings: new Set(),
    helperScopesAt: new WeakMap(),
    indexedPrograms: new WeakSet(),
    nativeRootFrame: undefined,
    programCalls: new WeakSet(),
    runtimeTasks: undefined,
    scopesAt: new WeakMap(),
    seenSyncCalls: new WeakSet(),
    source,
    sourceCode: nativeSourceCodeFor(context),
  };
  return {
    CallExpression(value): void {
      const node = asNode(value);
      if (node && !state.programCalls.has(node)) {
        reportPromiseSync(
          state,
          node,
          state.scopesAt.get(node) ?? [state.fileBindings],
          state.helperScopesAt.get(node) ?? [],
          state.nativeRootFrame,
        );
      }
    },
    Program(value): void {
      const program = asNode(value);
      if (!program) {
        return;
      }
      visitProgram(state, program);
    },
  };
};
