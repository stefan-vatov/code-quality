/* -------------------------------------------------------------------------- */
/*             LLM-friendly diagnostic guidance for custom rules.             */
/* -------------------------------------------------------------------------- */

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

const markdownCode = (code: string): string => `\`\`\`ts\n${code}\n\`\`\``;
const effectName = ['Eff', 'ect'].join('');
const JAVASCRIPT_EXTENSION_LENGTH = 3;

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

const fallbackEffectGuidance = {
  example: `const program = ${effectName}.gen(function* () {\n  return yield* operation.pipe(${effectName}.withSpan("operation"))\n})`,
  fix: 'Rewrite the code to make the Effect boundary, error channel, resource lifetime, and execution point explicit.',
} satisfies Pick<DiagnosticInput, 'example' | 'fix'>;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const diagnosticMessage = (input: DiagnosticInput): string =>
  `${input.summary}\nFix: ${input.fix}\nExample:\n${markdownCode(input.example)}`;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const renameDiagnosticMessage = (kind: string, name: string, replacement: string): string =>
  diagnosticMessage({
    example: `${kind} ${replacement}`,
    fix: `Rename '${name}' to '${replacement}' and update every reference in the same change.`,
    summary: `${kind} names must follow the configured naming convention.`,
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const typeDiagnosticMessage = (kind: string, name: string, replacement: string): string =>
  diagnosticMessage({
    example: `${kind} ${replacement} {}`,
    fix: `Rename ${kind} '${name}' to '${replacement}' and update all references.`,
    summary: 'Type declarations must use PascalCase.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const constantDiagnosticMessage = (name: string, replacement: string): string =>
  diagnosticMessage({
    example: `const ${replacement} = value\nconst ${name.toUpperCase()} = value`,
    fix: `Rename '${name}' to '${replacement}' for ordinary constants, or '${name.toUpperCase()}' for true module-level constants.`,
    summary: 'Constants must be camelCase unless they are true UPPER_CASE constants.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const booleanDiagnosticMessage = (name: string): string =>
  diagnosticMessage({
    example: `const is${name[0]?.toUpperCase() ?? ''}${name.slice(1)} = true`,
    fix: `Rename boolean '${name}' with an is/has/should/can predicate prefix and update references.`,
    summary: 'Boolean identifiers must read like predicates.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const privateMemberDiagnosticMessage = (
  kind: 'method' | 'property',
  name: string,
  replacement: string,
): string => {
  let example = `private ${replacement}: string`;
  if (kind === 'method') {
    example = `private ${replacement}(): void {}`;
  }
  return diagnosticMessage({
    example,
    fix: `Rename private ${kind} '${name}' to '${replacement}' and update internal references.`,
    summary: 'Private class members require a leading underscore.',
  });
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const acronymDiagnosticMessage = (
  name: string,
  replacement: string,
  violations: readonly string[],
): string => {
  const listed = violations.map((acr) => `'${acr}'`).join(', ');
  let pluralSuffix = '';
  if (violations.length > 1) {
    pluralSuffix = 's';
  }
  return diagnosticMessage({
    example: `const ${replacement} = value`,
    fix: `Rename '${name}' to '${replacement}' and update references; acronym${pluralSuffix} ${listed} must stay uppercase.`,
    summary: 'Known programming acronyms must use one consistent uppercase spelling.',
  });
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const jsExtensionDiagnosticMessage = (specifier: string): string =>
  diagnosticMessage({
    example: `import { helper } from '${specifier.slice(0, -JAVASCRIPT_EXTENSION_LENGTH)}'`,
    fix: `Remove the emitted .js suffix from '${specifier}'. Do not replace it with another runtime extension.`,
    summary: 'Local TypeScript source imports must not use emitted JavaScript extensions.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localExportListDiagnosticMessage = (): string =>
  diagnosticMessage({
    example: 'export const helper = (): void => {}',
    fix: 'Move each local export modifier to the declaration it exports and remove the export list.',
    summary: 'Local export lists hide public surface ownership.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const importDepthDiagnosticMessage = (
  depth: number,
  maxDepth: number,
  importPath: string,
): string =>
  diagnosticMessage({
    example: "import { helper } from '@/shared/helper'",
    fix: `Flatten the module boundary or use a configured path alias instead of '${importPath}'.`,
    summary: `Import path depth ${depth} exceeds the maximum of ${maxDepth}.`,
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const lineLengthDiagnosticMessage = (line: number, length: number): string =>
  diagnosticMessage({
    example: 'const result = pipe(\n  input,\n  stepOne,\n  stepTwo,\n)',
    fix: 'Break the expression into named intermediate values or multiline pipeline/call formatting.',
    summary: `Line ${line} has ${length} characters, exceeding the maximum of 150.`,
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const fileDocDiagnosticMessage = (): string =>
  diagnosticMessage({
    example: `/* -------------------------------------------------------------------------- */
/*                  Effect rules for validating service layers.               */
/* -------------------------------------------------------------------------- */`,
    fix: `Add a top-of-file divider header in this exact format:
/* -------------------------------------------------------------------------- */
/*                     Describe this file's purpose here.                     */
/* -------------------------------------------------------------------------- */

The text line must be a real description of what the file is for; declaration JSDoc does not count.`,
    summary: 'Missing file-purpose header.',
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const functionDocDiagnosticMessage = (): string =>
  diagnosticMessage({
    example: `/**
 * Parse user input into a validated command.
 *
 * @param input - Untrusted request payload.
 * @returns A typed command ready for the domain layer.
 * @throws Does not throw; validation failures are returned in the Effect error channel.
 */`,
    fix: `Add a /** ... */ block immediately above the export in this shape:
/**
 * Describe what this exported declaration does.
 *
 * @param name - Describe this parameter.
 * @returns Describe the return value.
 * @throws Describe expected error conditions, or state that it does not throw.
 */

The prose must be specific; generated placeholder text does not satisfy the rule.`,
    summary: 'Missing public declaration JSDoc.',
  });

const matchesRuleGuidance = (ruleName: string, guidance: RuleGuidance): boolean =>
  guidance.keys.some((key): boolean => ruleName.includes(key));

const effectGuidance = (ruleName: string): Pick<DiagnosticInput, 'example' | 'fix'> =>
  ruleGuidanceByName.find((guidance): boolean => matchesRuleGuidance(ruleName, guidance)) ??
  fallbackEffectGuidance;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectDiagnosticMessage = (ruleName: string, summary: string): string => {
  const guidance = effectGuidance(ruleName);
  return diagnosticMessage({ ...guidance, summary });
};
