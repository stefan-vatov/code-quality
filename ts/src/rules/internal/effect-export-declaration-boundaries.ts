import { findMatchingBrace } from './effect-source-scan';
import { findModuleStatementEnd } from './effect-module-source-index';

export type BraceDeclarationKind = 'class' | 'function' | 'interface';

interface BodyCandidate {
  bodyStart: number;
  nextIndex: number;
}

const ASCII_CHARACTER_COUNT = 128;
const CHAR_CODE_SPACE = 32;
const ANGLE_DEPTH_UNIT = 16_777_216;
const BRACE_DEPTH_UNIT = 65_536;
const BRACKET_DEPTH_UNIT = 256;
const PAREN_DEPTH_UNIT = 1;
const NON_ANGLE_DEPTH_MASK = ANGLE_DEPTH_UNIT - 1;
const ANGLE_OPEN_CODE = 60;
const ANGLE_CLOSE_CODE = 62;
const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const delimiterDepthDeltas = new Int32Array(ASCII_CHARACTER_COUNT);
delimiterDepthDeltas[CHAR_CODE_PAREN_OPEN] = PAREN_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_PAREN_CLOSE] = -PAREN_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_OPEN] = BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_CLOSE] = -BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACE_OPEN] = BRACE_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACE_CLOSE] = -BRACE_DEPTH_UNIT;

export const braceDeclarationKind = (declarationText: string): BraceDeclarationKind => {
  if (/\bfunction\b/.test(declarationText)) {
    return 'function';
  }
  if (/\bclass\b/.test(declarationText)) {
    return 'class';
  }
  return 'interface';
};

const nextNonWhitespaceIndex = (source: string, startIndex: number): number => {
  const sourceLength = source.length;
  let index = startIndex;
  while (index < sourceLength && source.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};

const isFunctionTypeContinuation = (source: string, braceEnd: number): boolean => {
  const nextIndex = nextNonWhitespaceIndex(source, braceEnd + 1);
  return '>&|?:,[{'.includes(source[nextIndex]);
};

export const advanceDepths = (depths: number, charCode: number): number => {
  if (charCode === ANGLE_OPEN_CODE && (depths & NON_ANGLE_DEPTH_MASK) === 0) {
    return depths + ANGLE_DEPTH_UNIT;
  }
  if (charCode === ANGLE_CLOSE_CODE && depths >= ANGLE_DEPTH_UNIT) {
    return depths - ANGLE_DEPTH_UNIT;
  }
  return depths + (delimiterDepthDeltas[charCode] ?? 0);
};

const bodyCandidate = (
  source: string,
  code: string,
  index: number,
  kind: BraceDeclarationKind,
): BodyCandidate => {
  const braceEnd = findMatchingBrace(source, index);
  if (braceEnd === -1) {
    return { bodyStart: -1, nextIndex: code.length };
  }
  if (kind === 'function' && isFunctionTypeContinuation(code, braceEnd)) {
    return { bodyStart: -1, nextIndex: braceEnd + 1 };
  }
  return { bodyStart: index, nextIndex: index };
};

const nextTopLevelBraceIndex = (code: string, startIndex: number): number => {
  let depths = 0;
  let index = startIndex;
  while (index < code.length) {
    if (code.charCodeAt(index) === CHAR_CODE_BRACE_OPEN && depths === 0) {
      return index;
    }
    depths = advanceDepths(depths, code.charCodeAt(index));
    index += 1;
  }
  return -1;
};

export const declarationBodyStart = (
  source: string,
  code: string,
  startIndex: number,
  kind: BraceDeclarationKind,
): number => {
  let index = startIndex;
  while (index < code.length) {
    const braceStart = nextTopLevelBraceIndex(code, index);
    if (braceStart === -1) {
      return -1;
    }
    const candidate = bodyCandidate(source, code, braceStart, kind);
    if (candidate.bodyStart !== -1) {
      return candidate.bodyStart;
    }
    index = candidate.nextIndex;
  }
  return -1;
};

export const declarationWithBraceBody = (
  source: string,
  code: string,
  startIndex: number,
  declarationText: string,
): string | undefined => {
  const statementEnd = findModuleStatementEnd(source, code, startIndex);
  const bodyStart = declarationBodyStart(
    source,
    code,
    startIndex,
    braceDeclarationKind(declarationText),
  );
  if (statementEnd < bodyStart || bodyStart === -1) {
    return source.slice(startIndex, statementEnd + 1);
  }
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    return undefined;
  }
  return source.slice(startIndex, bodyEnd + 1);
};
