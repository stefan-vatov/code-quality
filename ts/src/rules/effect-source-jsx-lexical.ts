import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import {
  findLineTerminatorIndex,
  indexAfterLineTerminator,
  isLineTerminatorCode,
} from './effect-source-line-terminators';

export const CHAR_CODE_BACKSLASH = 92;

export const CHAR_CODE_BLOCK_COMMENT = 42;

export const CHAR_CODE_BRACE_CLOSE = 125;

export const CHAR_CODE_BRACE_OPEN = 123;

export const CHAR_CODE_COMMA = 44;

export const CHAR_CODE_DOLLAR = 36;

export const CHAR_CODE_DOUBLE_QUOTE = 34;

export const CHAR_CODE_EQUALS = 61;

export const CHAR_CODE_GREATER_THAN = 62;

export const CHAR_CODE_LESS_THAN = 60;

export const CHAR_CODE_LINE_COMMENT = 47;

export const CHAR_CODE_SINGLE_QUOTE = 39;

export const CHAR_CODE_SLASH = 47;

export const CHAR_CODE_TEMPLATE_QUOTE = 96;

export const CHAR_CODE_CLOSE_BRACKET = 93;

export const CHAR_CODE_CLOSE_PAREN = 41;

export const CHAR_CODE_EXCLAMATION = 33;

export const CHAR_CODE_HASH = 35;

export const CHAR_CODE_OPEN_PAREN = 40;

export const CLOSING_CODES = new Set([CHAR_CODE_CLOSE_BRACKET, CHAR_CODE_CLOSE_PAREN]);

export const PAIR_OPERATORS = new Set([
  '!=',
  '&&',
  '+=',
  '-=',
  '++',
  '*=',
  '**',
  '/=',
  '<<',
  '>>',
  '>=',
  '<=',
  '==',
  '=>',
  '||',
  '??',
  '--',
]);

const LETTER_MASK = CLS_LOWER | CLS_UPPER;
const DIGIT_MASK = 4;
const CHAR_CODE_COLON = 58;
const CHAR_CODE_DOT = 46;
const CHAR_CODE_HYPHEN = 45;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_VERTICAL_TAB = 11;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_UNDERSCORE = 95;
const CHAR_CODE_UNICODE = 128;
const JSX_NAME_START_PUNCTUATION = new Set([CHAR_CODE_HYPHEN, CHAR_CODE_DOT, CHAR_CODE_COLON]);
const JSX_PREFIX_OPERATORS = new Set([
  '!',
  '&&',
  '??',
  '||',
  '(',
  '[',
  '{',
  ',',
  ':',
  ';',
  '=',
  '=>',
  '?',
  'return',
]);
const JSX_PREFIX_WORDS = new Set(['case', 'default', 'else', 'return', 'throw', 'yield']);
const REGEX_PREFIX_WORDS = new Set([
  'case',
  'delete',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
const REGEX_AFTER_WORDS = new Set([
  ...REGEX_PREFIX_WORDS,
  'await',
  'break',
  'continue',
  'debugger',
  'default',
  'do',
  'export',
  'extends',
  'implements',
]);
const REGEX_PREFIX_OPERATORS = new Set([
  '!',
  '&&',
  '&&=',
  '&',
  '&=',
  '(',
  '[',
  '{',
  ',',
  ':',
  ';',
  '=',
  '==',
  '=>',
  '>=',
  '>',
  '??',
  '??=',
  '?',
  '|',
  '|=',
  '||',
  '||=',
  '^',
  '^=',
  '+',
  '+=',
  '-',
  '-=',
  '*',
  '*=',
  '**',
  '/',
  '/=',
  '%',
  '%=',
  '!=',
  '<<',
  '<<=',
  '<=',
  '<',
  '>>',
  '>>=',
]);
const KEYWORDS = new Set([
  ...REGEX_PREFIX_WORDS,
  'await',
  'break',
  'continue',
  'default',
  'do',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'interface',
  'let',
  'switch',
  'try',
  'type',
  'var',
  'while',
  'with',
]);

type ControlFlowHeader = 'for' | 'if' | 'while' | 'with';

const controlFlowHeader = (word: string): ControlFlowHeader | undefined => {
  switch (word) {
    case 'for': {
      return 'for';
    }
    case 'if': {
      return 'if';
    }
    case 'while': {
      return 'while';
    }
    case 'with': {
      return 'with';
    }
    default: {
      return undefined;
    }
  }
};

export interface SourceScanHandlers {
  readonly onComment: (startIndex: number, endIndex: number) => void;
  readonly onLiteralContent: (startIndex: number, endIndex: number) => void;
  readonly onREGEX: (startIndex: number, endIndex: number) => void;
  readonly onRawJSXText: (startIndex: number, endIndex: number) => void;
  readonly onTemplateDelimiter: (startIndex: number, endIndex: number) => void;
}

export type ScanMode = 'js' | 'jsx-probe' | 'jsx-tag' | 'jsx-text' | 'template-raw';

export type JSLastToken = 'keyword' | 'operator' | 'start' | 'value';

export interface JavaScriptContext {
  braceDepth: number;
  controlFlowHeader: ControlFlowHeader | undefined;
  controlFlowParenDepth: number;
  isControlFlowBody: boolean;
  parenDepth: number;
  readonly returnMode: ScanMode | undefined;
  lastOperator: string;
  lastToken: JSLastToken;
  lastWord: string;
}

export interface JSXElementFrame {
  readonly name: string;
  readonly returnMode: ScanMode;
}

export interface JSXTagState {
  readonly isClosing: boolean;
  nameEnd: number;
  readonly nameStart: number;
  hasNameEnded: boolean;
  lastCode: number;
  sawComma: boolean;
  sawExtends: boolean;
}

export interface TemplateFrame {
  rawStart: number;
}

export const isIdentifierStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE ||
  (charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & LETTER_MASK) !== 0) ||
  charCode >= CHAR_CODE_UNICODE;

export const isIdentifierPart = (charCode: number): boolean =>
  isIdentifierStart(charCode) ||
  (charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & DIGIT_MASK) !== 0);

export const isJSXNamePart = (charCode: number): boolean =>
  isIdentifierPart(charCode) || JSX_NAME_START_PUNCTUATION.has(charCode);

export const isWhitespace = (charCode: number): boolean =>
  charCode === CHAR_CODE_TAB ||
  charCode === CHAR_CODE_VERTICAL_TAB ||
  charCode === CHAR_CODE_FORM_FEED ||
  charCode === CHAR_CODE_SPACE ||
  isLineTerminatorCode(charCode);

export const quotedEnd = (source: string, startIndex: number, quoteCode: number): number => {
  let index = startIndex + 1;
  while (index < source.length) {
    const charCode = source.charCodeAt(index);
    if (charCode === CHAR_CODE_BACKSLASH) {
      index += 2;
    } else if (charCode === quoteCode) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return source.length;
};

export const quotedContentEnd = (source: string, endIndex: number): number => {
  if (endIndex < source.length) {
    return endIndex - 1;
  }
  return endIndex;
};

const isJSXNameStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_GREATER_THAN ||
  (isJSXNamePart(charCode) && !JSX_NAME_START_PUNCTUATION.has(charCode));

export const isJSXTagStart = (source: string, index: number): boolean => {
  const nextCode = source.charCodeAt(index + 1);
  return nextCode === CHAR_CODE_GREATER_THAN || isJSXNameStart(nextCode);
};

export const isJSXClosingTagStart = (source: string, index: number): boolean => {
  const nextCode = source.charCodeAt(index + 1);
  const nameCode = source.charCodeAt(index + 2);
  return (
    nextCode === CHAR_CODE_SLASH &&
    (nameCode === CHAR_CODE_GREATER_THAN || isJSXNameStart(nameCode))
  );
};

export const startsWithWord = (source: string, index: number, word: string): boolean => {
  if (!source.startsWith(word, index)) {
    return false;
  }
  const beforeCode = source.charCodeAt(index - 1);
  const afterCode = source.charCodeAt(index + word.length);
  return !isIdentifierPart(beforeCode) && !isIdentifierPart(afterCode);
};

export const wordEnd = (source: string, startIndex: number): number => {
  let index = startIndex + 1;
  while (index < source.length && isIdentifierPart(source.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

export const canStartJSX = (context: JavaScriptContext): boolean => {
  if (context.isControlFlowBody) {
    return true;
  }
  if (context.lastToken === 'start') {
    return true;
  }
  if (context.lastToken === 'keyword') {
    return JSX_PREFIX_WORDS.has(context.lastWord);
  }
  if (context.lastToken !== 'operator') {
    return false;
  }
  return JSX_PREFIX_OPERATORS.has(context.lastOperator);
};

export const canStartREGEX = (context: JavaScriptContext): boolean => {
  if (context.isControlFlowBody || context.lastToken === 'start') {
    return true;
  }
  if (context.lastToken === 'keyword') {
    return REGEX_AFTER_WORDS.has(context.lastWord);
  }
  return context.lastToken === 'operator' && REGEX_PREFIX_OPERATORS.has(context.lastOperator);
};

const isKeyword = (word: string): boolean => KEYWORDS.has(word);

export const createJavaScriptContext = (returnMode: ScanMode | undefined): JavaScriptContext => ({
  braceDepth: 0,
  controlFlowHeader: undefined,
  controlFlowParenDepth: 0,
  isControlFlowBody: false,
  lastOperator: '',
  lastToken: 'start',
  lastWord: '',
  parenDepth: 0,
  returnMode,
});

const isStatementPosition = (context: JavaScriptContext): boolean =>
  context.isControlFlowBody ||
  context.lastToken === 'start' ||
  (context.lastToken === 'operator' &&
    (context.lastOperator === ';' ||
      context.lastOperator === ':' ||
      context.lastOperator === '{')) ||
  (context.lastToken === 'keyword' && context.lastWord === 'else');

const controlFlowState = (
  context: JavaScriptContext,
): Pick<JavaScriptContext, 'controlFlowHeader' | 'controlFlowParenDepth'> => {
  if (context.controlFlowParenDepth > 0) {
    return {
      controlFlowHeader: context.controlFlowHeader,
      controlFlowParenDepth: context.controlFlowParenDepth,
    };
  }
  return { controlFlowHeader: undefined, controlFlowParenDepth: 0 };
};

export const setOperator = (context: JavaScriptContext, operator: string): JavaScriptContext => {
  const nextControlFlowState = controlFlowState(context);
  return {
    ...context,
    ...nextControlFlowState,
    isControlFlowBody: false,
    lastOperator: operator,
    lastToken: 'operator',
    lastWord: '',
  };
};

export const setValue = (context: JavaScriptContext): JavaScriptContext => {
  const nextControlFlowState = controlFlowState(context);
  return {
    ...context,
    ...nextControlFlowState,
    isControlFlowBody: false,
    lastOperator: '',
    lastToken: 'value',
    lastWord: '',
  };
};

const wordToken = (word: string): JSLastToken => {
  if (isKeyword(word)) {
    return 'keyword';
  }
  return 'value';
};

const nextControlFlowStateForWord = (
  context: JavaScriptContext,
  word: string,
): Pick<JavaScriptContext, 'controlFlowHeader' | 'controlFlowParenDepth'> => {
  const header = controlFlowHeader(word);
  if (header !== undefined && isStatementPosition(context)) {
    return { controlFlowHeader: header, controlFlowParenDepth: context.controlFlowParenDepth };
  }
  if (
    context.controlFlowParenDepth > 0 ||
    (context.controlFlowHeader === 'for' && context.controlFlowParenDepth === 0 && word === 'await')
  ) {
    return {
      controlFlowHeader: context.controlFlowHeader,
      controlFlowParenDepth: context.controlFlowParenDepth,
    };
  }
  return { controlFlowHeader: undefined, controlFlowParenDepth: 0 };
};

export const setWord = (context: JavaScriptContext, word: string): JavaScriptContext => {
  const nextControlFlowState = nextControlFlowStateForWord(context, word);
  return {
    ...context,
    ...nextControlFlowState,
    isControlFlowBody: word === 'do' && isStatementPosition(context),
    lastOperator: '',
    lastToken: wordToken(word),
    lastWord: word,
  };
};

export const setOpenParenthesis = (context: JavaScriptContext): JavaScriptContext => {
  const {
    controlFlowHeader: pendingControlFlowHeader,
    controlFlowParenDepth: currentControlFlowParenDepth,
    parenDepth: currentParenDepth,
  } = context;
  const parenDepth = currentParenDepth + 1;
  let controlFlowParenDepth = currentControlFlowParenDepth;
  if (pendingControlFlowHeader !== undefined && controlFlowParenDepth === 0) {
    controlFlowParenDepth = parenDepth;
  }
  return {
    ...context,
    controlFlowParenDepth,
    isControlFlowBody: false,
    lastOperator: '(',
    lastToken: 'operator',
    lastWord: '',
    parenDepth,
  };
};

export const setCloseParenthesis = (context: JavaScriptContext): JavaScriptContext => {
  const {
    controlFlowHeader: currentControlFlowHeader,
    controlFlowParenDepth: currentControlFlowParenDepth,
    parenDepth: currentParenDepth,
  } = context;
  const isControlFlowConditionClose =
    currentControlFlowHeader !== undefined &&
    currentControlFlowParenDepth > 0 &&
    currentControlFlowParenDepth === currentParenDepth;
  const nextContext = setValue(context);
  let {
    controlFlowHeader: nextControlFlowHeader,
    controlFlowParenDepth: nextControlFlowParenDepth,
  } = nextContext;
  let isControlFlowBody = false;
  if (isControlFlowConditionClose) {
    nextControlFlowHeader = undefined;
    nextControlFlowParenDepth = 0;
    isControlFlowBody = true;
  }
  return {
    ...nextContext,
    controlFlowHeader: nextControlFlowHeader,
    controlFlowParenDepth: nextControlFlowParenDepth,
    isControlFlowBody,
    parenDepth: Math.max(0, currentParenDepth - 1),
  };
};

export const skipLineComment = (
  source: string,
  startIndex: number,
  handlers: SourceScanHandlers,
): number => {
  const lineEnd = findLineTerminatorIndex(source, startIndex + 2);
  handlers.onComment(startIndex, lineEnd);
  return indexAfterLineTerminator(source, lineEnd);
};

export const skipBlockComment = (
  source: string,
  startIndex: number,
  handlers: SourceScanHandlers,
): number => {
  const closeIndex = source.indexOf('*/', startIndex + 2);
  let endIndex = source.length;
  if (closeIndex !== -1) {
    endIndex = closeIndex + 2;
  }
  handlers.onComment(startIndex, endIndex);
  return endIndex;
};
