import { Array, pipe } from 'effect';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import { eagerEffectAPIName, recursionPhaseBindingsFor } from './effect-recursion-phases';
import {
  effectAPIBindingsFor,
  effectCallAPIName,
  indexEffectAPIBindingsFromProgram,
  isFunctionNode,
  unwrappedExpression,
} from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { Context, VisitorMap } from './effect-rule-core';
import type { EffectAPIBindings } from './effect-boundary-ast-shared';
import type { EffectResolutionBindings } from './effect-recursion-viability';
import type { RecursionPhaseBindings } from './effect-recursion-phases';
import { effectResolutionBindingsFor } from './effect-recursion-viability';
import { recursiveEffectFacts } from './effect-recursion-execution';

interface ReportInput {
  analyzedNames: WeakMap<object, Set<string>>;
  bindings: EffectAPIBindings;
  context: Context;
  functionNames: readonly (string | undefined)[];
  hasEffectCall?: boolean;
  isEagerGenerator?: boolean;
  node: ASTNode;
  phaseBindings: RecursionPhaseBindings;
  reportedFunctions: WeakSet<object>;
  resolutionBindings: EffectResolutionBindings;
}

interface RecursionVisitorState {
  analyzedNames: WeakMap<object, Set<string>>;
  bindings: EffectAPIBindings;
  context: Context;
  phaseBindings: RecursionPhaseBindings;
  reportedFunctions: WeakSet<object>;
  resolutionBindings: EffectResolutionBindings;
}

interface FunctionReportOptions {
  hasEffectCall?: boolean;
  isEagerGenerator?: boolean;
}

const shouldAnalyzeFunction = (input: ReportInput): boolean =>
  input.node.async !== true && (input.isEagerGenerator === true || input.node.generator !== true);

const reportsFunctionName = (
  input: ReportInput,
  analyzed: Set<string>,
  functionName: string | undefined,
): boolean => {
  if (!functionName || analyzed.has(functionName)) {
    return false;
  }
  analyzed.add(functionName);
  const facts = recursiveEffectFacts(
    input.node,
    functionName,
    input.phaseBindings,
    input.resolutionBindings,
    input.hasEffectCall,
    input.isEagerGenerator,
  );
  return facts.hasEffectCall && facts.hasUnsuspendedSelfCall;
};

const reportRecursiveFunction = (input: ReportInput): void => {
  const { analyzedNames, context, functionNames, node, reportedFunctions } = input;
  if (!shouldAnalyzeFunction(input) || reportedFunctions.has(node)) {
    return;
  }
  const analyzed = analyzedNames.get(node) ?? new Set<string>();
  analyzedNames.set(node, analyzed);
  const shouldReport = pipe(
    functionNames,
    Array.some((functionName): boolean => reportsFunctionName(input, analyzed, functionName)),
  );
  if (shouldReport) {
    reportedFunctions.add(node);
    context.report({
      message: 'Recursive Effect construction must be wrapped in Effect.suspend.',
      node,
    });
  }
};

const suspendThunk = (
  node: ASTNode,
  bindings: EffectAPIBindings,
): { functionName: string; thunk: ASTNode } | undefined => {
  if (effectCallAPIName(node, bindings, []) !== 'suspend') {
    return undefined;
  }
  const thunk = unwrappedExpression(childNodes(node, 'arguments')[0]);
  if (thunk?.type !== 'FunctionExpression') {
    return undefined;
  }
  const functionName = identifierName(childNode(thunk, 'id'));
  if (functionName) {
    return { functionName, thunk };
  }
  return undefined;
};

const eagerGenerator = (
  node: ASTNode | undefined,
  bindings: RecursionPhaseBindings,
): ASTNode | undefined => {
  const call = unwrappedExpression(node);
  if (!call || eagerEffectAPIName(call, bindings, []) !== 'fnUntracedEager') {
    return undefined;
  }
  const generator = unwrappedExpression(childNodes(call, 'arguments')[0]);
  if (isFunctionNode(generator) && generator.generator === true) {
    return generator;
  }
  return undefined;
};

const reportFunction = (
  state: RecursionVisitorState,
  node: ASTNode,
  functionNames: readonly (string | undefined)[],
  options?: FunctionReportOptions,
): void => {
  reportRecursiveFunction({
    ...state,
    functionNames,
    hasEffectCall: options?.hasEffectCall,
    isEagerGenerator: options?.isEagerGenerator,
    node,
  });
};

const visitCall = (state: RecursionVisitorState, value: ASTNode): void => {
  const call = asNode(value);
  if (!call) {
    return;
  }
  const namedThunk = suspendThunk(call, state.bindings);
  if (namedThunk) {
    reportFunction(state, namedThunk.thunk, [namedThunk.functionName], {
      hasEffectCall: true,
    });
  }
};

const visitNamedFunction = (state: RecursionVisitorState, value: ASTNode): void => {
  const node = asNode(value);
  if (node) {
    reportFunction(state, node, [identifierName(childNode(node, 'id'))]);
  }
};

const visitProgram = (state: RecursionVisitorState, value: ASTNode): void => {
  const program = asNode(value);
  if (program) {
    indexEffectAPIBindingsFromProgram(state.bindings, program);
  }
};

const visitVariableDeclarator = (state: RecursionVisitorState, value: ASTNode): void => {
  const declarator = asNode(value);
  if (!declarator) {
    return;
  }
  const initializer = childNode(declarator, 'init');
  const eagerImplementation = eagerGenerator(initializer, state.phaseBindings);
  if (eagerImplementation) {
    reportFunction(state, eagerImplementation, [identifierName(childNode(declarator, 'id'))], {
      hasEffectCall: true,
      isEagerGenerator: true,
    });
    return;
  }
  if (isFunctionNode(initializer)) {
    reportFunction(state, initializer, [
      identifierName(childNode(initializer, 'id')),
      identifierName(childNode(declarator, 'id')),
    ]);
  }
};

const recursionVisitors = (state: RecursionVisitorState): VisitorMap => ({
  CallExpression(value): void {
    visitCall(state, value);
  },
  FunctionDeclaration(value): void {
    visitNamedFunction(state, value);
  },
  FunctionExpression(value): void {
    visitNamedFunction(state, value);
  },
  Program(value): void {
    visitProgram(state, value);
  },
  VariableDeclarator(value): void {
    visitVariableDeclarator(state, value);
  },
});

export const effectRecursionAST = (context: Context, source: string): VisitorMap => {
  const bindings = effectAPIBindingsFor(source);
  const phaseBindings = recursionPhaseBindingsFor(source, bindings);
  const resolutionBindings = effectResolutionBindingsFor(source, phaseBindings);
  return recursionVisitors({
    analyzedNames: new WeakMap(),
    bindings,
    context,
    phaseBindings,
    reportedFunctions: new WeakSet(),
    resolutionBindings,
  });
};
