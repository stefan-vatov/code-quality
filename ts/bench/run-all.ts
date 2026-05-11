#!/usr/bin/env node
/**
 * Run micro-benchmarks on all custom Oxlint heuristic rules.
 *
 * Usage: node --import tsx ts/bench/run-all.ts
 */

import { benchmark, formatHeader, formatResult, type BenchResult } from './benchmark.js';
import {
  namingFixtures,
  booleanFixtures,
  privateFixtures,
  longIdentifierFixtures,
  commentFixtures,
} from './fixtures.js';

// ---- Imports from rule modules ----
import isPascalCase from '../src/rules/pascal-case-types.js';
import { isCamelCase } from '../src/rules/camel-case-identifiers.js';
import hasBooleanPrefix from '../src/rules/boolean-prefix.js';
import hasLeadingUnderscore from '../src/rules/private-underscore.js';
import findMisCasedAcronyms from '../src/rules/acronym-case.js';
import isCommentedOutCode from '../src/rules/no-commented-out-code.js';

// ---- Benchmark configuration ----
const ITERATIONS = 100_000;

console.log(`\nLint rule micro-benchmarks — ${ITERATIONS.toLocaleString()} iterations each\n`);

const results: BenchResult[] = [];

// ---- pascal-case-types ----
const pascalInputs = namingFixtures();
results.push(benchmark('pascalCaseTypes :: isPascalCase', isPascalCase, pascalInputs, ITERATIONS));

// ---- camel-case-identifiers ----
const camelInputs = namingFixtures();
results.push(benchmark('camelCaseIds   :: isCamelCase', isCamelCase, camelInputs, ITERATIONS));

// ---- boolean-prefix ----
const boolInputs = booleanFixtures();
results.push(
  benchmark('booleanPrefix  :: hasBooleanPrefix', hasBooleanPrefix, boolInputs, ITERATIONS),
);

// ---- private-underscore ----
const privInputs = privateFixtures();
results.push(
  benchmark('privateUnder   :: hasLeadingUnderscore', hasLeadingUnderscore, privInputs, ITERATIONS),
);

// ---- acronym-case ----
const acronymInputs = namingFixtures().concat(longIdentifierFixtures());
results.push(
  benchmark(
    'acronymCase   :: findMisCasedAcronyms',
    findMisCasedAcronyms,
    acronymInputs,
    ITERATIONS,
  ),
);

// ---- no-commented-out-code ----
const commentInputs = commentFixtures();
results.push(
  benchmark('commentedCode  :: isCommentedOutCode', isCommentedOutCode, commentInputs, 10_000),
);

// ---- Output ----
console.log(formatHeader());
for (const r of results) {
  console.log(formatResult(r));
}

// Quick summary
const totalOps = results.reduce((sum, r) => sum + r.opsPerSec, 0);
console.log(
  `\nTotal throughput: ${totalOps.toLocaleString()} ops/sec across ${results.length} rules\n`,
);
