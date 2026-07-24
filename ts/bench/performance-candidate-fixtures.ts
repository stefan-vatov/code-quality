export type CandidateShape = 'candidate-free' | 'early-candidate' | 'late-candidate';

export interface CandidateSubsystem {
  candidate: string;
  name: string;
  ruleName: string;
}

const fillerStatement = (index: number): string => `const value${index} = identity(${index});`;

export const candidateSource = (
  subsystem: CandidateSubsystem,
  shape: CandidateShape,
  scale: number,
  sample = 0,
): string => {
  const body = Array.from({ length: scale }, (_, index): string => fillerStatement(index)).join(
    '\n',
  );
  const early = shape === 'early-candidate' ? subsystem.candidate : '';
  const late = shape === 'late-candidate' ? subsystem.candidate : '';
  return `import { Effect } from "effect";
declare const identity: <Value>(value: Value) => Value;
${early}
${body}
${late}
${'\n'.repeat(sample + 1)}`;
};
