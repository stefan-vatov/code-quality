/* -------------------------------------------------------------------------- */
/*       Backward-compatible local runner for TypeScript codemod fixes.       */
/* -------------------------------------------------------------------------- */
import { Array, Effect, pipe } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { codemodFix } from '../codemod-fix/index';

export {
  applyCodemodFixToFile as applyCodemodsToFile,
  applyCodemodFixToSource as applyCodemodsToSource,
  codemodFix as run,
  sourceFilesUnder,
} from '../codemod-fix/index';

const defaultPaths = ['ts/src'] as const;

const selectedPaths = pipe(process.argv.slice(2), (paths): readonly string[] => {
  if (Array.isNonEmptyReadonlyArray(paths)) {
    return paths;
  }
  return defaultPaths;
});

type CodemodFixResult = ReturnType<typeof codemodFix>;

const applyCodemodFix = Effect.sync(() => codemodFix({ paths: selectedPaths }));

const writeCodemodSummary = (result: CodemodFixResult): Effect.Effect<void> => {
  const message = `Applied TypeScript codemods to ${result.changedFiles.length} file(s).\n`;
  return Effect.sync(() => process.stdout.write(message));
};

const program = pipe(applyCodemodFix, Effect.tap(writeCodemodSummary));

NodeRuntime.runMain(program);
