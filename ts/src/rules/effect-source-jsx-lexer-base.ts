import {
  CHAR_CODE_BACKSLASH,
  CHAR_CODE_BLOCK_COMMENT,
  CHAR_CODE_BRACE_CLOSE,
  CHAR_CODE_BRACE_OPEN,
  CHAR_CODE_CLOSE_PAREN,
  CHAR_CODE_DOLLAR,
  CHAR_CODE_DOUBLE_QUOTE,
  CHAR_CODE_LESS_THAN,
  CHAR_CODE_LINE_COMMENT,
  CHAR_CODE_OPEN_PAREN,
  CHAR_CODE_SINGLE_QUOTE,
  CHAR_CODE_TEMPLATE_QUOTE,
  CLOSING_CODES,
  PAIR_OPERATORS,
  canStartJSX,
  canStartREGEX,
  createJavaScriptContext,
  isIdentifierStart,
  isJSXTagStart,
  isWhitespace,
  quotedContentEnd,
  quotedEnd,
  setCloseParenthesis,
  setOpenParenthesis,
  setOperator,
  setValue,
  setWord,
  skipBlockComment,
  skipLineComment,
  wordEnd,
} from './effect-source-jsx-lexical';
import type {
  JavaScriptContext,
  ScanMode,
  SourceScanHandlers,
  TemplateFrame,
} from './effect-source-jsx-lexical';
import { findREGEXLiteralEnd, isREGEXLiteralStart } from './effect-source-regex-scan';

export abstract class SourceLexerBase {
  readonly contexts: JavaScriptContext[] = [];
  readonly handlers: SourceScanHandlers;
  readonly source: string;
  readonly templates: TemplateFrame[] = [];
  context: JavaScriptContext;
  index = 0;
  isAfterJSX = false;
  mode: ScanMode = 'js';

  constructor(source: string, handlers: SourceScanHandlers) {
    this.context = createJavaScriptContext(undefined);
    this.handlers = handlers;
    this.source = source;
  }

  abstract beginJSXTag(isClosing: boolean, returnMode: ScanMode): void;

  abstract restoreAfterExpression(returnMode: ScanMode): void;

  scanJavaScript(): void {
    const charCode = this.source.charCodeAt(this.index);
    if (this.closeExpressionIfNeeded(charCode)) {
      return;
    }
    if (this.scanJavaScriptToken(charCode)) {
      return;
    }
    if (isIdentifierStart(charCode)) {
      this.scanIdentifier();
      return;
    }
    this.scanJavaScriptPunctuation(charCode);
  }

  scanJavaScriptToken(charCode: number): boolean {
    if (isWhitespace(charCode)) {
      this.index += 1;
      return true;
    }
    return (
      this.scanJavaScriptSlash(charCode) ||
      this.scanJavaScriptLiteral(charCode) ||
      this.scanJavaScriptJSX(charCode)
    );
  }

  scanJavaScriptSlash(charCode: number): boolean {
    if (charCode !== CHAR_CODE_LINE_COMMENT) {
      return false;
    }
    const nextCode = this.source.charCodeAt(this.index + 1);
    if (nextCode === CHAR_CODE_LINE_COMMENT) {
      return this.scanLineComment();
    }
    if (nextCode === CHAR_CODE_BLOCK_COMMENT) {
      return this.scanBlockComment();
    }
    return this.scanSlashToken();
  }

  scanSlashToken(): boolean {
    if (this.scanSlashAfterJSX()) {
      return true;
    }
    if (!isREGEXLiteralStart(this.source, this.index) && !canStartREGEX(this.context)) {
      return this.scanSlashOperator();
    }
    return this.scanREGEXLiteral();
  }

  scanLineComment(): boolean {
    this.isAfterJSX = false;
    this.index = skipLineComment(this.source, this.index, this.handlers);
    return true;
  }

  scanBlockComment(): boolean {
    this.isAfterJSX = false;
    this.index = skipBlockComment(this.source, this.index, this.handlers);
    return true;
  }

  scanSlashOperator(): boolean {
    this.context = setOperator(this.context, '/');
    this.index += 1;
    return true;
  }

  scanSlashAfterJSX(): boolean {
    if (!this.isAfterJSX) {
      return false;
    }
    this.isAfterJSX = false;
    if (canStartREGEX(this.context)) {
      return false;
    }
    return this.scanSlashOperator();
  }

  scanREGEXLiteral(): boolean {
    const endIndex = findREGEXLiteralEnd(this.source, this.index);
    if (endIndex <= this.index) {
      return this.scanSlashOperator();
    }
    this.handlers.onREGEX(this.index, endIndex + 1);
    this.index = endIndex + 1;
    this.context = setValue(this.context);
    return true;
  }

  scanJavaScriptLiteral(charCode: number): boolean {
    if (charCode === CHAR_CODE_SINGLE_QUOTE || charCode === CHAR_CODE_DOUBLE_QUOTE) {
      this.scanQuotedJavaScript(charCode);
      return true;
    }
    if (charCode !== CHAR_CODE_TEMPLATE_QUOTE) {
      return false;
    }
    this.templates.push({ rawStart: this.index + 1 });
    this.mode = 'template-raw';
    this.index += 1;
    return true;
  }

  scanJavaScriptJSX(charCode: number): boolean {
    if (charCode !== CHAR_CODE_LESS_THAN || !canStartJSX(this.context)) {
      return false;
    }
    if (!isJSXTagStart(this.source, this.index)) {
      return false;
    }
    this.beginJSXTag(false, this.mode);
    return true;
  }

  closeExpressionIfNeeded(charCode: number): boolean {
    if (
      charCode !== CHAR_CODE_BRACE_CLOSE ||
      this.context.braceDepth !== 0 ||
      this.context.returnMode === undefined
    ) {
      return false;
    }
    this.index += 1;
    const { returnMode } = this.context;
    this.context = this.contexts.pop() ?? this.context;
    this.mode = returnMode;
    this.restoreAfterExpression(returnMode);
    return true;
  }

  scanQuotedJavaScript(quoteCode: number): void {
    const endIndex = quotedEnd(this.source, this.index, quoteCode);
    this.handlers.onLiteralContent(this.index + 1, quotedContentEnd(this.source, endIndex));
    this.index = endIndex;
    this.context = setValue(this.context);
  }

  scanIdentifier(): void {
    const startIndex = this.index;
    const endIndex = wordEnd(this.source, startIndex);
    const word = this.source.slice(startIndex, endIndex);
    this.context = setWord(this.context, word);
    this.index = endIndex;
  }

  scanJavaScriptPunctuation(charCode: number): void {
    if (this.scanJavaScriptBrace(charCode) || this.scanJavaScriptParenthesis(charCode)) {
      return;
    }
    const pair = this.source.slice(this.index, this.index + 2);
    if (PAIR_OPERATORS.has(pair)) {
      this.scanOperator(pair);
      return;
    }
    this.scanSinglePunctuation(charCode);
  }

  scanJavaScriptParenthesis(charCode: number): boolean {
    if (charCode === CHAR_CODE_OPEN_PAREN) {
      this.context = setOpenParenthesis(this.context);
      this.index += 1;
      return true;
    }
    if (charCode !== CHAR_CODE_CLOSE_PAREN) {
      return false;
    }
    this.context = setCloseParenthesis(this.context);
    this.index += 1;
    return true;
  }

  scanSinglePunctuation(charCode: number): void {
    if (CLOSING_CODES.has(charCode)) {
      this.context = setValue(this.context);
    } else {
      this.context = setOperator(this.context, String.fromCharCode(charCode));
    }
    this.index += 1;
  }

  scanJavaScriptBrace(charCode: number): boolean {
    if (charCode === CHAR_CODE_BRACE_OPEN) {
      this.context = setOperator({ ...this.context, braceDepth: this.context.braceDepth + 1 }, '{');
      this.index += 1;
      return true;
    }
    if (charCode !== CHAR_CODE_BRACE_CLOSE) {
      return false;
    }
    this.context = setValue({
      ...this.context,
      braceDepth: Math.max(0, this.context.braceDepth - 1),
    });
    this.index += 1;
    return true;
  }

  scanOperator(operator: string): void {
    this.context = setOperator(this.context, operator);
    this.index += operator.length;
  }

  beginExpression(returnMode: ScanMode): void {
    this.contexts.push(this.context);
    this.context = createJavaScriptContext(returnMode);
    this.mode = 'js';
  }

  scanTemplateRaw(): void {
    const template = this.templates.at(-1);
    if (template === undefined) {
      this.mode = 'js';
      return;
    }
    const charCode = this.source.charCodeAt(this.index);
    if (this.scanTemplateToken(charCode, template)) {
      return;
    }
    this.index += 1;
  }

  scanTemplateToken(charCode: number, template: TemplateFrame): boolean {
    return (
      this.scanTemplateEscape(charCode) ||
      this.scanTemplateClose(charCode, template) ||
      this.scanTemplateInterpolation(charCode, template)
    );
  }

  scanTemplateEscape(charCode: number): boolean {
    if (charCode !== CHAR_CODE_BACKSLASH) {
      return false;
    }
    this.index += 2;
    return true;
  }

  scanTemplateClose(charCode: number, template: TemplateFrame): boolean {
    if (charCode !== CHAR_CODE_TEMPLATE_QUOTE) {
      return false;
    }
    this.handlers.onLiteralContent(template.rawStart, this.index);
    this.templates.pop();
    this.index += 1;
    this.mode = 'js';
    this.context = setValue(this.context);
    return true;
  }

  scanTemplateInterpolation(charCode: number, template: TemplateFrame): boolean {
    if (
      charCode !== CHAR_CODE_DOLLAR ||
      this.source.charCodeAt(this.index + 1) !== CHAR_CODE_BRACE_OPEN
    ) {
      return false;
    }
    this.handlers.onLiteralContent(template.rawStart, this.index);
    this.handlers.onTemplateDelimiter(this.index, this.index + 2);
    this.setTemplateRawStart(this.index + 2);
    this.index += 2;
    this.beginExpression('template-raw');
    return true;
  }

  setTemplateRawStart(rawStart: number): void {
    const templateIndex = this.templates.length - 1;
    if (templateIndex >= 0) {
      this.templates[templateIndex] = { rawStart };
    }
  }
}
