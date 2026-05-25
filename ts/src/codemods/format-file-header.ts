/* -------------------------------------------------------------------------- */
/*    Codemod for rendering module-level file comments as divider headers.    */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
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

const skipWhitespace = (source: string, start: number): number =>
  pipe(
    Array.range(start, source.length),
    Array.reduce(
      { cursor: start, isDone: false },
      (state, cursor): { cursor: number; isDone: boolean } => {
        if (state.isDone) {
          return state;
        }
        if (cursor >= source.length || !/\s/u.test(source[cursor] ?? '')) {
          return { cursor, isDone: true };
        }
        return { cursor: cursor + 1, isDone: false };
      },
    ),
    (state): number => state.cursor,
  );

const skipShebang = (source: string): number =>
  pipe(
    Option.some(source),
    Option.filter((value): boolean => value.startsWith('#!')),
    Option.map((value): number => value.indexOf('\n')),
    Option.map((newline): number => {
      if (newline === -1) {
        return source.length;
      }
      return newline + 1;
    }),
    Option.getOrElse((): number => 0),
  );

const leadingContentPosition = (source: string): number =>
  skipWhitespace(source, skipShebang(source));

const cleanJSDocLine = (line: string): string =>
  line
    .trim()
    .replace(/^\*\s?/u, '')
    .trim();

const headerText = (body: string): string | undefined => {
  const lines = pipe(
    body.split('\n'),
    Array.map(cleanJSDocLine),
    Array.filter((line): boolean => line.length > 0 && !tagPattern.test(line)),
  );
  const summary = lines.join(' ');
  return pipe(Option.fromNullable(summary || undefined), Option.getOrUndefined);
};

const isDeclarationAfterHeader = (source: string, headerEnd: number): boolean =>
  declarationStartPattern.test(source.slice(headerEnd).trimStart());

const lineEnd = (source: string, start: number): number =>
  pipe(
    Option.some(source.indexOf('\n', start)),
    Option.map((newline): number => {
      if (newline === -1) {
        return source.length;
      }
      return newline;
    }),
    Option.getOrElse((): number => source.length),
  );

const nextLineStart = (source: string, start: number): number =>
  pipe(
    Option.some(source.indexOf('\n', start)),
    Option.map((newline): number => {
      if (newline === -1) {
        return source.length;
      }
      return newline + 1;
    }),
    Option.getOrElse((): number => source.length),
  );

const dividerTextLine = (line: string): string =>
  line.slice(dividerTextPrefix.length, -dividerTextSuffix.length).trim();

const isSOLIDDividerLine = (line: string): boolean => {
  if (!line.startsWith('/* ') || !line.endsWith(' */')) {
    return false;
  }
  const inner = dividerTextLine(line);
  return inner.length > 0 && isDividerFiller(inner);
};

const isDividerFiller = (text: string): boolean =>
  text.length === 0 ||
  pipe(
    Array.range(0, text.length - 1),
    Array.every((index): boolean => text.charAt(index) === '-'),
  );

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

const dividerHeaderReplacement = (source: string, start: number): Replacement | undefined =>
  pipe(
    Option.fromNullable(collectDividerHeader(source, start)),
    Option.filter((header): boolean => header.text.length > 0),
    Option.map(
      (header): Replacement => ({
        end: header.end,
        text: formatMainHeader(header.text),
      }),
    ),
    Option.getOrUndefined,
  );

const jsdocHeaderReplacement = (source: string, start: number): Replacement | undefined => {
  if (!source.startsWith('/**', start)) {
    return undefined;
  }

  const close = source.indexOf('*/', start + jsdocOpenLength);
  if (close === -1 || isDeclarationAfterHeader(source, close + jsdocCloseLength)) {
    return undefined;
  }

  return pipe(
    Option.fromNullable(headerText(source.slice(start + jsdocOpenLength, close))),
    Option.map(
      (text): Replacement => ({
        end: close + jsdocCloseLength,
        text: formatMainHeader(text),
      }),
    ),
    Option.getOrUndefined,
  );
};

const generatedHeaderReplacement = (
  text: string | undefined,
  start: number,
): Replacement | undefined =>
  pipe(
    Option.fromNullable(text),
    Option.filter((value): boolean => value.length > 0),
    Option.map(
      (value): Replacement => ({
        end: start,
        text: `${formatMainHeader(value)}\n`,
      }),
    ),
    Option.getOrUndefined,
  );

const applyHeaderReplacement = (source: string, start: number, replacement: Replacement): string =>
  `${source.slice(0, start)}${replacement.text}${source.slice(replacement.end)}`;

const headerReplacement = (
  source: string,
  start: number,
  generatedDescription: string | undefined,
): Replacement | undefined =>
  pipe(
    Option.fromNullable(dividerHeaderReplacement(source, start)),
    Option.orElse(() => Option.fromNullable(jsdocHeaderReplacement(source, start))),
    Option.orElse(() =>
      Option.fromNullable(generatedHeaderReplacement(generatedDescription, start)),
    ),
    Option.getOrUndefined,
  );

/**
 * Rewrites or inserts the file-level purpose header in the project divider style.
 *
 * @internal
 */
export const formatFileHeaderComment = (source: string, generatedDescription?: string): string => {
  const start = leadingContentPosition(source);
  return pipe(
    Option.fromNullable(headerReplacement(source, start, generatedDescription)),
    Option.match({
      onNone: (): string => source,
      onSome: (replacement): string => applyHeaderReplacement(source, start, replacement),
    }),
  );
};
