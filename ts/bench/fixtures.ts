/**
 * Fixture generators for benchmarking custom lint rules.
 *
 * Each function produces an array of string inputs exercising realistic
 * identifier shapes that the heuristic functions encounter in practice.
 */

// ---- Naming convention fixtures ----

/** PascalCase/camelCase test candidates: mixed cases, acronyms, snake_case, etc. */
export function namingFixtures(): string[] {
  const bases: string[] = [];

  // Short camelCase identifiers (1-3 words, short)
  const shortWords = ['id', 'key', 'val', 'src', 'dest', 'len', 'pos', 'max', 'min', 'avg'];
  const verbs = ['get', 'set', 'has', 'is', 'parse', 'build', 'send', 'fetch', 'load', 'save'];
  const nouns = [
    'User',
    'Data',
    'Config',
    'Response',
    'Request',
    'Token',
    'Cache',
    'State',
    'Model',
    'View',
  ];

  for (const verb of verbs) {
    for (const noun of nouns) {
      bases.push(verb + noun);
      bases.push(verb.toLowerCase() + noun);
      bases.push(verb.toUpperCase() + '_' + noun.toUpperCase());
      bases.push(verb + '_' + noun);
    }
  }

  // Acronym-heavy identifiers
  const acronyms = ['URL', 'HTTP', 'HTTPS', 'JSON', 'XML', 'API', 'HTML', 'CSS', 'DOM', 'SQL'];
  for (const acr of acronyms) {
    bases.push('parse' + acr);
    bases.push('parse' + acr[0] + acr.slice(1).toLowerCase());
    bases.push(acr + 'Parser');
    bases.push(acr[0] + acr.slice(1).toLowerCase() + 'Parser');
    bases.push('get' + acr + 'Response');
    bases.push(acr + 'Connection');
  }

  // Very short identifiers
  for (const w of shortWords) {
    bases.push(w);
    bases.push(w.toUpperCase());
    bases.push('_' + w);
  }

  // Edge cases
  bases.push('', '_', 'A', 'a', 'X', 'x');

  return bases;
}

/** Boolean-type names for boolean-prefix benchmarking. */
export function booleanFixtures(): string[] {
  const result: string[] = [];

  // camelCase booleans
  const boolAdj = [
    'visible',
    'enabled',
    'active',
    'loading',
    'ready',
    'empty',
    'dirty',
    'focused',
    'open',
    'valid',
  ];
  for (const adj of boolAdj) {
    result.push(adj); // no prefix (should fail)
    result.push('is' + adj[0].toUpperCase() + adj.slice(1)); // correct
    result.push('has' + adj[0].toUpperCase() + adj.slice(1)); // correct
    result.push('should' + adj[0].toUpperCase() + adj.slice(1)); // correct
    result.push('is_enabled');
    result.push('IS_ENABLED');
    result.push('hasPermission');
    result.push('HAS_ACCESS');
    result.push('shouldUpdate');
  }

  // snake_case booleans
  const boolSnake = [
    'is_visible',
    'has_access',
    'should_reload',
    'IS_VISIBLE',
    'HAS_ACCESS',
    'SHOULD_RELOAD',
  ];
  for (const s of boolSnake) {
    result.push(s);
  }

  // False friends
  result.push('island', 'hash', 'ishtar', 'hasten', 'shoulder', 'issue', 'hassle', 'isopod');

  return result;
}

/** Private-member names for private-underscore benchmarking. */
export function privateFixtures(): string[] {
  const result: string[] = [];
  const fields = [
    'cache',
    'state',
    'handler',
    'count',
    'buffer',
    'promise',
    'subscription',
    'observers',
    'config',
    'threshold',
  ];

  for (const f of fields) {
    result.push(f); // no underscore
    result.push('_' + f); // correct
    result.push('m_' + f); // hungarian (not our convention)
    result.push(f + '_'); // trailing
    result.push('__' + f); // dunder
  }

  // Edge cases
  result.push('_', '', '___', '_x', 'x');

  return result;
}

/** Long identifiers for stress-testing splitMixedCase. */
export function longIdentifierFixtures(): string[] {
  const result: string[] = [];
  const acrs = ['HTTP', 'HTTPS', 'XML', 'JSON', 'API', 'URL', 'CSS', 'DOM', 'SQL', 'REST'];

  // Build progressively longer identifiers by chaining words
  for (const acr of acrs) {
    let name = '';
    for (let i = 0; i < 5; i++) {
      const verb = ['get', 'parse', 'convert', 'validate'][i % 4];
      name += verb + acr;
    }
    result.push(name);
  }

  // Very long mixed-case identifiers
  result.push(
    'processLargeHTTPSRequestAndValidateJSONResponseWithCustomXMLParser',
    'initializeDatabaseConnectionAndSetupSQLQueryBuilderForComplexJoins',
    'fetchRemoteAPIConfigurationDataAndCacheResponseInLocalStorage',
  );

  return result;
}

/** Comment text fixtures for no-commented-out-code benchmarking. */
export function commentFixtures(): string[] {
  const result: string[] = [];

  // Code-ish comments
  result.push(
    'const x = 42;',
    'return this.value;',
    'await fetch(url);',
    '  const result = await db.query(sql).then(r => r.rows);',
    'if (user.isActive) { return true; }',
  );

  // Natural language comments
  result.push(
    'This function validates the input data',
    'TODO: add error handling for edge cases',
    'Note: the previous implementation was removed',
    'We need to consider performance implications here',
    'See https://example.com/docs for more information',
    '@param userId - the user identifier',
    '@returns the parsed response object',
  );

  // Multi-line code comments
  result.push(
    `function oldHandler() {
  const data = await load();
  return data.map(item => transform(item));
}`,
    `class OldParser {
  parse(input) {
    return input.split('\\n');
  }
}`,
  );

  return result;
}
