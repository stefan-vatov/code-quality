import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import findMisCasedAcronyms, { fixAcronymCase } from '../../src/rules/acronym-case';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'acronym-case');

describe('findMisCasedAcronyms', () => {
  // Positive: correct acronym usage
  it('returns empty for correct camelCase with uppercase acronyms', () => {
    expect(findMisCasedAcronyms('parseURL')).toEqual([]);
    expect(findMisCasedAcronyms('getHTTPResponse')).toEqual([]);
    expect(findMisCasedAcronyms('convertToJSON')).toEqual([]);
    expect(findMisCasedAcronyms('buildXMLParser')).toEqual([]);
    expect(findMisCasedAcronyms('fetchAPI')).toEqual([]);
    expect(findMisCasedAcronyms('renderHTML')).toEqual([]);
    expect(findMisCasedAcronyms('generateUUID')).toEqual([]);
    expect(findMisCasedAcronyms('validateJWT')).toEqual([]);
    expect(findMisCasedAcronyms('parseCSV')).toEqual([]);
    expect(findMisCasedAcronyms('enableHTTPS')).toEqual([]);
  });

  it('returns empty for correct PascalCase with uppercase acronyms', () => {
    expect(findMisCasedAcronyms('URLParser')).toEqual([]);
    expect(findMisCasedAcronyms('HTTPSConnection')).toEqual([]);
    expect(findMisCasedAcronyms('JSONSchema')).toEqual([]);
    expect(findMisCasedAcronyms('APIClient')).toEqual([]);
    expect(findMisCasedAcronyms('HTMLRenderer')).toEqual([]);
    expect(findMisCasedAcronyms('JWTValidator')).toEqual([]);
    expect(findMisCasedAcronyms('PDFRenderer')).toEqual([]);
  });

  // Negative: mis-cased acronyms
  it('detects lowercase acronyms in camelCase', () => {
    expect(findMisCasedAcronyms('parseUrl')).toEqual(['Url']);
    expect(findMisCasedAcronyms('getHttpResponse')).toEqual(['Http']);
    expect(findMisCasedAcronyms('convertToJson')).toEqual(['Json']);
    expect(findMisCasedAcronyms('buildXmlParser')).toEqual(['Xml']);
    expect(findMisCasedAcronyms('fetchApi')).toEqual(['Api']);
  });

  it('detects lowercase acronyms in PascalCase', () => {
    expect(findMisCasedAcronyms('UrlParser')).toEqual(['Url']);
    expect(findMisCasedAcronyms('HttpsConnection')).toEqual(['Https']);
    expect(findMisCasedAcronyms('JsonSchema')).toEqual(['Json']);
  });

  it('detects multiple mis-cased acronyms', () => {
    expect(findMisCasedAcronyms('parseUrlFromJson')).toEqual(['Url', 'Json']);
    expect(findMisCasedAcronyms('getHttpAndHttps')).toEqual(['Http', 'Https']);
  });

  // Edge cases
  it('returns empty for identifiers without acronyms', () => {
    expect(findMisCasedAcronyms('userName')).toEqual([]);
    expect(findMisCasedAcronyms('getUserData')).toEqual([]);
    expect(findMisCasedAcronyms('SimpleThing')).toEqual([]);
    expect(findMisCasedAcronyms('T2')).toEqual([]);
    expect(findMisCasedAcronyms('a1b2c3')).toEqual([]);
    expect(findMisCasedAcronyms('oneTwo')).toEqual([]);
    expect(findMisCasedAcronyms('A')).toEqual([]);
    expect(findMisCasedAcronyms('Ab')).toEqual([]);
  });

  it('returns empty for snake_case identifiers (different convention)', () => {
    expect(findMisCasedAcronyms('api_key')).toEqual([]);
    expect(findMisCasedAcronyms('user_id')).toEqual([]);
    expect(findMisCasedAcronyms('is_enabled')).toEqual([]);
    expect(findMisCasedAcronyms('html_renderer')).toEqual([]);
    expect(findMisCasedAcronyms('json_parser')).toEqual([]);
  });

  it('returns empty for SCREAMING_SNAKE_CASE', () => {
    expect(findMisCasedAcronyms('API_KEY')).toEqual([]);
    expect(findMisCasedAcronyms('MAX_RETRIES')).toEqual([]);
    expect(findMisCasedAcronyms('HTML_RENDERER')).toEqual([]);
    expect(findMisCasedAcronyms('JSON_PARSE')).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(findMisCasedAcronyms('')).toEqual([]);
  });

  // Specific acronym tests
  it('handles DOM acronym', () => {
    expect(findMisCasedAcronyms('parseDOM')).toEqual([]);
    expect(findMisCasedAcronyms('parseDom')).toEqual(['Dom']);
  });

  it('handles UI acronym', () => {
    expect(findMisCasedAcronyms('buildUI')).toEqual([]);
    expect(findMisCasedAcronyms('buildUi')).toEqual(['Ui']);
  });

  it('handles CSS acronym', () => {
    expect(findMisCasedAcronyms('parseCSS')).toEqual([]);
    expect(findMisCasedAcronyms('parseCss')).toEqual(['Css']);
  });

  it('handles acronym followed by single letter word', () => {
    expect(findMisCasedAcronyms('APIKey')).toEqual([]);
    expect(findMisCasedAcronyms('ApiKey')).toEqual(['Api']);
  });

  it('handles mixed with numbers', () => {
    expect(findMisCasedAcronyms('parseURL2')).toEqual([]);
    expect(findMisCasedAcronyms('parseUrl2')).toEqual(['Url2']);
  });

  // False positive prevention
  it('skips words where digit-stripped alpha is single character', () => {
    expect(findMisCasedAcronyms('myFuncT2')).toEqual([]);
    expect(findMisCasedAcronyms('doA1')).toEqual([]);
    expect(findMisCasedAcronyms('parseX5')).toEqual([]);
  });

  it('does not flag common English words that are not acronyms', () => {
    expect(findMisCasedAcronyms('getClassName')).toEqual([]);
    expect(findMisCasedAcronyms('userBuilder')).toEqual([]);
    expect(findMisCasedAcronyms('myDataStore')).toEqual([]);
    expect(findMisCasedAcronyms('findMisCasedAcronyms')).toEqual([]);
    expect(findMisCasedAcronyms('renameMisCasedAcronyms')).toEqual([]);
  });

  it('handles acronym at start of PascalCase', () => {
    expect(findMisCasedAcronyms('HTTPClient')).toEqual([]);
    expect(findMisCasedAcronyms('XMLFile')).toEqual([]);
    expect(findMisCasedAcronyms('JSONData')).toEqual([]);
  });

  it('handles acronym at end of camelCase', () => {
    expect(findMisCasedAcronyms('clientHTTP')).toEqual([]);
    expect(findMisCasedAcronyms('fileXML')).toEqual([]);
    expect(findMisCasedAcronyms('dataJSON')).toEqual([]);
  });

  it('allows leading lowercase acronyms in camelCase identifiers', () => {
    expect(findMisCasedAcronyms('urlParser')).toEqual([]);
    expect(findMisCasedAcronyms('httpIndex')).toEqual([]);
    expect(findMisCasedAcronyms('regexPrefixChars')).toEqual([]);
  });

  it('handles acronyms in middle of identifiers', () => {
    expect(findMisCasedAcronyms('parseHTTPResponse')).toEqual([]);
    expect(findMisCasedAcronyms('getJSONData')).toEqual([]);
    expect(findMisCasedAcronyms('buildXMLTree')).toEqual([]);
  });
});

function extractIdentifiers(source: string): string[] {
  const clean = source.replace(/\/\/.*$/gm, '');
  const results: string[] = [];
  // Function names
  const fnRe = /function\s+(\w+)/g;
  let m: RegExpExecArray | null = null;
  while ((m = fnRe.exec(clean)) !== null) results.push(m[1]);
  // Class names
  const classRe = /class\s+(\w+)/g;
  while ((m = classRe.exec(clean)) !== null) results.push(m[1]);
  // Variable names
  const varRe = /(?:let|var|const)\s+(\w+)\s*[:=]/g;
  while ((m = varRe.exec(clean)) !== null) {
    if (!['true', 'false'].includes(m[1])) results.push(m[1]);
  }
  return results;
}

describe('acronym-case valid fixtures', () => {
  it('all identifiers in valid fixture use correct acronym casing', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const names = extractIdentifiers(source);
    const violations = names.filter((n) => findMisCasedAcronyms(n).length > 0);
    expect(violations).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('acronym-case invalid fixtures', () => {
  it('all identifiers in invalid fixture have mis-cased acronyms', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const names = extractIdentifiers(source);
    const passing = names.filter((n) => findMisCasedAcronyms(n).length === 0);
    expect(passing).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('fixAcronymCase', () => {
  it('uppercases mis-cased acronyms in camelCase', () => {
    expect(fixAcronymCase('parseUrl')).toBe('parseURL');
    expect(fixAcronymCase('getHttpResponse')).toBe('getHTTPResponse');
    expect(fixAcronymCase('convertToJson')).toBe('convertToJSON');
  });

  it('uppercases mis-cased acronyms in PascalCase', () => {
    expect(fixAcronymCase('UrlParser')).toBe('URLParser');
    expect(fixAcronymCase('HttpsConnection')).toBe('HTTPSConnection');
  });

  it('handles multiple mis-cased acronyms', () => {
    expect(fixAcronymCase('parseUrlFromJson')).toBe('parseURLFromJSON');
  });

  it('returns unchanged when no mis-cased acronyms', () => {
    expect(fixAcronymCase('parseURL')).toBe('parseURL');
    expect(fixAcronymCase('userName')).toBe('userName');
    expect(fixAcronymCase('urlParser')).toBe('urlParser');
  });

  it('handles empty string', () => {
    expect(fixAcronymCase('')).toBe('');
  });
});
