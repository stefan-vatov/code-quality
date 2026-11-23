import { defineRule } from '@oxlint/plugins';
import { Option } from 'effect';

import {
  arrayMethodTarget,
  constInitializer,
  isKnownArrayExpression,
  isReassigned,
  resolveArrayBinding,
  unwrapArrayExpression,
  type ArrayMethodTarget,
} from './shared/array-method';

import type { ESTree, SourceCode, Variable } from '@oxlint/plugins';

type ReducerCallback = ESTree.ArrowFunctionExpression | ESTree.Function;

interface Reducer {
  readonly accumulator: ESTree.Node;
  readonly callback: ReducerCallback;
  readonly initialValue: ESTree.Argument | undefined;
}

const arrayCopies = new Set(['concat', 'slice', 'toReversed', 'toSorted', 'toSpliced', 'with']);
const reducerMethods = new Set(['reduce', 'reduceRight']);

function callbackOwner(callback: ReducerCallback): Option.Option<ESTree.CallExpression> {
  let owner: ESTree.Node | null = callback.parent;
  while (owner !== null && unwrapArrayExpression(owner) === callback) {
    owner = owner.parent;
  }
  return owner?.type === 'CallExpression' ? Option.some(owner) : Option.none();
}

function accumulatorParameter(callback: ReducerCallback): Option.Option<ESTree.Node> {
  const [first] = callback.params;
  if (first === undefined) return Option.none();
  const binding = first.type === 'AssignmentPattern' ? first.left : first;
  return binding.type === 'Identifier' ? Option.some(binding) : Option.none();
}

function isReducerCall(call: ESTree.CallExpression, callback: ReducerCallback): boolean {
  const [firstArgument] = call.arguments;
  return (
    Option.exists(arrayMethodTarget(call.callee), (method) => reducerMethods.has(method.name)) &&
    call.arguments.length <= 2 &&
    firstArgument !== undefined &&
    unwrapArrayExpression(firstArgument) === callback
  );
}

function reducerOf(callback: ReducerCallback): Option.Option<Reducer> {
  return Option.flatMap(callbackOwner(callback), (call) =>
    isReducerCall(call, callback)
      ? Option.map(accumulatorParameter(callback), (accumulator) => ({
          accumulator,
          callback,
          initialValue: call.arguments[1],
        }))
      : Option.none(),
  );
}

function enclosingReducer(node: ESTree.Node): Option.Option<Reducer> {
  let parent: ESTree.Node | null = node.parent;
  while (parent !== null) {
    if (parent.type === 'FunctionDeclaration') return Option.none();
    if (parent.type === 'ArrowFunctionExpression' || parent.type === 'FunctionExpression') {
      return reducerOf(parent);
    }
    parent = parent.parent;
  }
  return Option.none();
}

function referencesAccumulator(
  sourceCode: SourceCode,
  node: ESTree.Node,
  accumulator: Variable,
  visited = new Set<Variable>(),
): boolean {
  return Option.match(resolveArrayBinding(sourceCode, node), {
    onNone: () => false,
    onSome: (variable) => {
      if (variable === accumulator) return true;
      if (visited.has(variable) || isReassigned(variable)) return false;
      visited.add(variable);
      return Option.exists(constInitializer(variable), (init) =>
        referencesAccumulator(sourceCode, init, accumulator, visited),
      );
    },
  });
}

function isGlobalCopyOwner(sourceCode: SourceCode, node: ESTree.Node, name: string): boolean {
  const owner = unwrapArrayExpression(node);
  if (owner.type !== 'Identifier' || owner.name !== name) return false;
  return Option.match(resolveArrayBinding(sourceCode, owner), {
    onNone: () => true,
    onSome: (variable) => variable.defs.length === 0,
  });
}

interface CopyCheck {
  readonly call: ESTree.CallExpression;
  readonly method: ArrayMethodTarget;
  readonly reducer: Reducer;
  readonly sourceCode: SourceCode;
  readonly isAccumulator: (node: ESTree.Node) => boolean;
}

function copiesWithObjectAssign({ call, isAccumulator }: CopyCheck): boolean {
  const [target, ...sources] = call.arguments;
  return (
    target !== undefined &&
    unwrapArrayExpression(target).type === 'ObjectExpression' &&
    sources.some(isAccumulator)
  );
}

function copiesWithArrayMethod({ method, reducer, sourceCode, isAccumulator }: CopyCheck): boolean {
  return (
    reducer.initialValue !== undefined &&
    isKnownArrayExpression(sourceCode, reducer.initialValue) &&
    isAccumulator(method.object)
  );
}

function copiesAccumulator(check: CopyCheck): boolean {
  const { call, method, sourceCode, isAccumulator } = check;
  if (method.name === 'assign' && isGlobalCopyOwner(sourceCode, method.object, 'Object')) {
    return copiesWithObjectAssign(check);
  }
  if (method.name === 'from' && isGlobalCopyOwner(sourceCode, method.object, 'Array')) {
    const [source] = call.arguments;
    return source !== undefined && isAccumulator(source);
  }
  return arrayCopies.has(method.name) && copiesWithArrayMethod(check);
}

function accumulatorVariable(sourceCode: SourceCode, reducer: Reducer): Option.Option<Variable> {
  return Option.fromNullable(
    sourceCode
      .getDeclaredVariables(reducer.callback)
      .find((variable) =>
        variable.identifiers.some((identifier) => identifier.start === reducer.accumulator.start),
      ),
  );
}

const isCopyMethod = (method: ArrayMethodTarget): boolean =>
  method.name === 'assign' || method.name === 'from' || arrayCopies.has(method.name);

export const noReduceAccumulatorCopyRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow copying a growing reduce accumulator with Object.assign, Array.from, or array copy methods.',
    },
    messages: {
      accumulatorCopy:
        'Do not copy the reduce accumulator on every iteration; growing copies make the reduction quadratic. Mutate a fresh, locally owned accumulator and return it, or use `flatMap`, `Array.filterMap`, or an iterator pipeline.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { sourceCode } = context;
        const method = Option.getOrNull(arrayMethodTarget(node.callee));
        if (method === null || !isCopyMethod(method)) return;
        const reducer = Option.getOrNull(enclosingReducer(node));
        if (reducer === null) return;
        const accumulator = Option.getOrNull(accumulatorVariable(sourceCode, reducer));
        if (accumulator === null) return;
        const isAccumulator = (expression: ESTree.Node): boolean =>
          referencesAccumulator(sourceCode, expression, accumulator);
        if (copiesAccumulator({ call: node, method, reducer, sourceCode, isAccumulator })) {
          context.report({ node, messageId: 'accumulatorCopy' });
        }
      },
    };
  },
});
