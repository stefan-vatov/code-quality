type LineLengthViolation = {
  line: number;
  length: number;
};

const DEFAULT_MAX_LENGTH = 150;
const URL_PATTERN = /https?:\/\//;

export default function findLongLines(
  source: string,
  maxLength = DEFAULT_MAX_LENGTH,
): LineLengthViolation[] {
  const violations: LineLengthViolation[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length <= maxLength || URL_PATTERN.test(line)) {
      continue;
    }
    violations.push({ line: index + 1, length: line.length });
  }

  return violations;
}
