import { stripCommentsAndStrings } from './effect-source-scan';

const CHAR_CODE_ANGLE_OPEN = 60;
const CHAR_CODE_SPACE = 32;

const lastVisibleIndex = (source: string): number => {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source.charCodeAt(index) > CHAR_CODE_SPACE) {
      return index;
    }
  }
  return -1;
};

const unclosedAngleClose = (
  source: string,
  code: string,
  index: number,
  lastCodeIndex: number,
  lastSourceIndex: number,
): number | undefined => {
  if (
    code.charCodeAt(index) !== CHAR_CODE_ANGLE_OPEN ||
    source.charCodeAt(index) !== CHAR_CODE_ANGLE_OPEN
  ) {
    return undefined;
  }
  const closeIndex = code.indexOf('>', index + 1);
  if (closeIndex <= index || lastCodeIndex > closeIndex || lastSourceIndex <= closeIndex) {
    return undefined;
  }
  return closeIndex;
};

const unclosedAngleStarts = (source: string, code: string): readonly number[] => {
  const starts: number[] = [];
  const lastCodeIndex = lastVisibleIndex(code);
  const lastSourceIndex = lastVisibleIndex(source);
  for (let index = 0; index < code.length; index += 1) {
    const closeIndex = unclosedAngleClose(source, code, index, lastCodeIndex, lastSourceIndex);
    if (closeIndex !== undefined) {
      starts.push(index);
      index = closeIndex;
    }
  }
  return starts;
};

const maskedSource = (source: string, starts: readonly number[]): string => {
  const masked = source.split('');
  for (const start of starts) {
    masked[start] = ' ';
  }
  return masked.join('');
};

const restoreAngleStarts = (projected: string, starts: readonly number[]): string => {
  const restored = projected.split('');
  for (const start of starts) {
    restored[start] = '<';
  }
  return restored.join('');
};

export const exportedSourceCode = (source: string): string => {
  const code = stripCommentsAndStrings(source);
  const starts = unclosedAngleStarts(source, code);
  if (starts.length === 0) {
    return code;
  }
  return restoreAngleStarts(stripCommentsAndStrings(maskedSource(source, starts)), starts);
};
