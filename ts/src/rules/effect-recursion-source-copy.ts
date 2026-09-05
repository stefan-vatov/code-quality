export const copyGenericArrowHeader = (
  output: string[],
  source: string,
  start: number,
  end: number,
): void => {
  const target = output;
  for (let index = start; index < end; index += 1) {
    target[index] = source[index] ?? target[index];
  }
};
