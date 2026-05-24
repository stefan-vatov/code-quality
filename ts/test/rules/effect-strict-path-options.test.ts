import { describe, expect, it } from 'vitest';
import theThracianOxlint from '../../src/index.js';
import { runConfiguredRules, runRule } from './effect-rule-test-utils.js';

describe('Effect strict path options', () => {
  it('does not expose a strict console rule because direct console is globally banned', () => {
    const strictOptions = { entrypoints: ['observability/main.ts'] };
    const config = theThracianOxlint({ effect: { strict: strictOptions } });

    expect(config.rules).toHaveProperty('no-console', 'error');
    expect(config.rules).not.toHaveProperty(
      'thethracian/effect-no-direct-console-outside-logger-layer',
    );
  });

  it('treats common globstar patterns as matching direct and nested files', () => {
    const options = {
      integrationTests: ['tests/integration/**/*.ts'],
      unitTests: ['tests/unit/**/*.ts'],
    };

    expect(
      runRule(
        'effect-no-live-services-in-unit-tests',
        'const layer = UserRepoLive;',
        'tests/unit/user.ts',
        options,
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-live-services-in-unit-tests',
        'const layer = UserRepoLive;',
        'tests/unit/nested/user.ts',
        options,
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'effect-no-live-services-in-unit-tests',
        'const layer = UserRepoLive;',
        'tests/integration/user.ts',
        options,
      ),
    ).toHaveLength(0);
  });

  it('passes strict path options through the exported config execution path', () => {
    const strictOptions = {
      adapterLayers: ['platform/adapters/**'],
      compositionRoots: ['apps/api/main.ts'],
      configLayers: ['settings/**'],
      domain: ['features/domain/**'],
      entrypoints: ['workers/main.ts'],
      integrationTests: ['tests/integration/**/*.ts'],
      unitTests: ['tests/unit/**/*.ts'],
    };
    const config = theThracianOxlint({ effect: { strict: strictOptions } });
    const cases = [
      {
        allowedFile: 'workers/main.ts',
        rejectedFile: 'src/domain/main.ts',
        ruleName: 'effect-no-run-outside-entrypoints',
        source: 'Effect.runPromise(program);',
      },
      {
        allowedFile: 'apps/api/main.ts',
        rejectedFile: 'src/domain/user.ts',
        ruleName: 'effect-require-centralized-provision',
        source: 'program.pipe(Effect.provide(Live));',
      },
      {
        allowedFile: 'settings/config.ts',
        rejectedFile: 'src/domain/config.ts',
        ruleName: 'effect-no-direct-process-env-outside-config-layer',
        source: 'process.env.API_TOKEN;',
      },
      {
        allowedFile: 'platform/adapters/clock.ts',
        rejectedFile: 'src/domain/clock.ts',
        ruleName: 'effect-no-direct-clock-random-outside-adapters',
        source: 'Date.now();',
      },
      {
        allowedFile: 'src/domain/user.ts',
        rejectedFile: 'features/domain/user.ts',
        ruleName: 'effect-no-provide-in-domain-modules',
        source: 'program.pipe(Effect.provide(Live));',
      },
    ];

    for (const testCase of cases) {
      expect(
        runConfiguredRules(config, testCase.source, testCase.allowedFile).map(
          (report) => report.ruleName,
        ),
      ).not.toContain(testCase.ruleName);
      expect(
        runConfiguredRules(config, testCase.source, testCase.rejectedFile).map(
          (report) => report.ruleName,
        ),
      ).toContain(testCase.ruleName);
    }

    expect(
      runConfiguredRules(config, 'const layer = UserRepoLive;', 'tests/unit/user.ts').map(
        (report) => report.ruleName,
      ),
    ).toContain('effect-no-live-services-in-unit-tests');
    expect(
      runConfiguredRules(config, 'const layer = UserRepoLive;', 'tests/integration/user.ts').map(
        (report) => report.ruleName,
      ),
    ).not.toContain('effect-no-live-services-in-unit-tests');
  });

  it('honors every configured strict project path bucket', () => {
    const cases = [
      {
        ruleName: 'effect-no-run-outside-entrypoints',
        options: { entrypoints: ['workers/main.ts'] },
        source: 'Effect.runPromise(program);',
        allowedFile: 'workers/main.ts',
        rejectedFile: 'src/domain/main.ts',
      },
      {
        ruleName: 'effect-require-centralized-provision',
        options: { compositionRoots: ['apps/api/main.ts'] },
        source: 'program.pipe(Effect.provide(Live));',
        allowedFile: 'apps/api/main.ts',
        rejectedFile: 'src/domain/user.ts',
      },
      {
        ruleName: 'effect-no-direct-process-env-outside-config-layer',
        options: { configLayers: ['settings/**'] },
        source: 'process.env.API_TOKEN;',
        allowedFile: 'settings/config.ts',
        rejectedFile: 'src/domain/config.ts',
      },
      {
        ruleName: 'effect-no-direct-clock-random-outside-adapters',
        options: { adapterLayers: ['platform/adapters/**'] },
        source: 'Date.now();',
        allowedFile: 'platform/adapters/clock.ts',
        rejectedFile: 'src/domain/clock.ts',
      },
      {
        ruleName: 'effect-no-provide-in-domain-modules',
        options: { domain: ['features/domain/**'] },
        source: 'program.pipe(Effect.provide(Live));',
        allowedFile: 'src/domain/user.ts',
        rejectedFile: 'features/domain/user.ts',
      },
    ];

    for (const testCase of cases) {
      expect(
        runRule(testCase.ruleName, testCase.source, testCase.allowedFile, testCase.options),
      ).toHaveLength(0);
      expect(
        runRule(testCase.ruleName, testCase.source, testCase.rejectedFile, testCase.options),
      ).toHaveLength(1);
    }
  });

  it('covers each strict rule that branches on project path options', () => {
    const cases = [
      {
        ruleName: 'effect-no-run-outside-entrypoints',
        options: { entrypoints: ['workers/main.ts'] },
        source: 'Effect.runPromise(program);',
        reportedFile: 'src/domain/main.ts',
        ignoredFile: 'workers/main.ts',
      },
      {
        ruleName: 'effect-require-platform-runmain-at-entrypoints',
        options: { entrypoints: ['workers/main.ts'] },
        source: 'Effect.runPromise(program);',
        reportedFile: 'workers/main.ts',
        ignoredFile: 'src/domain/main.ts',
      },
      {
        ruleName: 'effect-no-direct-process-env-outside-config-layer',
        options: { configLayers: ['settings/**'] },
        source: 'process.env.API_TOKEN;',
        reportedFile: 'src/domain/config.ts',
        ignoredFile: 'settings/config.ts',
      },
      {
        ruleName: 'effect-no-direct-clock-random-outside-adapters',
        options: { adapterLayers: ['platform/adapters/**'] },
        source: 'Date.now();',
        reportedFile: 'src/domain/clock.ts',
        ignoredFile: 'platform/adapters/clock.ts',
      },
      {
        ruleName: 'effect-no-direct-http-fs-outside-platform-services',
        options: { adapterLayers: ['platform/adapters/**'] },
        source: 'fetch("/users");',
        reportedFile: 'src/domain/http.ts',
        ignoredFile: 'platform/adapters/http.ts',
      },
      {
        ruleName: 'effect-no-leaked-service-dependencies',
        options: { domain: ['features/domain/**'] },
        source: 'export const Live = Layer.succeed(UserRepo, service);',
        reportedFile: 'features/domain/user.ts',
        ignoredFile: 'apps/api/user.ts',
      },
      {
        ruleName: 'effect-require-centralized-provision',
        options: { compositionRoots: ['apps/api/main.ts'] },
        source: 'program.pipe(Effect.provide(Live));',
        reportedFile: 'src/domain/user.ts',
        ignoredFile: 'apps/api/main.ts',
      },
      {
        ruleName: 'effect-no-provide-in-domain-modules',
        options: { domain: ['features/domain/**'] },
        source: 'program.pipe(Effect.provide(Live));',
        reportedFile: 'features/domain/user.ts',
        ignoredFile: 'apps/api/user.ts',
      },
      {
        ruleName: 'effect-no-service-construction-outside-layer',
        options: { adapterLayers: ['platform/adapters/**'] },
        source: 'new UserRepoService();',
        reportedFile: 'src/domain/user.ts',
        ignoredFile: 'platform/adapters/user.ts',
      },
      {
        ruleName: 'effect-schema-require-config-schema',
        options: { configLayers: ['settings/**'] },
        source: 'Config.string("API_TOKEN");',
        reportedFile: 'settings/config.ts',
        ignoredFile: 'src/domain/config.ts',
      },
      {
        ruleName: 'effect-require-provided-services-in-tests',
        options: {
          integrationTests: ['tests/integration/**/*.ts'],
          unitTests: ['tests/unit/**/*.ts'],
        },
        source: 'yield* UserRepoService;',
        reportedFile: 'tests/unit/user.ts',
        ignoredFile: 'src/domain/user.ts',
      },
      {
        ruleName: 'effect-prefer-in-memory-implementations',
        options: {
          integrationTests: ['tests/integration/**/*.ts'],
          unitTests: ['tests/unit/**/*.ts'],
        },
        source: 'const layer = realUserRepo;',
        reportedFile: 'tests/unit/user.ts',
        ignoredFile: 'tests/integration/user.ts',
      },
      {
        ruleName: 'effect-no-live-services-in-unit-tests',
        options: {
          integrationTests: ['tests/integration/**/*.ts'],
          unitTests: ['tests/unit/**/*.ts'],
        },
        source: 'const layer = UserRepoLive;',
        reportedFile: 'tests/unit/user.ts',
        ignoredFile: 'tests/integration/user.ts',
      },
      {
        ruleName: 'effect-require-testclock-for-time-code',
        options: {
          integrationTests: ['tests/integration/**/*.ts'],
          unitTests: ['tests/unit/**/*.ts'],
        },
        source: 'Clock.currentTimeMillis;',
        reportedFile: 'tests/unit/user.ts',
        ignoredFile: 'src/domain/user.ts',
      },
      {
        ruleName: 'effect-no-test-runtime-leakage',
        options: {
          integrationTests: ['tests/integration/**/*.ts'],
          unitTests: ['tests/unit/**/*.ts'],
        },
        source: 'const TestRuntime = makeRuntime();',
        reportedFile: 'tests/unit/user.ts',
        ignoredFile: 'src/domain/user.ts',
      },
    ];

    for (const testCase of cases) {
      expect(
        runRule(testCase.ruleName, testCase.source, testCase.reportedFile, testCase.options),
      ).toHaveLength(1);
      expect(
        runRule(testCase.ruleName, testCase.source, testCase.ignoredFile, testCase.options),
      ).toHaveLength(0);
    }
  });
});
