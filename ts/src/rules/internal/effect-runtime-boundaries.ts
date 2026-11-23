import { childNode, childNodes, identifierName, isASTArray, isASTNode } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { effectMatching } from './effect-canonical-patterns';
import type { Matches } from './effect-canonical-patterns';
import type { Context, RuleSpec, VisitorMap } from './effect-rule-core';
import { isTestOrToolingFile } from './shared/test-paths';

interface Frame {
  readonly inEffect: boolean;
  readonly node: ASTNode;
  readonly isCallee?: boolean;
  readonly objectInEffect?: boolean;
}

const runMethods = [
  'runCallback',
  'runFork',
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
] as const;

const curriedGeneratorRunners = ['fn', 'fnUntraced'] as const;

const functionTypes = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

const ignoredKeys = new Set(['parent', 'loc', 'range', 'start', 'end']);

const runInsideEffectMessage =
  'Do not run an Effect inside Effect code: Effect.runSync, runPromise, and runFork start a separate root fiber that loses the surrounding services, interruption, and typed failure. Compose instead: `yield* effect` in generators, `Effect.exit(effect)` for an Exit, or `Effect.forkDaemon`/`Effect.forkScoped` for background work.';

const childrenOf = (node: ASTNode): ASTNode[] => {
  const children: ASTNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (ignoredKeys.has(key)) continue;
    if (isASTNode(value)) children.push(value);
    else if (isASTArray(value)) {
      for (const item of value) if (isASTNode(item)) children.push(item);
    }
  }
  return children;
};

const memberName = (node: ASTNode | undefined): string | undefined =>
  node?.type === 'MemberExpression' && node.computed !== true
    ? identifierName(childNode(node, 'property'))
    : undefined;

const isEffectMember = (node: ASTNode | undefined, matches: Matches): boolean => {
  const name = memberName(node);
  return name !== undefined && matches(node, 'Effect', name);
};

const isCurriedGeneratorRunner = (node: ASTNode | undefined, matches: Matches): boolean =>
  node?.type === 'CallExpression' &&
  curriedGeneratorRunners.some((name) => matches(childNode(node, 'callee'), 'Effect', name));

const isEffectApiCall = (call: ASTNode, matches: Matches): boolean => {
  const callee = childNode(call, 'callee');
  return isEffectMember(callee, matches) || isCurriedGeneratorRunner(callee, matches);
};

const isRunCall = (node: ASTNode, matches: Matches): boolean => {
  if (node.type !== 'CallExpression') return false;
  const callee = childNode(node, 'callee');
  const name = memberName(callee);
  return runMethods.some((method) => method === name) && isEffectMember(callee, matches);
};

const isFunction = (node: ASTNode): boolean => functionTypes.has(node.type);

const callChildFrames = (call: ASTNode, inEffect: boolean, matches: Matches): Frame[] => {
  const argumentInEffect = isEffectApiCall(call, matches);
  const argumentsList = new Set(childNodes(call, 'arguments'));
  const callee = childNode(call, 'callee');
  return childrenOf(call).map((child) => {
    if (child === callee) return { inEffect, isCallee: true, node: child };
    if (!argumentsList.has(child)) return { inEffect, node: child };
    if (isFunction(child)) return { inEffect: argumentInEffect, node: child };
    return child.type === 'ObjectExpression'
      ? { inEffect, node: child, objectInEffect: argumentInEffect }
      : { inEffect, node: child };
  });
};

const objectChildFrames = (frame: Frame): Frame[] =>
  childrenOf(frame.node).map((child) => ({
    inEffect: frame.inEffect,
    node: child,
    objectInEffect: frame.objectInEffect ?? false,
  }));

const propertyChildFrames = (frame: Frame): Frame[] => {
  const value = childNode(frame.node, 'value');
  return childrenOf(frame.node).map((child) => {
    if (child !== value) return { inEffect: frame.inEffect, node: child };
    if (isFunction(child)) return { inEffect: frame.objectInEffect ?? false, node: child };
    return { inEffect: frame.inEffect, node: child, objectInEffect: frame.objectInEffect ?? false };
  });
};

const childFrames = (frame: Frame, matches: Matches): Frame[] => {
  const { node, inEffect } = frame;
  if (node.type === 'CallExpression') return callChildFrames(node, inEffect, matches);
  if (node.type === 'ObjectExpression') return objectChildFrames(frame);
  if (node.type === 'Property') return propertyChildFrames(frame);
  if (node.type === 'ParenthesizedExpression' && frame.isCallee === true) {
    return childrenOf(node).map((child) => ({ inEffect, isCallee: true, node: child }));
  }
  if (isFunction(node) && frame.isCallee === true) {
    return childrenOf(node).map((child) => ({ inEffect, node: child }));
  }
  return childrenOf(node).map((child) => ({
    inEffect: isFunction(child) ? false : inEffect,
    node: child,
  }));
};

const runInsideEffectVisitors = (context: Context): VisitorMap => {
  const { begin, matches } = effectMatching(context);
  return {
    Program(program): void {
      begin(program);
      const pending: Frame[] = [{ inEffect: false, node: program }];
      while (pending.length > 0) {
        const frame = pending.pop();
        if (frame === undefined) break;
        if (frame.inEffect && isRunCall(frame.node, matches)) {
          context.report({ node: frame.node, message: runInsideEffectMessage });
        }
        pending.push(...childFrames(frame, matches));
      }
    },
  };
};

export const effectNoRunInsideEffectSpec: RuleSpec = {
  name: 'effect-no-run-inside-effect',
  message: runInsideEffectMessage,
  tokens: [...runMethods],
  ast: runInsideEffectVisitors,
};

const throwingGlobalFunctions = ['decodeURI', 'decodeURIComponent'] as const;

const throwingParseMessage =
  'JSON.parse, decodeURI, and decodeURIComponent throw on malformed input. Inside Effect.sync the throw becomes an untyped defect, and as an eager Effect.succeed argument it escapes Effect entirely. Use `Effect.try({ try: () => JSON.parse(text), catch: (cause) => new ParseError({ cause }) })` or `Schema.parseJson` so the failure is typed.';

const isGlobalCall = (node: ASTNode, matches: Matches): boolean => {
  const callee = childNode(node, 'callee');
  if (callee?.type === 'MemberExpression') {
    const object = childNode(callee, 'object');
    return (
      memberName(callee) === 'parse' &&
      identifierName(object) === 'JSON' &&
      matches(object, 'global', 'JSON')
    );
  }
  const name = identifierName(callee);
  return (
    throwingGlobalFunctions.some((candidate) => candidate === name) &&
    name !== undefined &&
    matches(callee, 'global', name)
  );
};

const throwingCallsIn = (root: ASTNode, matches: Matches): ASTNode[] => {
  const found: ASTNode[] = [];
  const pending = [...childrenOf(root)];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (isFunction(node)) continue;
    if (node.type === 'CallExpression' && isGlobalCall(node, matches)) found.push(node);
    const guarded = node.type === 'TryStatement' ? childNode(node, 'block') : undefined;
    pending.push(...childrenOf(node).filter((child) => child !== guarded));
  }
  return found;
};

const eagerParseScope = (call: ASTNode, matches: Matches): ASTNode | undefined => {
  const callee = childNode(call, 'callee');
  const name = memberName(callee);
  const [first] = childNodes(call, 'arguments');
  if (first === undefined || !isEffectMember(callee, matches)) return undefined;
  if (name === 'sync') return isFunction(first) ? first : undefined;
  return name === 'succeed' && !isFunction(first) ? first : undefined;
};

const throwingParseVisitors = (context: Context): VisitorMap => {
  const { begin, matches } = effectMatching(context);
  const skip = isTestOrToolingFile(context.filename);
  return {
    Program(program): void {
      begin(program);
    },
    CallExpression(node): void {
      if (skip) return;
      const scope = eagerParseScope(node, matches);
      if (scope === undefined) return;
      const targets =
        scope.type === 'CallExpression' && isGlobalCall(scope, matches) ? [scope] : [];
      for (const target of [...targets, ...throwingCallsIn(scope, matches)]) {
        context.report({ node: target, message: throwingParseMessage });
      }
    },
  };
};

export const effectNoThrowingParseInSyncSpec: RuleSpec = {
  name: 'effect-no-throwing-parse-in-sync',
  message: throwingParseMessage,
  tokens: ['JSON.parse', 'decodeURI'],
  ast: throwingParseVisitors,
};
