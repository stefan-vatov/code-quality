import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

interface ReportLocation {
  column: number | undefined;
  line: number | undefined;
}

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const ruleCoreURL = new URL('../../src/rules/effect-rule-core.ts', import.meta.url).href;
const zeroLengthProbeTimeoutMS = 3_000;

const nativeCodeEmptyMatchColumns = (source: string, flag: 'u' | 'v'): number[] =>
  Array.from(
    source.matchAll(new RegExp('', `g${flag}`)),
    (match): number => match.index ?? -1,
  ).filter((column): boolean => source.charAt(column).trim() !== '');

const runZeroLengthProbe = (flag: 'u' | 'v'): string => {
  const source = '𐐀;';
  const probeSource = `
    import { makeRules } from ${JSON.stringify(ruleCoreURL)};
    const source = ${JSON.stringify(source)};
    const astral = ${JSON.stringify('𐐀')};
    const zeroPattern = new RegExp('', ${JSON.stringify(flag)});
    const triggerPattern = new RegExp(astral);
    const reports = [];
    let reportCount = 0;
    const rule = makeRules([{
      countPatterns: [zeroPattern],
      message: 'zero-length pattern',
      name: 'zero-length-unicode-pattern',
      patterns: [triggerPattern],
      tokens: [astral],
    }])['zero-length-unicode-pattern'];
    const context = {
      report(descriptor) {
        reportCount += 1;
        if (reports.length < 16) {
          reports.push({ column: descriptor.loc?.column, line: descriptor.loc?.line });
        }
      },
      sourceCode: { text: source },
    };
    rule.create(context).Program({
      body: [{ type: 'ExpressionStatement' }],
      type: 'Program',
    });
    process.stdout.write(JSON.stringify({ reportCount, reports }));
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 50_000,
      timeout: zeroLengthProbeTimeoutMS,
    },
  );

  if (result.error?.message.includes('ETIMEDOUT') === true) {
    return `timeout:${zeroLengthProbeTimeoutMS}`;
  }
  if (result.error !== undefined) {
    return `error:${result.error.message}`;
  }
  if (result.status !== 0) {
    return `exit:${String(result.status)}:${result.stderr.trim()}`;
  }
  return result.stdout.trim();
};

describe('Effect rule core streaming regressions', (): void => {
  it.each(['u', 'v'] as const)(
    'terminates zero-length /%s scans at native Unicode boundaries',
    (flag): void => {
      const source = '𐐀;';
      const expected = {
        reportCount: nativeCodeEmptyMatchColumns(source, flag).length,
        reports: nativeCodeEmptyMatchColumns(source, flag).map(
          (column): ReportLocation => ({ column, line: 1 }),
        ),
      };

      expect(runZeroLengthProbe(flag)).toBe(JSON.stringify(expected));
    },
  );
});
