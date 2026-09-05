import { bindingPatternEnd, bindingPatternNames } from './effect-export-binding-patterns';

const CHAR_CODE_BRACE_CLOSE = 125;
const CHAR_CODE_BRACE_OPEN = 123;
const CHAR_CODE_BRACKET_CLOSE = 93;
const CHAR_CODE_BRACKET_OPEN = 91;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_LINE_FEED = 10;
const CHAR_CODE_PAREN_CLOSE = 41;
const CHAR_CODE_PAREN_OPEN = 40;
const CHAR_CODE_SEMICOLON = 59;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_AT = 64;
const CHAR_CODE_BACKTICK = 96;
const CHAR_CODE_COMMA = 44;
const CHAR_CODE_EQUALS = 61;
const CHAR_CODE_ANGLE_CLOSE = 62;
const CHAR_CODE_ANGLE_OPEN = 60;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_SINGLE_QUOTE = 39;
const CHAR_CODE_UNDERSCORE = 95;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_DIGIT_ZERO = 48;
const CHAR_CODE_DIGIT_NINE = 57;
const ASCII_CHARACTER_COUNT = 128;
const BRACE_DEPTH_UNIT = 65_536;
const BRACKET_DEPTH_UNIT = 256;
const PAREN_DEPTH_UNIT = 1;
const ANGLE_DEPTH_UNIT = 16_777_216;
const delimiterDepthDeltas = new Int32Array(ASCII_CHARACTER_COUNT);
delimiterDepthDeltas[CHAR_CODE_BRACE_OPEN] = BRACE_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACE_CLOSE] = -BRACE_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_OPEN] = BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_BRACKET_CLOSE] = -BRACKET_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_PAREN_OPEN] = PAREN_DEPTH_UNIT;
delimiterDepthDeltas[CHAR_CODE_PAREN_CLOSE] = -PAREN_DEPTH_UNIT;

const VARIABLE_DECLARATION_START = /\b(?:export\s+)?(?:declare\s+)?(?:const|let|var)\b/g;
const VARIABLE_KEYWORD = /\b(?:const|let|var)\b/;
const NAMED_DECLARATION_START = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*|` +
    String.raw`(?:export\s+)?type\s+|` +
    String.raw`(?:export\s+)?interface\s+|` +
    String.raw`(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+` +
    String.raw`)([A-Za-z_$][\w$]*)`,
  'g',
);

export interface ModuleSourceMatch extends RegExpMatchArray {
  readonly index: number;
}

export interface ModuleSourceIndex {
  readonly code: string;
  readonly modulePositions: Uint8Array;
}

export interface ModuleBindingDeclaration {
  readonly declaratorEnd: number;
  readonly declaratorStart: number;
  readonly kind: 'named' | 'variable';
  readonly match: ModuleSourceMatch;
  readonly siblingCount: number;
  readonly statementEnd: number;
  readonly statementStart: number;
  readonly variableKeywordEnd: number;
}

const moduleBindingCache = new WeakMap<
  ModuleSourceIndex,
  ReadonlyMap<string, readonly ModuleBindingDeclaration[]>
>();

const isIdentifierStart = (charCode: number): boolean =>
  (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_Z) ||
  (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_Z) ||
  charCode === CHAR_CODE_DOLLAR ||
  charCode === CHAR_CODE_UNDERSCORE;

const isIdentifierPart = (charCode: number): boolean =>
  isIdentifierStart(charCode) ||
  (charCode >= CHAR_CODE_DIGIT_ZERO && charCode <= CHAR_CODE_DIGIT_NINE);

const isLineBreak = (charCode: number): boolean =>
  charCode === CHAR_CODE_LINE_FEED || charCode === CHAR_CODE_CARRIAGE_RETURN;

const previousNonWhitespaceIndex = (code: string, startIndex: number): number => {
  let index = startIndex;
  while (index >= 0 && code.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index -= 1;
  }
  return index;
};

const nextNonWhitespaceIndex = (code: string, startIndex: number): number => {
  const codeLength = code.length;
  let index = startIndex;
  while (index < codeLength && code.charCodeAt(index) <= CHAR_CODE_SPACE) {
    index += 1;
  }
  return index;
};

const canTerminateBeforeLineBreak = (code: string, lineBreakIndex: number): boolean => {
  const previousIndex = previousNonWhitespaceIndex(code, lineBreakIndex - 1);
  if (previousIndex === -1) {
    return false;
  }
  const previousCode = code.charCodeAt(previousIndex);
  return (
    isIdentifierPart(previousCode) ||
    (previousCode >= CHAR_CODE_DIGIT_ZERO && previousCode <= CHAR_CODE_DIGIT_NINE) ||
    previousCode === CHAR_CODE_PAREN_CLOSE ||
    previousCode === CHAR_CODE_BRACKET_CLOSE ||
    previousCode === CHAR_CODE_BRACE_CLOSE ||
    previousCode === CHAR_CODE_DOUBLE_QUOTE ||
    previousCode === CHAR_CODE_SINGLE_QUOTE ||
    previousCode === CHAR_CODE_BACKTICK
  );
};

const startsModuleStatementLine = (code: string, lineBreakIndex: number): boolean => {
  const nextIndex = nextNonWhitespaceIndex(code, lineBreakIndex + 1);
  if (nextIndex >= code.length) {
    return false;
  }
  const nextCode = code.charCodeAt(nextIndex);
  return (
    isIdentifierStart(nextCode) ||
    (nextCode >= CHAR_CODE_DIGIT_ZERO && nextCode <= CHAR_CODE_DIGIT_NINE) ||
    nextCode === CHAR_CODE_AT ||
    nextCode === CHAR_CODE_BRACE_OPEN ||
    nextCode === CHAR_CODE_DOUBLE_QUOTE ||
    nextCode === CHAR_CODE_SINGLE_QUOTE
  );
};

const nextBraceDepth = (braceDepth: number, charCode: number): number => {
  if (charCode === CHAR_CODE_BRACE_OPEN) {
    return braceDepth + 1;
  }
  if (charCode === CHAR_CODE_BRACE_CLOSE && braceDepth > 0) {
    return braceDepth - 1;
  }
  return braceDepth;
};

export const createModuleSourceIndex = (code: string): ModuleSourceIndex => {
  const codeLength = code.length;
  const modulePositions = new Uint8Array(codeLength);
  let braceDepth = 0;
  for (let index = 0; index < codeLength; index += 1) {
    if (braceDepth === 0) {
      modulePositions[index] = 1;
    }
    braceDepth = nextBraceDepth(braceDepth, code.charCodeAt(index));
  }
  return { code, modulePositions };
};

export const moduleLevelMatches = (
  index: ModuleSourceIndex,
  pattern: RegExp,
): ModuleSourceMatch[] => {
  const matches: ModuleSourceMatch[] = [];
  for (const match of index.code.matchAll(pattern)) {
    if (index.modulePositions[match.index] === 1) {
      matches.push(match as ModuleSourceMatch);
    }
  }
  return matches;
};

export const findModuleStatementEnd = (
  source: string,
  code: string,
  startIndex: number,
): number => {
  const codeLength = code.length;
  let depths = 0;
  for (let index = startIndex; index < codeLength; index += 1) {
    const charCode = code.charCodeAt(index);
    if (charCode === CHAR_CODE_SEMICOLON && depths === 0) {
      return index;
    }
    if (
      isLineBreak(charCode) &&
      depths === 0 &&
      canTerminateBeforeLineBreak(code, index) &&
      startsModuleStatementLine(code, index)
    ) {
      return previousNonWhitespaceIndex(source, index - 1);
    }
    depths += delimiterDepthDeltas[charCode] ?? 0;
  }
  return previousNonWhitespaceIndex(source, source.length - 1);
};

const isTypeArgumentOpen = (code: string, index: number, hasAssignment: boolean): boolean => {
  if (!hasAssignment) {
    return true;
  }
  const previousIndex = previousNonWhitespaceIndex(code, index - 1);
  const nextIndex = nextNonWhitespaceIndex(code, index + 1);
  const previousCode = code.charCodeAt(previousIndex);
  const nextCode = code.charCodeAt(nextIndex);
  return (
    previousCode === CHAR_CODE_EQUALS ||
    ((previousIndex === index - 1 ||
      previousCode === CHAR_CODE_PAREN_CLOSE ||
      previousCode === CHAR_CODE_BRACKET_CLOSE ||
      previousCode === CHAR_CODE_ANGLE_CLOSE) &&
      (isIdentifierStart(nextCode) ||
        nextCode === CHAR_CODE_BRACE_OPEN ||
        nextCode === CHAR_CODE_BRACKET_OPEN))
  );
};

const advanceDeclaratorDepths = (
  code: string,
  index: number,
  depths: number,
  hasAssignment: boolean,
): number => {
  const charCode = code.charCodeAt(index);
  if (charCode === CHAR_CODE_ANGLE_OPEN && isTypeArgumentOpen(code, index, hasAssignment)) {
    return depths + ANGLE_DEPTH_UNIT;
  }
  if (charCode === CHAR_CODE_ANGLE_CLOSE && depths >= ANGLE_DEPTH_UNIT) {
    return depths - ANGLE_DEPTH_UNIT;
  }
  return depths + (delimiterDepthDeltas[charCode] ?? 0);
};

interface DeclaratorBoundary {
  readonly end: number;
  readonly nextStart: number;
}

const boundaryBefore = (
  code: string,
  delimiterIndex: number,
  nextStart: number,
): DeclaratorBoundary => ({
  end: previousNonWhitespaceIndex(code, delimiterIndex - 1) + 1,
  nextStart,
});

const topLevelDelimiterBoundary = (
  code: string,
  index: number,
  charCode: number,
  depths: number,
): DeclaratorBoundary | undefined => {
  if (depths !== 0) {
    return undefined;
  }
  if (charCode === CHAR_CODE_COMMA) {
    return boundaryBefore(code, index, nextNonWhitespaceIndex(code, index + 1));
  }
  if (charCode === CHAR_CODE_SEMICOLON) {
    return boundaryBefore(code, index, code.length);
  }
  return undefined;
};

const declaratorBoundary = (code: string, startIndex: number): DeclaratorBoundary => {
  let depths = 0;
  let hasAssignment = false;
  for (let index = startIndex; index < code.length; index += 1) {
    const charCode = code.charCodeAt(index);
    const boundary = topLevelDelimiterBoundary(code, index, charCode, depths);
    if (boundary !== undefined) {
      return boundary;
    }
    hasAssignment ||= charCode === CHAR_CODE_EQUALS && depths === 0;
    depths = advanceDeclaratorDepths(code, index, depths, hasAssignment);
  }
  return boundaryBefore(code, code.length, code.length);
};

interface VariableDeclarator {
  readonly end: number;
  readonly names: readonly string[];
  readonly start: number;
}

const variableDeclarators = (
  statement: string,
  keywordEnd: number,
): readonly VariableDeclarator[] => {
  const declarators: VariableDeclarator[] = [];
  let patternStart = nextNonWhitespaceIndex(statement, keywordEnd);
  while (patternStart < statement.length) {
    const patternEnd = bindingPatternEnd(statement, patternStart);
    const names = bindingPatternNames(statement, patternStart, patternEnd);
    const boundary = declaratorBoundary(statement, patternEnd);
    declarators.push({ end: boundary.end, names, start: patternStart });
    patternStart = boundary.nextStart;
  }
  return declarators;
};

const appendBindingDeclaration = (
  declarations: Map<string, ModuleBindingDeclaration[]>,
  bindingName: string,
  declaration: ModuleBindingDeclaration,
): void => {
  const existingDeclarations = declarations.get(bindingName);
  if (existingDeclarations === undefined) {
    declarations.set(bindingName, [declaration]);
    return;
  }
  existingDeclarations.push(declaration);
};

interface VariableDeclarationContext {
  readonly declaratorCount: number;
  readonly keywordEnd: number;
  readonly statementEnd: number;
}

const addVariableDeclaratorBindings = (
  declarations: Map<string, ModuleBindingDeclaration[]>,
  declarator: VariableDeclarator,
  context: VariableDeclarationContext,
  match: ModuleSourceMatch,
): void => {
  const declaration: ModuleBindingDeclaration = {
    declaratorEnd: match.index + declarator.end,
    declaratorStart: match.index + declarator.start,
    kind: 'variable',
    match,
    siblingCount: context.declaratorCount,
    statementEnd: context.statementEnd,
    statementStart: match.index,
    variableKeywordEnd: match.index + context.keywordEnd,
  };
  for (const bindingName of declarator.names) {
    appendBindingDeclaration(declarations, bindingName, declaration);
  }
};

const addVariableBindings = (
  declarations: Map<string, ModuleBindingDeclaration[]>,
  moduleIndex: ModuleSourceIndex,
  match: ModuleSourceMatch,
): void => {
  const statementEnd = findModuleStatementEnd(moduleIndex.code, moduleIndex.code, match.index);
  const statement = moduleIndex.code.slice(match.index, statementEnd + 1);
  const keywordMatch = VARIABLE_KEYWORD.exec(statement);
  if (keywordMatch === null) {
    return;
  }
  const keywordEnd = keywordMatch.index + keywordMatch[0].length;
  const declarators = variableDeclarators(statement, keywordEnd);
  const context: VariableDeclarationContext = {
    declaratorCount: declarators.length,
    keywordEnd,
    statementEnd,
  };
  for (const declarator of declarators) {
    addVariableDeclaratorBindings(declarations, declarator, context, match);
  }
};

const addNamedBinding = (
  declarations: Map<string, ModuleBindingDeclaration[]>,
  moduleIndex: ModuleSourceIndex,
  match: ModuleSourceMatch,
): void => {
  const [, bindingName] = match;
  if (bindingName === undefined) {
    return;
  }
  const statementEnd = findModuleStatementEnd(moduleIndex.code, moduleIndex.code, match.index);
  const declaration: ModuleBindingDeclaration = {
    declaratorEnd: statementEnd + 1,
    declaratorStart: match.index,
    kind: 'named',
    match,
    siblingCount: 1,
    statementEnd,
    statementStart: match.index,
    variableKeywordEnd: match.index,
  };
  appendBindingDeclaration(declarations, bindingName, declaration);
};

export const moduleBindingDeclarations = (
  moduleIndex: ModuleSourceIndex,
): ReadonlyMap<string, readonly ModuleBindingDeclaration[]> => {
  const cachedDeclarations = moduleBindingCache.get(moduleIndex);
  if (cachedDeclarations) {
    return cachedDeclarations;
  }
  const declarations = new Map<string, ModuleBindingDeclaration[]>();
  for (const match of moduleLevelMatches(moduleIndex, VARIABLE_DECLARATION_START)) {
    addVariableBindings(declarations, moduleIndex, match);
  }
  for (const match of moduleLevelMatches(moduleIndex, NAMED_DECLARATION_START)) {
    addNamedBinding(declarations, moduleIndex, match);
  }
  moduleBindingCache.set(moduleIndex, declarations);
  return declarations;
};
