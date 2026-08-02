/* -------------------------------------------------------------------------- */
/*       AST detection for synchronous Effect server-request handlers.        */
/* -------------------------------------------------------------------------- */
import { asNode, childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { Context } from './effect-rule-core';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';

const HANDLER_NAMES = new Set(['action', 'handler', 'loader', 'route']);
const MESSAGE = 'Server handlers must not synchronously run Effects.';

interface SourceRange {
  end: number;
  start: number;
}

interface HandlerRangeIndex {
  maxEnd: number;
  nextRangeIndex: number;
  readonly pending: RangeStartHeap;
  readonly ranges: SourceRange[];
}

class RangeStartHeap {
  readonly values: SourceRange[] = [];

  peek(): SourceRange | undefined {
    return this.values[0];
  }

  pop(): SourceRange | undefined {
    const { values } = this;
    const [first] = values;
    const last = values.pop();
    if (last === undefined || values.length === 0) {
      return first;
    }

    this.siftDown(last);
    return first;
  }

  push(value: SourceRange): void {
    const { values } = this;
    let index = values.push(value) - 1;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = values[parentIndex];
      if (!parent || parent.start <= value.start) {
        break;
      }
      values[index] = parent;
      index = parentIndex;
    }
    values[index] = value;
  }

  siftDown(last: SourceRange): void {
    const { values } = this;
    let childIndex = 0;
    while (true) {
      const child = this.nextChild(childIndex);
      if (!child || child.value.start >= last.start) {
        values[childIndex] = last;
        return;
      }
      const { index: nextIndex, value } = child;
      values[childIndex] = value;
      childIndex = nextIndex;
    }
  }

  nextChild(index: number): { index: number; value: SourceRange } | undefined {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= this.values.length) {
      return undefined;
    }
    const left = this.values[leftIndex];
    const right = this.values[leftIndex + 1];
    if (right && left && right.start < left.start) {
      return { index: leftIndex + 1, value: right };
    }
    if (!left) {
      return undefined;
    }
    return { index: leftIndex, value: left };
  }
}

const numericProperty = (node: ASTNode, key: string): number | undefined => {
  const value: unknown = Reflect.get(node, key);
  if (typeof value === 'number') {
    return value;
  }
  return undefined;
};

const nodeRange = (node: ASTNode | undefined): SourceRange | undefined => {
  if (!node) {
    return undefined;
  }
  const start = numericProperty(node, 'start');
  const end = numericProperty(node, 'end');
  if (
    start === undefined ||
    end === undefined ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start
  ) {
    return undefined;
  }
  return { end, start };
};

const memberPropertyName = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'MemberExpression' || Reflect.get(node, 'computed') === true) {
    return undefined;
  }
  return identifierName(childNode(node, 'property'));
};

const literalStringValue = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
};

const handlerName = (node: ASTNode | undefined): string | undefined =>
  identifierName(node) ?? literalStringValue(node) ?? memberPropertyName(node);

const isHandlerName = (node: ASTNode | undefined): boolean => {
  const name = handlerName(node);
  return name !== undefined && HANDLER_NAMES.has(name);
};

const isUncomputedHandlerKey = (node: ASTNode): boolean =>
  Reflect.get(node, 'computed') !== true && isHandlerName(childNode(node, 'key'));

const queueHandlerRanges = (index: HandlerRangeIndex): void => {
  const handlerIndex = index;
  while (handlerIndex.nextRangeIndex < handlerIndex.ranges.length) {
    const range = handlerIndex.ranges[handlerIndex.nextRangeIndex];
    if (range) {
      handlerIndex.pending.push(range);
    }
    handlerIndex.nextRangeIndex += 1;
  }
};

const activatePendingHandlerRanges = (index: HandlerRangeIndex, targetStart: number): void => {
  const handlerIndex = index;
  while (true) {
    const next = handlerIndex.pending.peek();
    if (!next || next.start > targetStart) {
      return;
    }
    const range = handlerIndex.pending.pop();
    if (range && range.end > handlerIndex.maxEnd) {
      handlerIndex.maxEnd = range.end;
    }
  }
};

const activateHandlerRanges = (index: HandlerRangeIndex, targetStart: number): void => {
  queueHandlerRanges(index);
  activatePendingHandlerRanges(index, targetStart);
};

const isInsideHandlerRange = (node: ASTNode, index: HandlerRangeIndex): boolean => {
  const range = nodeRange(node);
  if (!range) {
    return false;
  }
  activateHandlerRanges(index, range.start);
  return range.end <= index.maxEnd;
};

/**
 * Build native AST visitors for synchronous Effect execution inside server handlers.
 *
 * @param context - Active rule context.
 * @returns AST visitors that report the first matching call.
 * @throws Does not throw.
 * @internal
 */
export const runSyncServerHandlerAST = (
  context: Context,
): Record<string, (node: object) => void> => {
  const runSync = importedEffectCallMatcher(context, 'Effect', ['runSync']);
  const handlerRanges: HandlerRangeIndex = {
    maxEnd: -1,
    nextRangeIndex: 0,
    pending: new RangeStartHeap(),
    ranges: [],
  };
  let hasReported = false;

  const addHandlerRange = (value: ASTNode | undefined): void => {
    const range = nodeRange(value);
    if (range) {
      handlerRanges.ranges.push(range);
    }
  };

  return {
    AssignmentExpression(value): void {
      const node = asNode(value);
      if (node && isHandlerName(childNode(node, 'left'))) {
        addHandlerRange(childNode(node, 'right'));
      }
    },
    CallExpression(value): void {
      const node = asNode(value);
      if (
        !hasReported &&
        node &&
        isInsideHandlerRange(node, handlerRanges) &&
        runSync.matches(childNode(node, 'callee'))
      ) {
        hasReported = true;
        context.report({ message: MESSAGE, node });
      }
    },
    FunctionDeclaration(value): void {
      const node = asNode(value);
      if (node && isHandlerName(childNode(node, 'id'))) {
        addHandlerRange(childNode(node, 'body'));
      }
    },
    FunctionExpression(value): void {
      const node = asNode(value);
      if (node && isHandlerName(childNode(node, 'id'))) {
        addHandlerRange(childNode(node, 'body'));
      }
    },
    MethodDefinition(value): void {
      const node = asNode(value);
      if (node && isUncomputedHandlerKey(node)) {
        addHandlerRange(childNode(node, 'value'));
      }
    },
    Program: runSync.initialize,
    Property(value): void {
      const node = asNode(value);
      if (node && isUncomputedHandlerKey(node)) {
        addHandlerRange(childNode(node, 'value'));
      }
    },
    PropertyDefinition(value): void {
      const node = asNode(value);
      if (node && isUncomputedHandlerKey(node)) {
        addHandlerRange(childNode(node, 'value'));
      }
    },
    VariableDeclarator(value): void {
      const node = asNode(value);
      if (node && isHandlerName(childNode(node, 'id'))) {
        addHandlerRange(childNode(node, 'init'));
      }
    },
  };
};
