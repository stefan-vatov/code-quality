/* -------------------------------------------------------------------------- */
/*         Character, context, and token primitives for JSX scanning.         */
/* -------------------------------------------------------------------------- */
import { CHAR_CLASS, CLS_LOWER, CLS_UPPER } from './char-class';
import {
  findLineTerminatorIndex,
  indexAfterLineTerminator,
  isLineTerminatorCode,
} from './effect-source-line-terminators';

/**
 * UTF-16 code unit for a JavaScript backslash.
 *
 * @internal
 */
export const CHAR_CODE_BACKSLASH = 92;
/**
 * UTF-16 code unit for an asterisk.
 *
 * @internal
 */
export const CHAR_CODE_BLOCK_COMMENT = 42;
/**
 * UTF-16 code unit for a closing brace.
 *
 * @internal
 */
export const CHAR_CODE_BRACE_CLOSE = 125;
/**
 * UTF-16 code unit for an opening brace.
 *
 * @internal
 */
export const CHAR_CODE_BRACE_OPEN = 123;
/**
 * UTF-16 code unit for a comma.
 *
 * @internal
 */
export const CHAR_CODE_COMMA = 44;
/**
 * UTF-16 code unit for a dollar sign.
 *
 * @internal
 */
export const CHAR_CODE_DOLLAR = 36;
/**
 * UTF-16 code unit for a double quote.
 *
 * @internal
 */
export const CHAR_CODE_DOUBLE_QUOTE = 34;
/**
 * UTF-16 code unit for an equals sign.
 *
 * @internal
 */
export const CHAR_CODE_EQUALS = 61;
/**
 * UTF-16 code unit for a greater-than sign.
 *
 * @internal
 */
export const CHAR_CODE_GREATER_THAN = 62;
/**
 * UTF-16 code unit for a less-than sign.
 *
 * @internal
 */
export const CHAR_CODE_LESS_THAN = 60;
/**
 * UTF-16 code unit for a slash.
 *
 * @internal
 */
export const CHAR_CODE_LINE_COMMENT = 47;
/**
 * UTF-16 code unit for a single quote.
 *
 * @internal
 */
export const CHAR_CODE_SINGLE_QUOTE = 39;
/**
 * UTF-16 code unit for a slash.
 *
 * @internal
 */
export const CHAR_CODE_SLASH = 47;
/**
 * UTF-16 code unit for a template quote.
 *
 * @internal
 */
export const CHAR_CODE_TEMPLATE_QUOTE = 96;
/**
 * UTF-16 code unit for a closing bracket.
 *
 * @internal
 */
export const CHAR_CODE_CLOSE_BRACKET = 93;
/**
 * UTF-16 code unit for a closing parenthesis.
 *
 * @internal
 */
export const CHAR_CODE_CLOSE_PAREN = 41;
/**
 * UTF-16 code unit for an exclamation mark.
 *
 * @internal
 */
export const CHAR_CODE_EXCLAMATION = 33;
/**
 * UTF-16 code unit for a hash sign.
 *
 * @internal
 */
export const CHAR_CODE_HASH = 35;
/**
 * UTF-16 code unit for an opening parenthesis.
 *
 * @internal
 */
export const CHAR_CODE_OPEN_PAREN = 40;
/**
 * Closing punctuation that follows a JavaScript value.
 *
 * @internal
 */
export const CLOSING_CODES = new Set([CHAR_CODE_CLOSE_BRACKET, CHAR_CODE_CLOSE_PAREN]);
/**
 * Two-character operators recognized by the source projection.
 *
 * @internal
 */
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

/**
 * Projection callbacks emitted by the source lexer.
 *
 * @internal
 */
export interface SourceScanHandlers {
  readonly onComment: (startIndex: number, endIndex: number) => void;
  readonly onLiteralContent: (startIndex: number, endIndex: number) => void;
  readonly onREGEX: (startIndex: number, endIndex: number) => void;
  readonly onRawJSXText: (startIndex: number, endIndex: number) => void;
  readonly onTemplateDelimiter: (startIndex: number, endIndex: number) => void;
}

/**
 * Active lexical mode for the iterative source lexer.
 *
 * @internal
 */
export type ScanMode = 'js' | 'jsx-probe' | 'jsx-tag' | 'jsx-text' | 'template-raw';
/**
 * Token category used to decide whether a less-than starts JSX.
 *
 * @internal
 */
export type JSLastToken = 'keyword' | 'operator' | 'start' | 'value';

/**
 * Mutable JavaScript lexical context carried across nested regions.
 *
 * @internal
 */
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

/**
 * Open JSX element and the mode to restore after its close.
 *
 * @internal
 */
export interface JSXElementFrame {
  readonly name: string;
  readonly returnMode: ScanMode;
}

/**
 * Incremental state for one JSX opening or closing tag.
 *
 * @internal
 */
export interface JSXTagState {
  readonly isClosing: boolean;
  nameEnd: number;
  readonly nameStart: number;
  hasNameEnded: boolean;
  lastCode: number;
  sawComma: boolean;
  sawExtends: boolean;
}

/**
 * Raw-text boundary for one open template literal.
 *
 * @internal
 */
export interface TemplateFrame {
  rawStart: number;
}

/**
 * Return whether a UTF-16 code unit can start a JavaScript identifier.
 *
 * @internal
 */
export const isIdentifierStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE ||
  (charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & LETTER_MASK) !== 0) ||
  charCode >= CHAR_CODE_UNICODE;

/**
 * Return whether a UTF-16 code unit can continue a JavaScript identifier.
 *
 * @internal
 */
export const isIdentifierPart = (charCode: number): boolean =>
  isIdentifierStart(charCode) ||
  (charCode < CHAR_CLASS.length && (CHAR_CLASS[charCode] & DIGIT_MASK) !== 0);

/**
 * Return whether a UTF-16 code unit can continue a JSX name.
 *
 * @internal
 */
export const isJSXNamePart = (charCode: number): boolean =>
  isIdentifierPart(charCode) || JSX_NAME_START_PUNCTUATION.has(charCode);

/**
 * Return whether a UTF-16 code unit is JavaScript or JSX whitespace.
 *
 * @internal
 */
export const isWhitespace = (charCode: number): boolean =>
  charCode === CHAR_CODE_TAB ||
  charCode === CHAR_CODE_VERTICAL_TAB ||
  charCode === CHAR_CODE_FORM_FEED ||
  charCode === CHAR_CODE_SPACE ||
  isLineTerminatorCode(charCode);

/**
 * Find the first unescaped closing quote, or the source length.
 *
 * @internal
 */
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

/**
 * Return the exclusive end of quoted content for a quote scan result.
 *
 * @internal
 */
export const quotedContentEnd = (source: string, endIndex: number): number => {
  if (endIndex < source.length) {
    return endIndex - 1;
  }
  return endIndex;
};

const isJSXNameStart = (charCode: number): boolean =>
  charCode === CHAR_CODE_GREATER_THAN ||
  (isJSXNamePart(charCode) && !JSX_NAME_START_PUNCTUATION.has(charCode));

/**
 * Return whether the less-than at an index begins a JSX opening tag.
 *
 * @internal
 */
export const isJSXTagStart = (source: string, index: number): boolean => {
  const nextCode = source.charCodeAt(index + 1);
  return nextCode === CHAR_CODE_GREATER_THAN || isJSXNameStart(nextCode);
};

/**
 * Return whether the less-than at an index begins a JSX closing tag.
 *
 * @internal
 */
export const isJSXClosingTagStart = (source: string, index: number): boolean => {
  const nextCode = source.charCodeAt(index + 1);
  const nameCode = source.charCodeAt(index + 2);
  return (
    nextCode === CHAR_CODE_SLASH &&
    (nameCode === CHAR_CODE_GREATER_THAN || isJSXNameStart(nameCode))
  );
};

/**
 * Return whether a word occurs at an identifier boundary.
 *
 * @internal
 */
export const startsWithWord = (source: string, index: number, word: string): boolean => {
  if (!source.startsWith(word, index)) {
    return false;
  }
  const beforeCode = source.charCodeAt(index - 1);
  const afterCode = source.charCodeAt(index + word.length);
  return !isIdentifierPart(beforeCode) && !isIdentifierPart(afterCode);
};

/**
 * Find the exclusive end of an identifier beginning at an index.
 *
 * @internal
 */
export const wordEnd = (source: string, startIndex: number): number => {
  let index = startIndex + 1;
  while (index < source.length && isIdentifierPart(source.charCodeAt(index))) {
    index += 1;
  }
  return index;
};

/**
 * Return whether the current JavaScript token position can begin JSX.
 *
 * @internal
 */
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

/**
 * Return whether the current JavaScript token position can begin a regex.
 *
 * @internal
 */
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

/**
 * Create a fresh JavaScript context for a nested expression.
 *
 * @internal
 */
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

/**
 * Return a context whose latest token is an operator.
 *
 * @internal
 */
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

/**
 * Return a context whose latest token is a value.
 *
 * @internal
 */
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

/**
 * Return a context whose latest token is an identifier or keyword.
 *
 * @internal
 */
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

/**
 * Return a context after an opening JavaScript parenthesis.
 *
 * @internal
 */
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

/**
 * Return a context after a closing JavaScript parenthesis.
 *
 * @internal
 */
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

/**
 * Skip a line comment and emit its source span.
 *
 * @internal
 */
export const skipLineComment = (
  source: string,
  startIndex: number,
  handlers: SourceScanHandlers,
): number => {
  const lineEnd = findLineTerminatorIndex(source, startIndex + 2);
  handlers.onComment(startIndex, lineEnd);
  return indexAfterLineTerminator(source, lineEnd);
};

/**
 * Skip a block comment and emit its source span.
 *
 * @internal
 */
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
