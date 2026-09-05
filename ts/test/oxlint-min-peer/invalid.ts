import { Effect } from 'effect';

void Effect.succeed(0);
const program = Effect.gen(function* () {
  yield Effect.succeed(1);
  return 1;
});
export { program };
export const handler = () => Effect.runSync(program);
