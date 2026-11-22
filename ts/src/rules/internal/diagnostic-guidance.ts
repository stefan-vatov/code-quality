import { Array, pipe } from 'effect';

interface DiagnosticInput {
  example: string;
  fix: string;
  summary: string;
}

interface RuleGuidance {
  example: string;
  fix: string;
  keys: readonly string[];
}

interface NormalizedRuleGuidance {
  example: string;
  fix: string;
  keys: readonly string[];
}

const markdownCode = (code: string): string => `\`\`\`ts\n${code}\n\`\`\``;
const effectName = ['Eff', 'ect'].join('');

const ruleGuidanceByName = [
  {
    example:
      'const User = Schema.Struct({ id: Schema.String })\nconst user = yield* Schema.decodeUnknown(User)(input)',
    fix: 'Decode untrusted data with Schema at the boundary and pass typed values inward.',
    keys: ['schema'],
  },
  {
    example:
      `it.effect("uses test services", () => ${effectName}.gen(function* () {\n` +
      `  yield* ${effectName}.provide(program, TestLayer)\n}))`,
    fix: 'Use Effect-aware tests with explicit test services, TestClock, and isolated layers.',
    keys: ['test', 'TestClock'],
  },
  {
    example:
      'class UserRepo extends Context.Tag("UserRepo")<UserRepo, Service>() {}\nexport const UserRepoLive = Layer.succeed(UserRepo, service)',
    fix: 'Move concrete service construction into named Layers and keep domain code dependent on tags.',
    keys: ['layer', 'service', 'tag'],
  },
  {
    example:
      `export const loadUser = ${effectName}.fn("loadUser")(function* (id: UserId) {\n` +
      '  return yield* UserRepo.find(id)\n})',
    fix: 'Return an Effect from library code and run it only at the configured application boundary.',
    keys: ['run', 'entrypoint', 'Promise'],
  },
  {
    example: `const fiber = yield* ${effectName}.forkScoped(worker)\nyield* Fiber.join(fiber)`,
    fix: 'Observe, join, interrupt, scope, supervise, or return every forked fiber.',
    keys: ['fiber', 'fork'],
  },
  {
    example:
      'class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}\n' +
      `yield* ${effectName}.fail(new NotFound({ id }))`,
    fix: 'Use tagged typed errors, preserve causes, and recover with specific catchTag/catchTags handlers.',
    keys: ['error', 'catch', 'fail'],
  },
  {
    example:
      `yield* call.pipe(\n  ${effectName}.timeout("5 seconds"),\n` +
      `  ${effectName}.retry(Schedule.exponential("100 millis").pipe(Schedule.jittered)),\n` +
      `  ${effectName}.withSpan("UserClient.load"),\n)`,
    fix: 'Make external effects bounded, observable, and deliberately retried when idempotent.',
    keys: ['retry', 'timeout', 'span'],
  },
  {
    example:
      `yield* ${effectName}.scoped(\n` +
      `  ${effectName}.acquireRelease(openResource, closeResource).pipe(\n` +
      `    ${effectName}.flatMap(useResource),\n  ),\n)`,
    fix: 'Scope resource lifetimes and guard scarce shared resources with Effect resource primitives.',
    keys: ['stream', 'resource', 'Semaphore'],
  },
  {
    example: `const program = ${effectName}.gen(function* () {\n  const user = yield* loadUser(id)\n  return user\n})`,
    fix: 'Use direct Effect.gen sequencing with yield* instead of nested callbacks or returned Effects.',
    keys: ['gen', 'yield', 'flatMap'],
  },
  {
    example:
      'const config = yield* Config.string("API_TOKEN")\nconst now = yield* Clock.currentTimeMillis',
    fix: 'Read environment, time, randomness, and platform APIs through Effect services.',
    keys: ['env', 'Clock', 'Random'],
  },
] satisfies readonly RuleGuidance[];

const normalizedRuleGuidanceByName = pipe(
  ruleGuidanceByName,
  Array.map(
    (guidance): NormalizedRuleGuidance => ({
      ...guidance,
      keys: pipe(
        guidance.keys,
        Array.map((key): string => key.toLowerCase()),
      ),
    }),
  ),
);

const fallbackEffectGuidance = {
  example: `const program = ${effectName}.gen(function* () {\n  return yield* operation.pipe(${effectName}.withSpan("operation"))\n})`,
  fix: 'Rewrite the code to make the Effect boundary, error channel, resource lifetime, and execution point explicit.',
} satisfies Pick<DiagnosticInput, 'example' | 'fix'>;

export const diagnosticMessage = (input: DiagnosticInput): string =>
  `${input.summary}\nFix: ${input.fix}\nExample:\n${markdownCode(input.example)}`;

const matchesNormalizedRuleGuidance = (
  normalizedRuleName: string,
  guidance: NormalizedRuleGuidance,
): boolean => {
  const { keys } = guidance;
  const keyCount = keys.length;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const key = keys[keyIndex];
    if (key !== undefined && normalizedRuleName.includes(key)) {
      return true;
    }
  }

  return false;
};

const effectGuidance = (ruleName: string): Pick<DiagnosticInput, 'example' | 'fix'> => {
  const normalizedRuleName = ruleName.toLowerCase();
  const guidanceCount = normalizedRuleGuidanceByName.length;
  for (let guidanceIndex = 0; guidanceIndex < guidanceCount; guidanceIndex += 1) {
    const guidance = normalizedRuleGuidanceByName[guidanceIndex];
    if (guidance !== undefined && matchesNormalizedRuleGuidance(normalizedRuleName, guidance)) {
      return guidance;
    }
  }

  return fallbackEffectGuidance;
};

export const effectDiagnosticMessage = (ruleName: string, summary: string): string => {
  const guidance = effectGuidance(ruleName);
  return diagnosticMessage({ ...guidance, summary });
};
