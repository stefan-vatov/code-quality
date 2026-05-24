type LineLengthViolation = {
  line: number;
  length: number;
};

const DEFAULT_MAX_LENGTH = 150;

function lineContainsUrl(source: string, start: number, end: number): boolean {
  const httpIndex = source.indexOf('http://', start);
  if (httpIndex !== -1 && httpIndex < end) {
    return true;
  }

  const httpsIndex = source.indexOf('https://', start);
  return httpsIndex !== -1 && httpsIndex < end;
}

export default function findLongLines(
  source: string,
  maxLength = DEFAULT_MAX_LENGTH,
): LineLengthViolation[] {
  if (source.length <= maxLength) {
    return [];
  }

  const violations: LineLengthViolation[] = [];
  let lineStart = 0;
  let lineNumber = 1;

  while (lineStart <= source.length) {
    const newlineIndex = source.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex;
    const contentEnd =
      lineEnd > lineStart && source.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const length = contentEnd - lineStart;

    if (length > maxLength && !lineContainsUrl(source, lineStart, contentEnd)) {
      violations.push({ line: lineNumber, length });
    }

    if (newlineIndex === -1) {
      break;
    }

    lineStart = newlineIndex + 1;
    lineNumber += 1;
  }

  return violations;
}
