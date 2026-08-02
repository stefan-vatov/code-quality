/* -------------------------------------------------------------------------- */
/*      Mutable JavaScript lexical context for incremental regex scans.       */
/* -------------------------------------------------------------------------- */

const CHAR_CODE_BRACKET_CLOSE = ']'.charCodeAt(0);
const CHAR_CODE_BRACKET_OPEN = '['.charCodeAt(0);
const CHAR_CODE_COLON = ':'.charCodeAt(0);
const CHAR_CODE_EQUALS = '='.charCodeAt(0);
const CHAR_CODE_GREATER_THAN = '>'.charCodeAt(0);
const CHAR_CODE_LESS_THAN = '<'.charCodeAt(0);
const CHAR_CODE_MINUS = '-'.charCodeAt(0);
const CHAR_CODE_PAREN_CLOSE = ')'.charCodeAt(0);
const CHAR_CODE_PAREN_OPEN = '('.charCodeAt(0);
const CHAR_CODE_PLUS = '+'.charCodeAt(0);
const CHAR_CODE_SEMICOLON = ';'.charCodeAt(0);
const ELLIPSIS_LENGTH = '...'.length;
const PAIR_OPERATOR_LENGTH = 'ab'.length;
const SINGLE_CHARACTER_LENGTH = 'a'.length;
const DEFAULT_BRACE_KINDS: readonly [RegexBraceKind, RegexBraceKind] = ['object', 'block'];

export type RegexBraceKind =
  | 'arrow'
  | 'block'
  | 'class-declaration'
  | 'class-expression'
  | 'control'
  | 'function-declaration'
  | 'function-expression'
  | 'method'
  | 'object';

export type RegexIdentifierKind =
  | 'async'
  | 'block'
  | 'break'
  | 'case'
  | 'class'
  | 'control'
  | 'default'
  | 'export'
  | 'expression'
  | 'extends'
  | 'function'
  | 'implements'
  | 'return'
  | 'value';

type FunctionBodyKind = 'function-declaration' | 'function-expression';
type MethodBodyKind = FunctionBodyKind | 'method';
type ParenKind = 'control' | 'function' | 'method' | 'regular';
type ExportState = 'default' | 'export' | 'none';

const isStatementBoundaryBrace = (kind: RegexBraceKind): boolean =>
  kind === 'block' ||
  kind === 'class-declaration' ||
  kind === 'control' ||
  kind === 'function-declaration';

/**
 * Mutable lexical context used by the regex source scanner.
 *
 * @throws Does not throw.
 */
export class REGEXTokenContext {
  angleDepth = 0;
  braceKinds: RegexBraceKind[] = [];
  bracketDepth = 0;
  classBaseAngleDepth = 0;
  classBaseBracketDepth = 0;
  classBaseParenDepth = 0;
  classBodyKind: 'class-declaration' | 'class-expression' | undefined;
  exportState: ExportState = 'none';
  functionBaseAngleDepth = 0;
  hasLineTerminator = false;
  isAfterPropertyAccess = false;
  isStatementEndAllowed = false;
  isStatementStart: boolean;
  parenBodyKinds: (MethodBodyKind | undefined)[] = [];
  parenKinds: ParenKind[] = [];
  pendingAsyncFunction = false;
  pendingBraceKind: RegexBraceKind | undefined;
  pendingFunctionBodyKind: FunctionBodyKind | undefined;
  pendingParenKind: ParenKind = 'regular';
  shouldStartREGEX = true;

  constructor(isStatementStart = true) {
    this.isStatementStart = isStatementStart;
  }

  beginToken(): void {
    if (this.hasLineTerminator) {
      this.pendingAsyncFunction = false;
      if (this.isStatementEndAllowed) {
        this.isStatementStart = true;
        this.shouldStartREGEX = true;
      }
    }
    this.hasLineTerminator = false;
  }

  afterValue(): void {
    this.isAfterPropertyAccess = false;
    this.setTokenState(false, false, true);
    this.pendingAsyncFunction = false;
    this.pendingBraceKind = undefined;
    if (this.classBodyKind === undefined && this.pendingFunctionBodyKind === undefined) {
      this.exportState = 'none';
    }
  }

  setExpressionStart(): void {
    this.isAfterPropertyAccess = false;
    this.setTokenState(false, true, false);
    this.pendingBraceKind = undefined;
  }

  setHeaderValue(): void {
    this.isAfterPropertyAccess = false;
    this.setTokenState(false, false, false);
    this.pendingAsyncFunction = false;
    this.pendingBraceKind = undefined;
  }

  setTokenState(
    isStatementStart: boolean,
    shouldStartREGEX: boolean,
    isStatementEndAllowed: boolean,
  ): void {
    this.isStatementStart = isStatementStart;
    this.shouldStartREGEX = shouldStartREGEX;
    this.isStatementEndAllowed = isStatementEndAllowed;
  }

  consumeIdentifier(kind: RegexIdentifierKind): void {
    if (this.isAfterPropertyAccess) {
      this.afterValue();
      return;
    }
    this.isAfterPropertyAccess = false;
    if (this.consumePendingHeader(kind)) {
      return;
    }
    this.consumeIdentifierKind(kind);
  }

  consumeIdentifierKind(kind: RegexIdentifierKind): void {
    if (this.consumeStructuralIdentifier(kind)) {
      return;
    }
    this.consumeValueKeyword(kind);
  }

  consumeStructuralIdentifier(kind: RegexIdentifierKind): boolean {
    if (kind === 'function') {
      this.consumeFunctionKeyword();
      return true;
    }
    if (kind === 'class') {
      this.consumeClassKeyword();
      return true;
    }
    return this.consumeControlIdentifier(kind);
  }

  consumeControlIdentifier(kind: RegexIdentifierKind): boolean {
    if (kind === 'control') {
      this.consumeControlKeyword();
      return true;
    }
    if (kind === 'block') {
      this.consumeBlockKeyword();
      return true;
    }
    return false;
  }

  consumePendingHeader(kind: RegexIdentifierKind): boolean {
    if (this.pendingFunctionBodyKind !== undefined) {
      this.setHeaderValue();
      return true;
    }
    if (this.classBodyKind === undefined) {
      return false;
    }
    return this.consumeClassHeader(kind);
  }

  consumeClassHeader(kind: RegexIdentifierKind): boolean {
    if (kind === 'extends' || kind === 'implements') {
      this.setExpressionStart();
      return true;
    }
    this.setHeaderValue();
    return true;
  }

  consumeFunctionKeyword(): void {
    this.setFunctionBodyKind();
    this.functionBaseAngleDepth = this.angleDepth;
    this.pendingParenKind = 'function';
    this.pendingBraceKind = undefined;
    this.setTokenState(false, true, false);
    this.pendingAsyncFunction = false;
  }

  setFunctionBodyKind(): void {
    if (this.isStatementStart || this.exportState !== 'none') {
      this.pendingFunctionBodyKind = 'function-declaration';
      return;
    }
    this.pendingFunctionBodyKind = 'function-expression';
  }

  consumeClassKeyword(): void {
    this.setClassBodyKind();
    this.classBaseAngleDepth = this.angleDepth;
    this.classBaseBracketDepth = this.bracketDepth;
    this.classBaseParenDepth = this.parenKinds.length;
    this.setTokenState(false, true, false);
    this.pendingAsyncFunction = false;
  }

  setClassBodyKind(): void {
    if (this.isStatementStart || this.exportState !== 'none') {
      this.classBodyKind = 'class-declaration';
      return;
    }
    this.classBodyKind = 'class-expression';
  }

  consumeControlKeyword(): void {
    this.pendingParenKind = 'control';
    this.pendingBraceKind = 'control';
    this.setTokenState(false, true, false);
    this.pendingAsyncFunction = false;
  }

  consumeBlockKeyword(): void {
    this.pendingBraceKind = 'control';
    this.setTokenState(false, true, false);
    this.pendingAsyncFunction = false;
  }

  consumeValueKeyword(kind: RegexIdentifierKind): void {
    if (kind === 'value') {
      this.afterValue();
      return;
    }
    if (kind === 'export') {
      this.exportState = 'export';
      this.setExpressionStart();
      return;
    }
    this.consumeOtherValueKeyword(kind);
  }

  consumeOtherValueKeyword(kind: RegexIdentifierKind): void {
    if (kind === 'default') {
      this.consumeDefaultKeyword();
      return;
    }
    if (kind === 'async') {
      this.consumeAsyncKeyword();
      return;
    }
    this.consumeExpressionKeyword(kind);
  }

  consumeAsyncKeyword(): void {
    this.pendingAsyncFunction = true;
    this.setTokenState(this.isStatementStart, false, true);
  }

  consumeExpressionKeyword(kind: RegexIdentifierKind): void {
    this.setExpressionStart();
    if (kind === 'break' || kind === 'return') {
      this.isStatementEndAllowed = true;
    }
  }

  consumeDefaultKeyword(): void {
    if (this.exportState === 'export') {
      this.exportState = 'default';
      this.isStatementStart = true;
      this.pendingBraceKind = 'object';
    } else {
      this.setExpressionStart();
    }
    this.setTokenState(this.isStatementStart, true, false);
    this.pendingAsyncFunction = false;
  }

  consumeOpeningDelimiter(charCode: number): void {
    if (charCode === CHAR_CODE_PAREN_OPEN) {
      this.openParen();
    } else if (charCode === CHAR_CODE_BRACKET_OPEN) {
      this.openBracket();
    } else {
      this.openBrace();
    }
    this.isAfterPropertyAccess = false;
    this.setTokenState(true, true, false);
    this.pendingAsyncFunction = false;
  }

  openParen(): void {
    const parenKind = this.resolveParenKind();
    this.parenKinds.push(parenKind);
    this.storeParenBody(parenKind);
    this.pendingParenKind = 'regular';
    this.pendingBraceKind = undefined;
  }

  resolveParenKind(): ParenKind {
    return this.pendingParenKind;
  }

  storeParenBody(parenKind: ParenKind): void {
    if (parenKind === 'function') {
      this.parenBodyKinds.push(this.pendingFunctionBodyKind);
      this.pendingFunctionBodyKind = undefined;
    } else if (parenKind === 'method') {
      this.parenBodyKinds.push('method');
    } else {
      this.parenBodyKinds.push(undefined);
    }
  }

  openBracket(): void {
    this.bracketDepth += SINGLE_CHARACTER_LENGTH;
    this.pendingBraceKind = undefined;
  }

  openBrace(): void {
    const classBodyKind = this.resolveClassBody();
    const functionBodyKind = this.resolveFunctionBody();
    const braceKind = this.resolveBraceKind(classBodyKind, functionBodyKind);
    this.braceKinds.push(braceKind);
    if (classBodyKind !== undefined) {
      this.clearClassBody();
    }
    if (functionBodyKind !== undefined) {
      this.clearFunctionBody();
    }
    this.pendingBraceKind = undefined;
  }

  clearClassBody(): void {
    this.classBodyKind = undefined;
    this.exportState = 'none';
  }

  clearFunctionBody(): void {
    this.pendingFunctionBodyKind = undefined;
    this.exportState = 'none';
  }

  resolveBraceKind(
    classBodyKind: RegexBraceKind | undefined,
    functionBodyKind: FunctionBodyKind | undefined,
  ): RegexBraceKind {
    if (classBodyKind !== undefined) {
      return classBodyKind;
    }
    if (functionBodyKind !== undefined) {
      return functionBodyKind;
    }
    if (this.pendingBraceKind !== undefined) {
      return this.pendingBraceKind;
    }
    return DEFAULT_BRACE_KINDS[Number(this.isStatementStart)];
  }

  resolveFunctionBody(): FunctionBodyKind | undefined {
    if (this.angleDepth !== this.functionBaseAngleDepth) {
      return undefined;
    }
    return this.pendingFunctionBodyKind;
  }

  resolveClassBody(): RegexBraceKind | undefined {
    const isAtClassBody =
      this.classBodyKind !== undefined &&
      this.parenKinds.length === this.classBaseParenDepth &&
      this.bracketDepth === this.classBaseBracketDepth &&
      this.angleDepth === this.classBaseAngleDepth;
    if (isAtClassBody) {
      return this.classBodyKind;
    }
    return undefined;
  }

  consumeClosingDelimiter(charCode: number): void {
    if (charCode === CHAR_CODE_PAREN_CLOSE) {
      this.closeParen();
    } else if (charCode === CHAR_CODE_BRACKET_CLOSE) {
      this.closeBracket();
    } else {
      this.closeBrace();
    }
    this.isAfterPropertyAccess = false;
    this.hasLineTerminator = false;
  }

  closeParen(): void {
    const parenKind = this.parenKinds.pop() ?? 'regular';
    const bodyKind = this.parenBodyKinds.pop();
    this.closeParenKind(parenKind, bodyKind);
  }

  closeParenKind(parenKind: ParenKind, bodyKind: MethodBodyKind | undefined): void {
    if (parenKind === 'function') {
      this.closeFunctionKind(bodyKind);
      return;
    }
    if (parenKind === 'method') {
      this.closeMethodParen();
      return;
    }
    if (parenKind === 'control') {
      this.closeControlParen();
      return;
    }
    this.afterValue();
  }

  closeFunctionKind(bodyKind: MethodBodyKind | undefined): void {
    if (bodyKind === undefined) {
      this.afterValue();
      return;
    }
    this.closeFunctionParen(bodyKind);
  }

  closeFunctionParen(bodyKind: MethodBodyKind): void {
    if (bodyKind === 'method') {
      this.pendingFunctionBodyKind = undefined;
    } else {
      this.pendingFunctionBodyKind = bodyKind;
    }
    this.pendingBraceKind = bodyKind;
    this.setTokenState(this.isStatementStart, false, false);
  }

  closeMethodParen(): void {
    this.pendingBraceKind = 'method';
    this.setTokenState(this.isStatementStart, false, false);
  }

  closeControlParen(): void {
    this.pendingBraceKind = 'control';
    this.setTokenState(this.isStatementStart, true, false);
  }

  closeBracket(): void {
    this.bracketDepth = Math.max(0, this.bracketDepth - SINGLE_CHARACTER_LENGTH);
    this.afterValue();
  }

  closeBrace(): void {
    const braceKind = this.braceKinds.pop() ?? 'block';
    const isBoundary = isStatementBoundaryBrace(braceKind);
    this.setTokenState(isBoundary, isBoundary, true);
    this.pendingBraceKind = undefined;
    if (braceKind === this.pendingFunctionBodyKind) {
      this.pendingFunctionBodyKind = undefined;
    }
    this.exportState = 'none';
  }

  consumeDOT(tokenLength: number): void {
    if (tokenLength === ELLIPSIS_LENGTH) {
      this.setExpressionStart();
      return;
    }
    this.isAfterPropertyAccess = true;
    this.setTokenState(false, false, false);
    this.pendingAsyncFunction = false;
  }

  consumeArrow(): void {
    this.pendingBraceKind = 'arrow';
    this.pendingAsyncFunction = false;
    this.isAfterPropertyAccess = false;
    this.setTokenState(false, true, false);
  }

  consumeOperator(source: string, index: number, charCode: number): number {
    const nextCode = source.charCodeAt(index + SINGLE_CHARACTER_LENGTH);
    const prefixLength = this.consumeOperatorPrefix(charCode, nextCode);
    if (prefixLength !== undefined) {
      return prefixLength;
    }
    if (this.consumeHeaderOperator(charCode)) {
      return SINGLE_CHARACTER_LENGTH;
    }
    this.setExpressionStart();
    this.pendingAsyncFunction = false;
    return SINGLE_CHARACTER_LENGTH;
  }

  consumeOperatorPrefix(charCode: number, nextCode: number): number | undefined {
    if (charCode === CHAR_CODE_EQUALS && nextCode === CHAR_CODE_GREATER_THAN) {
      this.consumeArrow();
      return PAIR_OPERATOR_LENGTH;
    }
    if (charCode === CHAR_CODE_SEMICOLON) {
      this.finishStatement();
      return SINGLE_CHARACTER_LENGTH;
    }
    if ((charCode === CHAR_CODE_PLUS || charCode === CHAR_CODE_MINUS) && nextCode === charCode) {
      this.consumeIncrement();
      return PAIR_OPERATOR_LENGTH;
    }
    return undefined;
  }

  consumeIncrement(): void {
    if (this.shouldStartREGEX) {
      this.setExpressionStart();
      return;
    }
    this.afterValue();
  }

  consumeHeaderOperator(charCode: number): boolean {
    const hasHeader =
      this.pendingFunctionBodyKind !== undefined || this.classBodyKind !== undefined;
    const isAngle = charCode === CHAR_CODE_LESS_THAN || charCode === CHAR_CODE_GREATER_THAN;
    if (!hasHeader || (!isAngle && charCode !== CHAR_CODE_COLON)) {
      return false;
    }
    if (isAngle) {
      this.consumeAngle(charCode);
    }
    this.setTokenState(this.isStatementStart, true, false);
    this.pendingAsyncFunction = false;
    return true;
  }

  consumeAngle(charCode: number): void {
    if (charCode === CHAR_CODE_LESS_THAN) {
      this.angleDepth += SINGLE_CHARACTER_LENGTH;
      return;
    }
    this.angleDepth = Math.max(0, this.angleDepth - SINGLE_CHARACTER_LENGTH);
  }

  finishStatement(): void {
    this.isAfterPropertyAccess = false;
    this.setTokenState(true, true, false);
    this.pendingAsyncFunction = false;
    this.pendingBraceKind = undefined;
    this.pendingFunctionBodyKind = undefined;
    this.classBodyKind = undefined;
    this.exportState = 'none';
  }
}
