/* -------------------------------------------------------------------------- */
/*       Backward-compatible local runner for TypeScript codemod fixes.       */
/* -------------------------------------------------------------------------- */
import { codemodFix } from '../codemod-fix/index';

export {
  applyCodemodFixToFile as applyCodemodsToFile,
  applyCodemodFixToSource as applyCodemodsToSource,
  codemodFix as run,
  sourceFilesUnder,
} from '../codemod-fix/index';

const defaultPaths = ['ts/src'] as const;

const paths = process.argv.slice(2);
let selectedPaths: readonly string[] = defaultPaths;
if (paths.length > 0) {
  selectedPaths = paths;
}
const result = codemodFix({ paths: selectedPaths });

process.stdout.write(`Applied TypeScript codemods to ${result.changedFiles.length} file(s).\n`);
