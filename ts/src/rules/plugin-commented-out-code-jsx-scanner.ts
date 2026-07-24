/* -------------------------------------------------------------------------- */
/*     Iterative JSX recognition for the fallback source comment scanner.     */
/* -------------------------------------------------------------------------- */
import type {
  CommentConsumer,
  ScannedComment,
} from './plugin-commented-out-code-lexical-primitives';
import {
  DOUBLE_QUOTE,
  GREATER_THAN,
  LESS_THAN,
  OPEN_BRACE,
  SINGLE_QUOTE,
  SLASH,
  indexAfterQuotedString,
  isIdentifierPart,
  isTrivia,
} from './plugin-commented-out-code-lexical-primitives';

/**
 * Carries one source scan's consumer and failed-JSX memo through embedded expressions.
 */
export interface SourceScanContext {
  consumeComment: CommentConsumer;
  failedJSXStarts: Set<number>;
  source: string;
}

type EmbeddedJavaScriptScanner = (
  context: SourceScanContext,
  start: number,
  consumeComment: CommentConsumer,
) => number;

interface JSXOpening {
  contentStart: number;
  name: string;
  selfClosing: boolean;
}

interface JSXClosing {
  end: number;
  name: string;
}

interface JSXScanState {
  comments: ScannedComment[];
  elementNames: string[];
  elementStarts: number[];
  initialIndex: number;
  speculativeContext: SourceScanContext;
}

type JSXInitialization = { end: number; state?: never } | { end?: never; state: JSXScanState };

const COLON = 58;
const DOT = 46;
const HYPHEN = 45;
const JSX_FAILED = -1;

const jsxNameEnd = (source: string, start: number): number => {
  let index = start;
  const sourceLength = source.length;
  while (index < sourceLength) {
    const code = source.charCodeAt(index);
    if (!isIdentifierPart(code) && code !== HYPHEN && code !== DOT && code !== COLON) {
      return index;
    }
    index += 1;
  }
  return index;
};

const indexAfterOpeningTag = (
  context: SourceScanContext,
  start: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): number | undefined => {
  let index = start;
  while (index < context.source.length) {
    const code = context.source.charCodeAt(index);
    if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
      index = indexAfterQuotedString(context.source, index, code);
    } else if (code === OPEN_BRACE) {
      index = scanEmbedded(context, index + 1, context.consumeComment);
    } else if (code === LESS_THAN) {
      return undefined;
    } else if (code === GREATER_THAN) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return undefined;
};

const isSelfClosing = (source: string, nameEnd: number, contentStart: number): boolean => {
  let trailingIndex = contentStart - 2;
  while (trailingIndex >= nameEnd && isTrivia(source.charCodeAt(trailingIndex))) {
    trailingIndex -= 1;
  }
  return source.charCodeAt(trailingIndex) === SLASH;
};

const openingAt = (
  context: SourceScanContext,
  start: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): JSXOpening | undefined => {
  const nameStart = start + 1;
  if (context.source.charCodeAt(nameStart) === GREATER_THAN) {
    return { contentStart: nameStart + 1, name: '', selfClosing: false };
  }
  const nameEnd = jsxNameEnd(context.source, nameStart);
  if (nameEnd === nameStart) {
    return undefined;
  }
  const contentStart = indexAfterOpeningTag(context, nameEnd, scanEmbedded);
  if (contentStart === undefined) {
    return undefined;
  }
  return {
    contentStart,
    name: context.source.slice(nameStart, nameEnd),
    selfClosing: isSelfClosing(context.source, nameEnd, contentStart),
  };
};

const indexAfterTrivia = (source: string, start: number): number => {
  let index = start;
  while (isTrivia(source.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

const closingAt = (source: string, start: number): JSXClosing | undefined => {
  if (source.charCodeAt(start + 1) !== SLASH) {
    return undefined;
  }
  const nameStart = start + 2;
  const nameEnd = jsxNameEnd(source, nameStart);
  if (nameEnd === nameStart && source.charCodeAt(nameStart) !== GREATER_THAN) {
    return undefined;
  }
  const index = indexAfterTrivia(source, nameEnd);
  if (source.charCodeAt(index) !== GREATER_THAN) {
    return undefined;
  }
  return { end: index + 1, name: source.slice(nameStart, nameEnd) };
};

const emitComments = (
  comments: readonly ScannedComment[],
  consumeComment: CommentConsumer,
): void => {
  for (const comment of comments) {
    consumeComment(comment);
  }
};

const recordFailures = (context: SourceScanContext, starts: readonly number[]): void => {
  for (const failedStart of starts) {
    context.failedJSXStarts.add(failedStart);
  }
};

const initializeJSXScan = (
  context: SourceScanContext,
  start: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): JSXInitialization | undefined => {
  const comments: ScannedComment[] = [];
  const speculativeContext = {
    ...context,
    consumeComment: (comment: ScannedComment): void => {
      comments.push(comment);
    },
  };
  const opening = openingAt(speculativeContext, start, scanEmbedded);
  if (opening === undefined) {
    return undefined;
  }
  if (opening.selfClosing) {
    emitComments(comments, context.consumeComment);
    return { end: opening.contentStart };
  }
  return {
    state: {
      comments,
      elementNames: [opening.name],
      elementStarts: [start],
      initialIndex: opening.contentStart,
      speculativeContext,
    },
  };
};

const closeElement = (
  context: SourceScanContext,
  state: JSXScanState,
  closing: JSXClosing,
): number => {
  if (closing.name !== state.elementNames.at(-1)) {
    recordFailures(context, state.elementStarts);
    return JSX_FAILED;
  }
  state.elementNames.pop();
  state.elementStarts.pop();
  if (state.elementNames.length !== 0) {
    return closing.end;
  }
  emitComments(state.comments, context.consumeComment);
  return ~closing.end;
};

const openNestedElement = (
  context: SourceScanContext,
  state: JSXScanState,
  index: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): number => {
  let nestedOpening: JSXOpening | undefined = undefined;
  if (!context.failedJSXStarts.has(index)) {
    nestedOpening = openingAt(state.speculativeContext, index, scanEmbedded);
  }
  if (nestedOpening === undefined) {
    context.failedJSXStarts.add(index);
    return index + 1;
  }
  if (!nestedOpening.selfClosing) {
    state.elementNames.push(nestedOpening.name);
    state.elementStarts.push(index);
  }
  return nestedOpening.contentStart;
};

const advanceJSXScan = (
  context: SourceScanContext,
  state: JSXScanState,
  index: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): number => {
  const { source } = context;
  const code = source.charCodeAt(index);
  if (code === OPEN_BRACE) {
    return scanEmbedded(
      state.speculativeContext,
      index + 1,
      state.speculativeContext.consumeComment,
    );
  }
  if (code !== LESS_THAN) {
    return index + 1;
  }
  const closing = closingAt(source, index);
  if (closing !== undefined) {
    return closeElement(context, state, closing);
  }
  return openNestedElement(context, state, index, scanEmbedded);
};

const scanInitializedJSX = (
  context: SourceScanContext,
  state: JSXScanState,
  scanEmbedded: EmbeddedJavaScriptScanner,
): number | undefined => {
  let index = state.initialIndex;
  while (index < context.source.length) {
    const nextIndex = advanceJSXScan(context, state, index, scanEmbedded);
    if (nextIndex === JSX_FAILED) {
      return undefined;
    }
    if (nextIndex < JSX_FAILED) {
      return ~nextIndex;
    }
    index = nextIndex;
  }
  recordFailures(context, state.elementStarts);
  return undefined;
};

/**
 * Finds a structurally complete JSX element without recursively rescanning failed candidates.
 *
 * @param context - Shared source, comment consumer, and failed-start memo for the current scan.
 * @param start - Offset of the candidate opening angle bracket.
 * @param scanEmbedded - JavaScript scanner used for JSX expression containers.
 * @returns The first offset after a complete element, or `undefined` when the candidate is not JSX.
 */
export const indexAfterJSXElement = (
  context: SourceScanContext,
  start: number,
  scanEmbedded: EmbeddedJavaScriptScanner,
): number | undefined => {
  const initialized = initializeJSXScan(context, start, scanEmbedded);
  if (initialized === undefined) {
    return undefined;
  }
  if (initialized.state === undefined) {
    return initialized.end;
  }
  return scanInitializedJSX(context, initialized.state, scanEmbedded);
};
