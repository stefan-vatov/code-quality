/* -------------------------------------------------------------------------- */
/*        Codemod for normalizing generated JSDoc comment aesthetics.         */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
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
  return pipe(
    Option.fromNullable(tagStart?.index),
    Option.filter((index): boolean => index > 0),
    Option.match({
      onNone: (): string[] => [line],
      onSome: (index): string[] =>
        pipe(
          [line.slice(0, index).trim(), ...splitInlineTags(line.slice(index).trim())],
          Array.filter((value): boolean => value.length > 0),
        ),
    }),
  );
};

const parseJSDoc = (body: string): { summary: string; tags: string[] } | undefined => {
  const lines = pipe(
    body.split('\n'),
    Array.map(cleanJSDocLine),
    Array.filter((line): boolean => line.length > 0),
    Array.flatMap(splitInlineTags),
    Array.flatMap((line): string[] => {
      const [tag] = line.split(/\s+/u);
      if (tag && releaseTagPattern.test(tag) && line.length > tag.length) {
        return [tag, line.slice(tag.length).trim()];
      }
      return [line];
    }),
  );

  return pipe(
    Option.some(lines),
    Option.filter((values): boolean => values.length > 0),
    Option.flatMap((values) => {
      const tags = pipe(
        values,
        Array.filter((line): boolean => tagPattern.test(line)),
      );
      const summary = pipe(
        values,
        Array.filter((line): boolean => !tagPattern.test(line)),
        Array.join(' '),
      );
      return pipe(
        Option.fromNullable(summary || undefined),
        Option.map((value): { summary: string; tags: string[] } => ({ summary: value, tags })),
      );
    }),
    Option.getOrUndefined,
  );
};

const formatParsedJSDoc = (match: string, body: string): string =>
  pipe(
    Option.fromNullable(parseJSDoc(body)),
    Option.match({
      onNone: (): string => match,
      onSome: (parsed): string => formatJSDoc(parsed).trimEnd(),
    }),
  );

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
  return pipe(
    Option.some(newline),
    Option.map((value): number => {
      if (value === -1) {
        return source.length;
      }
      return value + 1;
    }),
    Option.getOrElse((): number => source.length),
  );
};

const blockCommentEnd = (source: string, start: number): number => {
  const close = source.indexOf('*/', start + 2);
  return pipe(
    Option.some(close),
    Option.map((value): number => {
      if (value === -1) {
        return source.length;
      }
      return value + 2;
    }),
    Option.getOrElse((): number => source.length),
  );
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
  return pipe(
    Option.some({ char, nextChar }),
    Option.flatMap(({ char: value, nextChar: next }) => {
      if (value === "'" || value === '"' || value === '`') {
        return Option.some(quotedStringEnd(source, start, value));
      }
      if (value === '/' && next === '/') {
        return Option.some(lineCommentEnd(source, start));
      }
      if (value === '/' && next === '*' && source[start + 2] !== '*') {
        return Option.some(blockCommentEnd(source, start));
      }
      return Option.none<number>();
    }),
    Option.getOrUndefined,
  );
};

/**
 * Normalizes generated JSDoc comments to classic multi-line formatting.
 *
 * @internal
 */
export const formatJSDocComments = (source: string): string =>
  pipe(
    Array.range(0, source.length - 1),
    Array.reduce({ cursor: 0, output: '' }, (state, cursor): { cursor: number; output: string } => {
      if (cursor < state.cursor) {
        return state;
      }
      const step = formatStep(source, cursor);
      return { cursor: step.end, output: state.output + step.text };
    }),
    (state): string => state.output,
  );

const formatStep = (source: string, cursor: number): { end: number; text: string } =>
  pipe(
    Option.fromNullable(skippedEnd(source, cursor)),
    Option.match({
      onNone: (): { end: number; text: string } => {
        if (source.startsWith('/**', cursor)) {
          return replacementAt(source, cursor);
        }
        return { end: cursor + 1, text: source[cursor] ?? '' };
      },
      onSome: (nextEnd): { end: number; text: string } => ({
        end: nextEnd,
        text: source.slice(cursor, nextEnd),
      }),
    }),
  );
