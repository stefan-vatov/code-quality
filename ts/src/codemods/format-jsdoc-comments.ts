/**
 * Codemod for normalizing generated JSDoc comment aesthetics.
 *
 * @internal
 */
import { formatJSDoc } from './comment-format';

const tagPattern = /^@\S+/;
const releaseTagPattern = /^@(?:internal|public|experimental|beta|alpha)\b/;
const inlineTagPattern = /\s+(@\S+)/u;
const blockCommentOpenLength = '/**'.length;
const blockCommentCloseOffset = -'*/'.length;

const cleanJSDocLine = (line: string): string =>
  line
    .trim()
    .replace(/^\*\s?/u, '')
    .trim();

const splitInlineTags = (line: string): string[] => {
  const tagStart = inlineTagPattern.exec(line);
  if (!tagStart?.index) {
    return [line];
  }
  return [
    line.slice(0, tagStart.index).trim(),
    ...splitInlineTags(line.slice(tagStart.index).trim()),
  ].filter(Boolean);
};

const parseJSDoc = (body: string): { summary: string; tags: string[] } | undefined => {
  const rawLines = body
    .split('\n')
    .map(cleanJSDocLine)
    .filter((line): boolean => line.length > 0);
  const lines = rawLines.flatMap(splitInlineTags).flatMap((line): string[] => {
    const [tag] = line.split(/\s+/u);
    if (tag && releaseTagPattern.test(tag) && line.length > tag.length) {
      return [tag, line.slice(tag.length).trim()];
    }
    return [line];
  });
  if (lines.length === 0) {
    return undefined;
  }

  const tags = lines.filter((line): boolean => tagPattern.test(line));
  const summary = lines.filter((line): boolean => !tagPattern.test(line)).join(' ');
  if (!summary) {
    return undefined;
  }
  return { summary, tags };
};

const formatParsedJSDoc = (match: string, body: string): string => {
  const parsed = parseJSDoc(body);
  if (!parsed) {
    return match;
  }
  return formatJSDoc(parsed).trimEnd();
};

const quotedStringEnd = (source: string, start: number, quote: string): number => {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
    } else if (source[cursor] === quote) {
      return cursor + 1;
    } else {
      cursor++;
    }
  }
  return source.length;
};

const lineCommentEnd = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  if (newline === -1) {
    return source.length;
  }
  return newline + 1;
};

const blockCommentEnd = (source: string, start: number): number => {
  const close = source.indexOf('*/', start + 2);
  if (close === -1) {
    return source.length;
  }
  return close + 2;
};

const replacementAt = (source: string, start: number): { end: number; text: string } => {
  const end = blockCommentEnd(source, start);
  const match = source.slice(start, end);
  return {
    end,
    text: formatParsedJSDoc(match, match.slice(blockCommentOpenLength, blockCommentCloseOffset)),
  };
};

const skippedEnd = (source: string, start: number): number | undefined => {
  const char = source[start];
  const nextChar = source[start + 1];
  if (char === "'" || char === '"' || char === '`') {
    return quotedStringEnd(source, start, char);
  }
  if (char === '/' && nextChar === '/') {
    return lineCommentEnd(source, start);
  }
  if (char === '/' && nextChar === '*' && source[start + 2] !== '*') {
    return blockCommentEnd(source, start);
  }
  return undefined;
};

/**
 * Normalizes generated JSDoc comments to classic multi-line formatting.
 *
 * @internal
 */
export const formatJSDocComments = (source: string): string => {
  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    const step = formatStep(source, cursor);
    output += step.text;
    cursor = step.end;
  }
  return output;
};

const formatStep = (source: string, cursor: number): { end: number; text: string } => {
  const nextEnd = skippedEnd(source, cursor);
  if (nextEnd !== undefined) {
    return { end: nextEnd, text: source.slice(cursor, nextEnd) };
  }
  if (source.startsWith('/**', cursor)) {
    return replacementAt(source, cursor);
  }
  return { end: cursor + 1, text: source[cursor] ?? '' };
};
