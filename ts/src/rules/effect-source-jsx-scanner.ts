/* -------------------------------------------------------------------------- */
/*        Iterative JSX-aware lexical scanning for source projections.        */
/* -------------------------------------------------------------------------- */
import {
  CHAR_CODE_BRACE_CLOSE,
  CHAR_CODE_BRACE_OPEN,
  CHAR_CODE_COMMA,
  CHAR_CODE_DOUBLE_QUOTE,
  CHAR_CODE_EXCLAMATION,
  CHAR_CODE_GREATER_THAN,
  CHAR_CODE_HASH,
  CHAR_CODE_LESS_THAN,
  CHAR_CODE_OPEN_PAREN,
  CHAR_CODE_SINGLE_QUOTE,
  CHAR_CODE_SLASH,
  isJSXClosingTagStart,
  isJSXNamePart,
  isJSXTagStart,
  isWhitespace,
  quotedContentEnd,
  quotedEnd,
  setOperator,
  setValue,
  startsWithWord,
} from './effect-source-jsx-lexical';
import type {
  JSXElementFrame,
  JSXTagState,
  ScanMode,
  SourceScanHandlers,
} from './effect-source-jsx-lexical';
import {
  findLineTerminatorIndex,
  indexAfterLineTerminator,
} from './effect-source-line-terminators';
import { SourceLexerBase } from './effect-source-jsx-lexer-base';

class SourceLexer extends SourceLexerBase {
  readonly elements: JSXElementFrame[] = [];
  jsxRawStart = 0;
  tag: JSXTagState | undefined = undefined;

  scan(): void {
    this.skipHashbang();
    while (this.index < this.source.length) {
      this.scanIteration();
    }
    this.flushRawJSXText();
    this.flushTemplateRaw();
  }

  skipHashbang(): void {
    if (
      this.source.charCodeAt(0) !== CHAR_CODE_HASH ||
      this.source.charCodeAt(1) !== CHAR_CODE_EXCLAMATION
    ) {
      return;
    }
    const lineEnd = findLineTerminatorIndex(this.source, 2);
    this.index = indexAfterLineTerminator(this.source, lineEnd);
  }

  scanIteration(): void {
    if (this.mode === 'template-raw') {
      return this.scanTemplateRaw();
    }
    if (this.mode === 'jsx-text') {
      return this.scanJSXText();
    }
    if (this.mode === 'jsx-tag') {
      return this.scanJSXTag();
    }
    if (this.mode === 'jsx-probe') {
      return this.scanJSXProbe();
    }
    return this.scanJavaScript();
  }

  restoreAfterExpression(returnMode: ScanMode): void {
    if (returnMode === 'template-raw') {
      this.setTemplateRawStart(this.index);
      this.handlers.onTemplateDelimiter(this.index - 1, this.index);
      return;
    }
    if (returnMode === 'jsx-text') {
      this.jsxRawStart = this.index;
      return;
    }
    if (returnMode === 'jsx-tag' && this.tag !== undefined) {
      this.updateJSXTag({ lastCode: CHAR_CODE_BRACE_CLOSE });
    }
  }

  beginJSXTag(isClosing: boolean, returnMode: ScanMode): void {
    let nameStart = this.index + 1;
    if (isClosing) {
      nameStart += 1;
    }
    if (!isClosing) {
      this.elements.push({ name: '', returnMode });
    }
    this.tag = {
      hasNameEnded: this.source.charCodeAt(nameStart) === CHAR_CODE_GREATER_THAN,
      isClosing,
      lastCode: CHAR_CODE_LESS_THAN,
      nameEnd: nameStart,
      nameStart,
      sawComma: false,
      sawExtends: false,
    };
    this.mode = 'jsx-tag';
    this.index = nameStart;
  }

  scanJSXText(): void {
    const charCode = this.source.charCodeAt(this.index);
    if (charCode === CHAR_CODE_BRACE_OPEN) {
      this.flushRawJSXText();
      this.index += 1;
      this.beginExpression('jsx-text');
      return;
    }
    if (charCode !== CHAR_CODE_LESS_THAN) {
      this.index += 1;
      return;
    }
    this.scanJSXTextTag();
  }

  scanJSXTextTag(): void {
    if (isJSXClosingTagStart(this.source, this.index)) {
      this.flushRawJSXText();
      this.beginJSXTag(true, 'jsx-text');
      return;
    }
    if (isJSXTagStart(this.source, this.index)) {
      this.flushRawJSXText();
      this.beginJSXTag(false, 'jsx-text');
      return;
    }
    this.index += 1;
  }

  scanJSXTag(): void {
    const { tag } = this;
    if (tag === undefined) {
      this.mode = 'js';
      return;
    }
    const charCode = this.source.charCodeAt(this.index);
    if (
      this.scanJSXTagEnd(charCode, tag) ||
      this.scanJSXTagQuote(charCode) ||
      this.scanJSXTagExpression(charCode)
    ) {
      return;
    }
    this.scanJSXTagContent(tag, charCode);
  }

  scanJSXTagEnd(charCode: number, tag: JSXTagState): boolean {
    if (charCode !== CHAR_CODE_GREATER_THAN) {
      return false;
    }
    this.closeJSXTag(tag);
    return true;
  }

  scanJSXTagQuote(charCode: number): boolean {
    if (charCode !== CHAR_CODE_SINGLE_QUOTE && charCode !== CHAR_CODE_DOUBLE_QUOTE) {
      return false;
    }
    const endIndex = quotedEnd(this.source, this.index, charCode);
    this.handlers.onLiteralContent(this.index + 1, quotedContentEnd(this.source, endIndex));
    this.updateJSXTag({ lastCode: charCode });
    this.index = endIndex;
    return true;
  }

  scanJSXTagExpression(charCode: number): boolean {
    if (charCode !== CHAR_CODE_BRACE_OPEN) {
      return false;
    }
    this.updateJSXTag({ lastCode: charCode });
    this.index += 1;
    this.beginExpression('jsx-tag');
    return true;
  }

  scanJSXTagContent(tag: JSXTagState, charCode: number): void {
    if (!tag.hasNameEnded && this.scanJSXTagName(charCode)) {
      return;
    }
    if (!tag.hasNameEnded) {
      this.updateJSXTag({ hasNameEnded: true, nameEnd: this.index });
    }
    this.scanJSXTagAttribute(charCode);
  }

  scanJSXTagName(charCode: number): boolean {
    if (!isJSXNamePart(charCode)) {
      return false;
    }
    this.index += 1;
    return true;
  }

  scanJSXTagAttribute(charCode: number): void {
    if (charCode === CHAR_CODE_COMMA) {
      this.updateJSXTag({ sawComma: true });
    }
    if (startsWithWord(this.source, this.index, 'extends')) {
      this.updateJSXTag({ sawExtends: true });
      this.index += 'extends'.length;
      this.updateJSXTag({ lastCode: this.source.charCodeAt(this.index - 1) });
      return;
    }
    if (!isWhitespace(charCode)) {
      this.updateJSXTag({ lastCode: charCode });
    }
    this.index += 1;
  }

  updateJSXTag(update: Partial<JSXTagState>): void {
    if (this.tag !== undefined) {
      this.tag = { ...this.tag, ...update };
    }
  }

  closeJSXTag(tag: JSXTagState): void {
    const endIndex = this.index + 1;
    const name = this.source.slice(tag.nameStart, tag.nameEnd);
    this.tag = undefined;
    if (tag.isClosing) {
      this.closeJSXClosingTag(name, endIndex);
      return;
    }
    this.closeJSXOpeningTag(tag, endIndex);
  }

  closeJSXClosingTag(name: string, endIndex: number): void {
    const frame = this.elements.at(-1);
    if (frame === undefined || frame.name !== name) {
      this.mode = 'jsx-text';
      this.jsxRawStart = endIndex;
      this.index = endIndex;
      return;
    }
    this.elements.pop();
    this.restoreAfterJSX(frame, endIndex);
  }

  closeJSXOpeningTag(tag: JSXTagState, endIndex: number): void {
    const frame = this.elements.at(-1);
    if (frame === undefined) {
      this.abortJSXOpeningTag(endIndex);
      return;
    }
    this.index = endIndex;
    if (this.closeGenericJSX(tag, frame, endIndex)) {
      return;
    }
    if (tag.lastCode === CHAR_CODE_SLASH) {
      return this.closeSelfClosingJSX(frame, endIndex);
    }
    this.openJSXContent(tag, endIndex);
  }

  abortJSXOpeningTag(endIndex: number): void {
    this.mode = 'js';
    this.index = endIndex;
  }

  closeSelfClosingJSX(frame: JSXElementFrame, endIndex: number): void {
    this.elements.pop();
    this.restoreAfterJSX(frame, endIndex);
  }

  closeGenericJSX(tag: JSXTagState, frame: JSXElementFrame, endIndex: number): boolean {
    if (!tag.sawComma && !tag.sawExtends) {
      return false;
    }
    if (this.source.charCodeAt(endIndex) !== CHAR_CODE_GREATER_THAN) {
      return false;
    }
    this.elements.pop();
    this.mode = frame.returnMode;
    this.context = setOperator(this.context, '<');
    return true;
  }

  openJSXContent(tag: JSXTagState, endIndex: number): void {
    if (tag.sawComma || tag.sawExtends) {
      this.mode = 'jsx-probe';
      this.jsxRawStart = endIndex;
      return;
    }
    this.mode = 'jsx-text';
    this.jsxRawStart = endIndex;
  }

  restoreAfterJSX(frame: JSXElementFrame, endIndex: number): void {
    this.mode = frame.returnMode;
    this.index = endIndex;
    if (frame.returnMode === 'jsx-text') {
      this.jsxRawStart = endIndex;
      return;
    }
    if (frame.returnMode === 'jsx-tag' && this.tag !== undefined) {
      this.tag.lastCode = CHAR_CODE_GREATER_THAN;
      return;
    }
    this.isAfterJSX = true;
    this.context = setValue(this.context);
  }

  scanJSXProbe(): void {
    const charCode = this.source.charCodeAt(this.index);
    if (isWhitespace(charCode)) {
      this.index += 1;
      return;
    }
    if (charCode === CHAR_CODE_OPEN_PAREN) {
      const frame = this.elements.pop();
      this.mode = frame?.returnMode ?? 'js';
      this.context = setOperator(this.context, '<');
      return;
    }
    this.mode = 'jsx-text';
  }

  flushRawJSXText(): void {
    if (this.mode === 'jsx-text' || this.mode === 'jsx-probe') {
      if (this.jsxRawStart < this.index) {
        this.handlers.onRawJSXText(this.jsxRawStart, this.index);
      }
      this.jsxRawStart = this.index;
    }
  }

  flushTemplateRaw(): void {
    if (this.mode === 'template-raw') {
      const template = this.templates.at(-1);
      if (template !== undefined) {
        this.handlers.onLiteralContent(template.rawStart, this.source.length);
      }
    }
  }
}

/**
 * Scan source once from left to right, recognizing JavaScript comments and literals as well as JSX
 * text, tags, attributes, and expression containers.
 *
 * @param source - Complete source text.
 * @param handlers - Projection callbacks for each opaque source region.
 * @returns Nothing.
 * @throws Does not throw.
 * @internal
 */
export const scanSource = (source: string, handlers: SourceScanHandlers): void => {
  new SourceLexer(source, handlers).scan();
};
