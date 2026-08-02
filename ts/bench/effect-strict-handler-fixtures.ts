export const LARGE_SOURCE_LINE_COUNT = 3_000;
export const SCALING_LINE_COUNTS = [750, 1_500, LARGE_SOURCE_LINE_COUNT] as const;
export const HANDLER_CANDIDATE_INTERVAL = 600;

export type HandlerCandidateDensity = 'dense' | 'sparse';

export interface StrictHandlerSourceOptions {
  density: HandlerCandidateDensity;
  hasLastLineViolation: boolean;
  seed?: number;
}

const HANDLER_CANDIDATE_NAMES = ['handler', 'route', 'loader', 'action'] as const;
const handlerAssignment = (index: number, seed: number): string => {
  const name = HANDLER_CANDIDATE_NAMES[index % HANDLER_CANDIDATE_NAMES.length];
  return `server.${name} = value${seed}_${index};`;
};

const safeSourceLine = (index: number, density: HandlerCandidateDensity, seed: number): string => {
  const hasHandlerCandidate =
    density === 'dense' || index % HANDLER_CANDIDATE_INTERVAL === HANDLER_CANDIDATE_INTERVAL - 1;
  if (hasHandlerCandidate) {
    return handlerAssignment(index, seed);
  }
  return `const value${seed}_${index} = numerator / denominator;`;
};

export const createStrictHandlerSource = (
  lineCount: number,
  { density, hasLastLineViolation, seed = 0 }: StrictHandlerSourceOptions,
): string =>
  Array.from({ length: lineCount }, (_, index): string => {
    if (hasLastLineViolation && index === lineCount - 1) {
      return 'server.handler = () => Effect.runSync(program);';
    }
    return safeSourceLine(index, density, seed);
  }).join('\n');
