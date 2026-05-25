/* -------------------------------------------------------------------------- */
/*          Reusable comment formatting helpers for codemod output.           */
/* -------------------------------------------------------------------------- */

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

const repeat = (value: string, count: number): string => value.repeat(Math.max(0, count));

const dividerInnerWidth = (): number => dividerLength - blockLeft.length - blockRight.length;

const solidDividerLine = (): string =>
  `${blockLeft}${repeat(dividerFiller, dividerInnerWidth())}${blockRight}`;

const centeredText = (text: string, width: number): string => {
  const remaining = Math.max(0, width - text.length);
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

const nextWrappedLine = (line: string, word: string): string => {
  if (line) {
    return `${line} ${word}`;
  }
  return word;
};

const wrapText = (text: string): string[] => wrapTextToWidth(text, jsdocTextWidth);

const wrapTextToWidth = (text: string, width: number): string[] => {
  if (text.length <= width) {
    return [text];
  }

  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    line = appendWrappedWordToWidth(lines, line, word, width);
  }
  if (line) {
    lines.push(line);
  }
  return lines;
};

const appendWrappedWordToWidth = (
  lines: string[],
  line: string,
  word: string,
  width: number,
): string => {
  const nextLine = nextWrappedLine(line, word);
  if (nextLine.length > width && line) {
    lines.push(line);
    return word;
  }
  return nextLine;
};

const pushJSDocTextLines = (lines: string[], text: string): void => {
  for (const wrappedLine of wrapText(text)) {
    lines.push(` * ${wrappedLine}`);
  }
};

/**
 * Formats a classic multi-line JSDoc block.
 *
 * @internal
 */
export const formatJSDoc = (input: JSDocInput): string => {
  const lines = [jsdocOpen];
  pushJSDocTextLines(lines, input.summary);
  if (input.tags && input.tags.length > 0) {
    lines.push(' *');
    for (const tag of input.tags) {
      pushJSDocTextLines(lines, tag);
    }
  }
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
  const remaining = Math.max(0, dividerInnerWidth() - words.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `${blockLeft}${repeat(dividerFiller, left)}${words}${repeat(dividerFiller, right)}${blockRight}`;
};
