/* -------------------------------------------------------------------------- */
/*    Codemod for rendering module-level file comments as divider headers.    */
/* -------------------------------------------------------------------------- */
import { formatMainHeader } from './comment-format';

const jsdocOpenLength = '/**'.length;
const jsdocCloseLength = '*/'.length;
const tagPattern = /^@\S+/;
const dividerTextPrefix = '/*';
const dividerTextSuffix = '*/';
const declarationStartPattern =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|interface|type|enum|const|let|var)\b/u;

interface Replacement {
  end: number;
  text: string;
}

interface DividerHeader {
  end: number;
  text: string;
}

const skipWhitespace = (source: string, start: number): number => {
  let cursor = start;
  while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) {
    cursor++;
  }
  return cursor;
};

const skipShebang = (source: string): number => {
  if (!source.startsWith('#!')) {
    return 0;
  }
  const newline = source.indexOf('\n');
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const leadingContentPosition = (source: string): number =>
  skipWhitespace(source, skipShebang(source));

const cleanJSDocLine = (line: string): string =>
  line
    .trim()
    .replace(/^\*\s?/u, '')
    .trim();

const headerText = (body: string): string | undefined => {
  const lines = body
    .split('\n')
    .map(cleanJSDocLine)
    .filter((line): boolean => line.length > 0 && !tagPattern.test(line));
  const summary = lines.join(' ');
  if (!summary) {
    return undefined;
  }
  return summary;
};

const isDeclarationAfterHeader = (source: string, headerEnd: number): boolean =>
  declarationStartPattern.test(source.slice(headerEnd).trimStart());

const lineEnd = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  if (newline === -1) {
    return source.length;
  }
  return newline;
};

const nextLineStart = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const dividerTextLine = (line: string): string =>
  line.slice(dividerTextPrefix.length, -dividerTextSuffix.length).trim();

const isSOLIDDividerLine = (line: string): boolean => {
  if (!line.startsWith('/* ') || !line.endsWith(' */')) {
    return false;
  }
  const inner = dividerTextLine(line);
  return inner.length > 0 && isDividerFiller(inner);
};

const isDividerFiller = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    if (text.charAt(index) !== '-') {
      return false;
    }
  }
  return true;
};

const dividerLineAt = (
  source: string,
  start: number,
): { end: number; line: string; next: number } => {
  const end = lineEnd(source, start);
  return {
    end,
    line: source.slice(start, end),
    next: nextLineStart(source, start),
  };
};

const collectDividerBody = (
  source: string,
  cursor: number,
  textLines: string[],
): DividerHeader | undefined => {
  if (cursor >= source.length) {
    return undefined;
  }
  const current = dividerLineAt(source, cursor);
  if (isSOLIDDividerLine(current.line)) {
    return {
      end: current.end,
      text: textLines.join(' '),
    };
  }
  textLines.push(dividerTextLine(current.line));
  return collectDividerBody(source, current.next, textLines);
};

const collectDividerHeader = (source: string, start: number): DividerHeader | undefined => {
  const first = dividerLineAt(source, start);
  if (!isSOLIDDividerLine(first.line)) {
    return undefined;
  }

  return collectDividerBody(source, first.next, []);
};

const dividerHeaderReplacement = (source: string, start: number): Replacement | undefined => {
  const header = collectDividerHeader(source, start);
  if (!header?.text) {
    return undefined;
  }

  return {
    end: header.end,
    text: formatMainHeader(header.text),
  };
};

const jsdocHeaderReplacement = (source: string, start: number): Replacement | undefined => {
  if (!source.startsWith('/**', start)) {
    return undefined;
  }

  const close = source.indexOf('*/', start + jsdocOpenLength);
  if (close === -1 || isDeclarationAfterHeader(source, close + jsdocCloseLength)) {
    return undefined;
  }

  const text = headerText(source.slice(start + jsdocOpenLength, close));
  if (!text) {
    return undefined;
  }

  return {
    end: close + jsdocCloseLength,
    text: formatMainHeader(text),
  };
};

const generatedHeaderReplacement = (
  text: string | undefined,
  start: number,
): Replacement | undefined => {
  if (!text) {
    return undefined;
  }
  return {
    end: start,
    text: `${formatMainHeader(text)}\n`,
  };
};

const applyHeaderReplacement = (source: string, start: number, replacement: Replacement): string =>
  `${source.slice(0, start)}${replacement.text}${source.slice(replacement.end)}`;

const headerReplacement = (
  source: string,
  start: number,
  generatedDescription: string | undefined,
): Replacement | undefined => {
  const replacement =
    dividerHeaderReplacement(source, start) ??
    jsdocHeaderReplacement(source, start) ??
    generatedHeaderReplacement(generatedDescription, start);
  if (!replacement) {
    return undefined;
  }
  return replacement;
};

/**
 * Rewrites or inserts the file-level purpose header in the project divider style.
 *
 * @internal
 */
export const formatFileHeaderComment = (source: string, generatedDescription?: string): string => {
  const start = leadingContentPosition(source);
  const replacement = headerReplacement(source, start, generatedDescription);
  if (!replacement) {
    return source;
  }
  return applyHeaderReplacement(source, start, replacement);
};
