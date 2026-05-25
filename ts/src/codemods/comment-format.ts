/* -------------------------------------------------------------------------- */
/*          Reusable comment formatting helpers for codemod output.           */
/* -------------------------------------------------------------------------- */
import { Array, Number, Option, pipe } from 'effect';

interface JSDocInput {
  summary: string;
  tags?: readonly string[];
}

const dividerLength = 80;
const dividerFiller = '-';
const jsdocTextWidth = 100;
const blockLeft = '/* ';
const blockRight = ' */';
const jsdocOpen = '/**';
const jsdocClose = ' */';

const repeat = (value: string, count: number): string => value.repeat(Number.max(0, count));

const dividerInnerWidth = (): number => dividerLength - blockLeft.length - blockRight.length;

const solidDividerLine = (): string =>
  `${blockLeft}${repeat(dividerFiller, dividerInnerWidth())}${blockRight}`;

const centeredText = (text: string, width: number): string => {
  const remaining = Number.max(0, width - text.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `${repeat(' ', left)}${text}${repeat(' ', right)}`;
};

const capitalizedDividerText = (text: string): string => {
  const trimmed = text.trimStart();
  const indent = text.slice(0, text.length - trimmed.length);
  return `${indent}${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
};

const centeredDividerText = (text: string): string =>
  centeredText(capitalizedDividerText(text), dividerInnerWidth());

const dividerTextLines = (text: string): string[] => wrapTextToWidth(text, dividerInnerWidth());

const nextWrappedLine = (line: string, word: string): string =>
  pipe(
    Option.fromNullable(line || undefined),
    Option.match({
      onNone: (): string => word,
      onSome: (value): string => `${value} ${word}`,
    }),
  );

const wrapText = (text: string): string[] => wrapTextToWidth(text, jsdocTextWidth);

const wrapTextToWidth = (text: string, width: number): string[] => {
  if (text.length <= width) {
    return [text];
  }

  const wrapped = pipe(
    text.split(' '),
    Array.reduce(
      { line: '', lines: [] as string[] },
      (state, word): { line: string; lines: string[] } =>
        appendWrappedWordToWidth(state, word, width),
    ),
  );
  return pipe(
    Option.fromNullable(wrapped.line || undefined),
    Option.match({
      onNone: (): string[] => wrapped.lines,
      onSome: (line): string[] => Array.append(wrapped.lines, line),
    }),
  );
};

const appendWrappedWordToWidth = (
  state: { line: string; lines: string[] },
  word: string,
  width: number,
): { line: string; lines: string[] } => {
  const nextLine = nextWrappedLine(state.line, word);
  if (nextLine.length > width && state.line) {
    return { line: word, lines: Array.append(state.lines, state.line) };
  }
  return { ...state, line: nextLine };
};

const pushJSDocTextLines = (lines: string[], text: string): void => {
  pipe(
    wrapText(text),
    Array.map((wrappedLine): number => lines.push(` * ${wrappedLine}`)),
  );
};

/**
 * Formats a classic multi-line JSDoc block.
 *
 * @internal
 */
export const formatJSDoc = (input: JSDocInput): string => {
  const lines = [jsdocOpen];
  pushJSDocTextLines(lines, input.summary);
  pipe(
    Option.fromNullable(input.tags),
    Option.filter((tags): boolean => tags.length > 0),
    Option.map((tags): void => {
      lines.push(' *');
      pipe(
        tags,
        Array.map((tag): void => pushJSDocTextLines(lines, tag)),
      );
    }),
  );
  lines.push(jsdocClose);
  return `${lines.join('\n')}\n`;
};

/**
 * Formats a three-line fixed-width section header.
 *
 * @internal
 */
export const formatMainHeader = (text: string): string =>
  [
    solidDividerLine(),
    ...dividerTextLines(text).map(
      (line): string => `${blockLeft}${centeredDividerText(line)}${blockRight}`,
    ),
    solidDividerLine(),
  ].join('\n');

/**
 * Formats a one-line fixed-width section header.
 *
 * @internal
 */
export const formatSubheader = (text: string): string => {
  const words = ` ${text} `;
  const remaining = Number.max(0, dividerInnerWidth() - words.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `${blockLeft}${repeat(dividerFiller, left)}${words}${repeat(dividerFiller, right)}${blockRight}`;
};
