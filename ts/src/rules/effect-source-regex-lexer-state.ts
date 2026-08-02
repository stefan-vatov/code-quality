/* -------------------------------------------------------------------------- */
/*            Stateful source pass for incremental regex indexing.            */
/* -------------------------------------------------------------------------- */
import type { REGEXTokenContext } from './effect-source-regex-lexer-context';
import { regexLexerPrimitives } from './effect-source-regex-lexer';
import { scanREGEXLiteralEnd } from './effect-source-regex-literal';

const lexer = regexLexerPrimitives;

interface REGEXIndex {
  ends: Map<number, number>;
  starts: Set<number>;
}

interface TemplateFrame {
  interpolationDepth: number;
  isRaw: boolean;
  outerContext: REGEXTokenContext;
}

/**
 * Stateful source lexer used to build the cached regex index.
 *
 * @internal
 */
class REGEXSourceLexer {
  readonly source: string;
  context: REGEXTokenContext = lexer.newTokenContext();
  frames: TemplateFrame[] = [];
  index = 0;
  readonly regexIndex: REGEXIndex = lexer.newREGEXIndex();

  constructor(source: string) {
    this.source = source;
  }

  /**
   * Scans the complete source exactly once.
   *
   * @returns The indexed regex starts and ends.
   * @throws Does not throw.
   */
  scan(): REGEXIndex {
    while (this.index < this.source.length) {
      this.scanIteration();
    }
    return this.regexIndex;
  }

  scanIteration(): void {
    const frame = this.frames.at(-1);
    if (frame !== undefined && frame.isRaw) {
      this.scanTemplateRaw();
      return;
    }
    if (this.closeTemplateInterpolation()) {
      return;
    }
    this.updateInterpolationDepth();
    this.scanCodeToken();
  }

  scanTemplateRaw(): void {
    const frame = this.frames.at(-1);
    if (frame === undefined) {
      this.index += lexer.singleCharacterLength;
      return;
    }
    this.scanTemplateRawCharacter(frame);
  }

  scanTemplateRawCharacter(frame: TemplateFrame): void {
    const charCode = this.source.charCodeAt(this.index);
    if (charCode === lexer.charCodeBackslash) {
      this.index += lexer.pairOperatorLength;
      return;
    }
    if (lexer.isTemplateInterpolationStart(this.source, this.index)) {
      this.enterTemplateInterpolation(frame);
      return;
    }
    this.finishTemplateRawCharacter(frame, charCode);
  }

  enterTemplateInterpolation(frame: TemplateFrame): void {
    this.replaceCurrentFrame({
      ...frame,
      interpolationDepth: 1,
      isRaw: false,
    });
    this.context = lexer.newTokenContext(false);
    this.index += lexer.pairOperatorLength;
  }

  finishTemplateRawCharacter(frame: TemplateFrame, charCode: number): void {
    if (charCode === lexer.charCodeTemplateQuote) {
      this.frames.pop();
      this.context = frame.outerContext;
      lexer.afterValue(this.context);
    }
    this.index += lexer.singleCharacterLength;
  }

  replaceCurrentFrame(frame: TemplateFrame): void {
    const frameIndex = this.frames.length - lexer.singleCharacterLength;
    if (frameIndex >= 0) {
      this.frames[frameIndex] = frame;
    }
  }

  closeTemplateInterpolation(): boolean {
    const frame = this.frames.at(-1);
    if (
      frame === undefined ||
      frame.isRaw ||
      frame.interpolationDepth !== 1 ||
      this.source.charCodeAt(this.index) !== lexer.charCodeBraceClose
    ) {
      return false;
    }
    this.replaceCurrentFrame({
      ...frame,
      interpolationDepth: 0,
      isRaw: true,
    });
    this.index += lexer.singleCharacterLength;
    return true;
  }

  updateInterpolationDepth(): void {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame.isRaw) {
      return;
    }
    const depth = lexer.nextInterpolationDepth(
      frame.interpolationDepth,
      this.source.charCodeAt(this.index),
    );
    if (depth === frame.interpolationDepth) {
      return;
    }
    this.replaceCurrentFrame({ ...frame, interpolationDepth: depth });
  }

  scanCodeToken(): void {
    const charCode = this.source.charCodeAt(this.index);
    if (lexer.isWhitespaceCode(charCode)) {
      this.consumeWhitespace(charCode);
      return;
    }
    if (charCode === lexer.charCodeSlash) {
      this.consumeSlash();
      return;
    }
    lexer.beginToken(this.context);
    this.processCodeToken(charCode);
  }

  processCodeToken(charCode: number): void {
    const simpleTokenEnd = this.simpleTokenEnd(charCode);
    if (simpleTokenEnd !== undefined) {
      this.index = simpleTokenEnd;
      return;
    }
    this.scanComplexToken(charCode);
  }

  consumeWhitespace(charCode: number): void {
    if (lexer.isLineTerminatorCode(charCode)) {
      this.context.hasLineTerminator = true;
    }
    this.index += lexer.singleCharacterLength;
  }

  simpleTokenEnd(charCode: number): number | undefined {
    if (lexer.identifierStart(this.source, this.index)) {
      const endIndex = lexer.identifierEnd(this.source, this.index);
      lexer.consumeIdentifier(this.context, this.source, this.index, endIndex);
      return endIndex;
    }
    return this.literalTokenEnd(charCode);
  }

  literalTokenEnd(charCode: number): number | undefined {
    if (lexer.isASCIIDigit(charCode)) {
      const endIndex = lexer.numberEnd(this.source, this.index);
      lexer.afterValue(this.context);
      return endIndex;
    }
    if (charCode === lexer.charCodeSingleQuote || charCode === lexer.charCodeDoubleQuote) {
      const endIndex = lexer.quotedEnd(this.source, this.index, charCode);
      lexer.afterValue(this.context);
      return endIndex;
    }
    return undefined;
  }

  scanComplexToken(charCode: number): void {
    if (charCode === lexer.charCodeTemplateQuote) {
      this.enterTemplate();
      return;
    }
    this.consumePunctuation(charCode);
  }

  enterTemplate(): void {
    this.frames.push({
      interpolationDepth: 0,
      isRaw: true,
      outerContext: this.context,
    });
    this.context = lexer.newTokenContext(false);
    this.index += lexer.singleCharacterLength;
  }

  consumeOpeningDelimiter(charCode: number): void {
    lexer.consumeOpeningDelimiter(this.context, charCode);
    this.index += lexer.singleCharacterLength;
  }

  consumeClosingDelimiter(charCode: number): void {
    lexer.consumeClosingDelimiter(this.context, charCode);
    this.index += lexer.singleCharacterLength;
  }

  consumePunctuation(charCode: number): void {
    if (charCode === lexer.charCodeDOT) {
      this.consumeDOTToken();
      return;
    }
    if (this.consumeDelimiter(charCode)) {
      return;
    }
    this.index += lexer.consumeOperator(this.context, this.source, this.index, charCode);
  }

  consumeDOTToken(): void {
    const tokenLength = lexer.dotTokenLength(this.source, this.index);
    lexer.consumeDOT(this.context, tokenLength);
    this.index += tokenLength;
  }

  consumeDelimiter(charCode: number): boolean {
    if (lexer.isOpeningDelimiter(charCode)) {
      this.consumeOpeningDelimiter(charCode);
      return true;
    }
    if (lexer.isClosingDelimiter(charCode)) {
      this.consumeClosingDelimiter(charCode);
      return true;
    }
    return false;
  }

  consumeREGEXLiteral(): boolean {
    if (!this.context.shouldStartREGEX) {
      return false;
    }
    const endIndex = scanREGEXLiteralEnd(this.source, this.index);
    if (endIndex <= this.index) {
      return false;
    }
    this.regexIndex.starts.add(this.index);
    this.regexIndex.ends.set(this.index, endIndex);
    this.index = endIndex + lexer.singleCharacterLength;
    lexer.afterValue(this.context);
    return true;
  }

  consumeSlash(): void {
    const nextCode = this.source.charCodeAt(this.index + lexer.singleCharacterLength);
    if (this.consumeComment(nextCode)) {
      return;
    }
    lexer.beginToken(this.context);
    if (this.consumeREGEXLiteral()) {
      return;
    }
    this.consumeSlashOperator(nextCode);
  }

  consumeComment(nextCode: number): boolean {
    const skippedComment = lexer.commentEnd(this.source, this.index, nextCode);
    if (skippedComment === undefined) {
      return false;
    }
    if (skippedComment.hasLineTerminator) {
      this.context.hasLineTerminator = true;
    }
    this.index = skippedComment.endIndex;
    return true;
  }

  consumeSlashOperator(nextCode: number): void {
    this.context.setExpressionStart();
    this.index += lexer.slashOperatorLength(nextCode);
  }
}

/**
 * Build a regex index with one monotonic source pass.
 *
 * @param source - Complete source text.
 * @returns The indexed regex starts and ends.
 * @throws Does not throw.
 * @internal
 */
export const buildREGEXIndex = (source: string): REGEXIndex => new REGEXSourceLexer(source).scan();
