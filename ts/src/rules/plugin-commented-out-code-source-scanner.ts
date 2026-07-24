/* -------------------------------------------------------------------------- */
/*   Lexically scans fallback TypeScript source for genuine comment tokens.   */
/* -------------------------------------------------------------------------- */
import {
  BACKSLASH,
  BACKTICK,
  CLOSE_BRACE,
  CLOSE_BRACKET,
  CLOSE_PARENTHESIS,
  DOLLAR,
  DOUBLE_QUOTE,
  EQUALS,
  GREATER_THAN,
  LESS_THAN,
  MINUS,
  OPEN_BRACE,
  OPEN_PARENTHESIS,
  PLUS,
  SEMICOLON,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  indexAfterHashbang,
  indexAfterIdentifier,
  indexAfterQuotedString,
  indexAfterREGEX,
  isIdentifierStart,
  isListedWord,
  isTrivia,
  scanBlockComment,
  scanLineComment,
} from './plugin-commented-out-code-lexical-primitives';
import { CHAR_CLASS, CLS_DIGIT } from './char-class';
import type { CommentConsumer } from './plugin-commented-out-code-lexical-primitives';
import type { SourceScanContext } from './plugin-commented-out-code-jsx-scanner';
import { indexAfterJSXElement } from './plugin-commented-out-code-jsx-scanner';

export {
  indexAfterLineEnding,
  isECMAScriptLineEnding,
} from './plugin-commented-out-code-lexical-primitives';
export type { ScannedComment } from './plugin-commented-out-code-lexical-primitives';

interface JavaScriptStep {
  isBlockAllowed: boolean;
  isREGEXAllowed: boolean;
  index: number;
  isControlPending: boolean;
}

interface DelimiterStacks {
  braceBlocks: boolean[];
  controlParentheses: boolean[];
}

const REGEX_PREFIX_KEYWORDS =
  'do in of new case else void await throw yield delete return typeof instanceof'.split(' ');
const CONTROL_PAREN_KEYWORDS = ['catch', 'for', 'if', 'switch', 'while', 'with'];
const BLOCK_PREFIX_KEYWORDS = ['do', 'else', 'finally', 'try'];

const indexAfterTemplate = (source: string, start: number, context: SourceScanContext): number => {
  let index = start + 1;
  const sourceLength = source.length;
  while (index < sourceLength) {
    const code = source.charCodeAt(index);
    if (code === BACKSLASH) {
      index += 2;
    } else if (code === BACKTICK) {
      return index + 1;
    } else if (code === DOLLAR && source.charCodeAt(index + 1) === OPEN_BRACE) {
      index = scanJavaScript(context, index + 2, true);
    } else {
      index += 1;
    }
  }
  return sourceLength;
};

const scanEmbeddedJavaScript = (
  context: SourceScanContext,
  start: number,
  consumeComment: CommentConsumer,
): number => scanJavaScript({ ...context, consumeComment }, start, true);

const expressionStep = (
  source: string,
  index: number,
  code: number,
  isREGEXAllowed: boolean,
  context: SourceScanContext,
): JavaScriptStep | undefined => {
  if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
    return {
      index: indexAfterQuotedString(source, index, code),
      isBlockAllowed: false,
      isControlPending: false,
      isREGEXAllowed: false,
    };
  }
  if (code === BACKTICK) {
    return {
      index: indexAfterTemplate(source, index, context),
      isBlockAllowed: false,
      isControlPending: false,
      isREGEXAllowed: false,
    };
  }
  if (code === LESS_THAN && isREGEXAllowed && !context.failedJSXStarts.has(index)) {
    const nextIndex = indexAfterJSXElement(context, index, scanEmbeddedJavaScript);
    if (nextIndex !== undefined) {
      return {
        index: nextIndex,
        isBlockAllowed: false,
        isControlPending: false,
        isREGEXAllowed: false,
      };
    }
    context.failedJSXStarts.add(index);
  }
  return undefined;
};

const slashStep = (
  source: string,
  step: JavaScriptStep,
  consumeComment: CommentConsumer,
): JavaScriptStep => {
  const nextCode = source.charCodeAt(step.index + 1);
  if (nextCode === SLASH) {
    return {
      ...step,
      index: scanLineComment(source, step.index, consumeComment),
    };
  }
  if (nextCode === STAR) {
    return {
      ...step,
      index: scanBlockComment(source, step.index, consumeComment),
    };
  }
  if (step.isREGEXAllowed) {
    const nextIndex = indexAfterREGEX(source, step.index);
    return {
      index: nextIndex,
      isBlockAllowed: false,
      isControlPending: false,
      isREGEXAllowed: nextIndex === step.index + 1,
    };
  }
  return {
    index: step.index + 1,
    isBlockAllowed: false,
    isControlPending: false,
    isREGEXAllowed: true,
  };
};

const identifierStep = (source: string, index: number): JavaScriptStep => {
  const nextIndex = indexAfterIdentifier(source, index);
  return {
    index: nextIndex,
    isBlockAllowed: isListedWord(source, index, nextIndex, BLOCK_PREFIX_KEYWORDS),
    isControlPending: isListedWord(source, index, nextIndex, CONTROL_PAREN_KEYWORDS),
    isREGEXAllowed: isListedWord(source, index, nextIndex, REGEX_PREFIX_KEYWORDS),
  };
};

const openBraceStep = (step: JavaScriptStep, stacks: DelimiterStacks): JavaScriptStep => {
  stacks.braceBlocks.push(step.isBlockAllowed);
  return {
    index: step.index + 1,
    isBlockAllowed: true,
    isControlPending: false,
    isREGEXAllowed: true,
  };
};

const closeBraceStep = (step: JavaScriptStep, stacks: DelimiterStacks): JavaScriptStep => {
  const wasBlock = stacks.braceBlocks.pop() ?? true;
  return {
    index: step.index + 1,
    isBlockAllowed: wasBlock,
    isControlPending: false,
    isREGEXAllowed: wasBlock,
  };
};

const openParenthesisStep = (step: JavaScriptStep, stacks: DelimiterStacks): JavaScriptStep => {
  stacks.controlParentheses.push(step.isControlPending);
  return {
    index: step.index + 1,
    isBlockAllowed: false,
    isControlPending: false,
    isREGEXAllowed: true,
  };
};

const closeParenthesisStep = (step: JavaScriptStep, stacks: DelimiterStacks): JavaScriptStep => {
  const wasControl = stacks.controlParentheses.pop() ?? false;
  return {
    index: step.index + 1,
    isBlockAllowed: true,
    isControlPending: false,
    isREGEXAllowed: wasControl,
  };
};

const defaultPunctuationStep = (
  source: string,
  step: JavaScriptStep,
  code: number,
): JavaScriptStep => {
  const closesExpression = code === CLOSE_BRACKET || (CHAR_CLASS[code] & CLS_DIGIT) !== 0;
  return {
    index: step.index + 1,
    isBlockAllowed:
      code === SEMICOLON || (code === GREATER_THAN && source.charCodeAt(step.index - 1) === EQUALS),
    isControlPending: false,
    isREGEXAllowed: !closesExpression,
  };
};

const doubleOperatorStep = (step: JavaScriptStep): JavaScriptStep => ({
  index: step.index + 2,
  isBlockAllowed: false,
  isControlPending: false,
  isREGEXAllowed: false,
});

const delimiterStep = (
  step: JavaScriptStep,
  code: number,
  stacks: DelimiterStacks,
): JavaScriptStep | undefined => {
  if (code === OPEN_BRACE) {
    return openBraceStep(step, stacks);
  }
  if (code === CLOSE_BRACE) {
    return closeBraceStep(step, stacks);
  }
  if (code === OPEN_PARENTHESIS) {
    return openParenthesisStep(step, stacks);
  }
  if (code === CLOSE_PARENTHESIS) {
    return closeParenthesisStep(step, stacks);
  }
  return undefined;
};

const punctuationStep = (
  source: string,
  step: JavaScriptStep,
  code: number,
  stacks: DelimiterStacks,
): JavaScriptStep => {
  const delimiter = delimiterStep(step, code, stacks);
  if (delimiter !== undefined) {
    return delimiter;
  }
  if ((code === PLUS || code === MINUS) && source.charCodeAt(step.index + 1) === code) {
    return doubleOperatorStep(step);
  }
  return defaultPunctuationStep(source, step, code);
};

const nextBraceDepth = (code: number, currentDepth: number): number => {
  if (code === OPEN_BRACE) {
    return currentDepth + 1;
  }
  if (code === CLOSE_BRACE) {
    return currentDepth - 1;
  }
  return currentDepth;
};

const nextJavaScriptStep = (
  source: string,
  step: JavaScriptStep,
  code: number,
  stacks: DelimiterStacks,
  context: SourceScanContext,
): JavaScriptStep => {
  const expression = expressionStep(source, step.index, code, step.isREGEXAllowed, context);
  if (expression !== undefined) {
    return expression;
  }
  if (isTrivia(code)) {
    return { ...step, index: step.index + 1 };
  }
  if (code === SLASH) {
    return slashStep(source, step, context.consumeComment);
  }
  if (isIdentifierStart(code)) {
    return identifierStep(source, step.index);
  }
  return punctuationStep(source, step, code, stacks);
};

const scanJavaScript = (
  context: SourceScanContext,
  start: number,
  stopAtClosingBrace: boolean,
): number => {
  let step: JavaScriptStep = {
    index: start,
    isBlockAllowed: true,
    isControlPending: false,
    isREGEXAllowed: true,
  };
  let nestedBraceDepth = 0;
  const stacks: DelimiterStacks = { braceBlocks: [], controlParentheses: [] };
  while (step.index < context.source.length) {
    const code = context.source.charCodeAt(step.index);
    if (stopAtClosingBrace && code === CLOSE_BRACE && nestedBraceDepth === 0) {
      return step.index + 1;
    }
    nestedBraceDepth = nextBraceDepth(code, nestedBraceDepth);
    step = nextJavaScriptStep(context.source, step, code, stacks, context);
  }
  return context.source.length;
};

/**
 * Emits genuine comments while treating regex, JSX, hashbangs, and template raw chunks as opaque.
 */
export const scanSourceComments = (source: string, consumeComment: CommentConsumer): void => {
  scanJavaScript(
    { consumeComment, failedJSXStarts: new Set(), source },
    indexAfterHashbang(source),
    false,
  );
};
