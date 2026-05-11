import { describe, expect, it } from 'vitest';
import findMisCasedAcronyms from '../../src/rules/acronym-case.js';

describe('findMisCasedAcronyms', () => {
  it('returns empty for correct camelCase with uppercase acronyms', () => {
    expect(findMisCasedAcronyms('parseURL')).toEqual([]);
    expect(findMisCasedAcronyms('getHTTPResponse')).toEqual([]);
    expect(findMisCasedAcronyms('convertToJSON')).toEqual([]);
    expect(findMisCasedAcronyms('buildXMLParser')).toEqual([]);
  });

  it('returns empty for correct PascalCase with uppercase acronyms', () => {
    expect(findMisCasedAcronyms('URLParser')).toEqual([]);
    expect(findMisCasedAcronyms('HTTPSConnection')).toEqual([]);
    expect(findMisCasedAcronyms('JSONSchema')).toEqual([]);
  });

  it('detects lowercase acronyms in camelCase', () => {
    expect(findMisCasedAcronyms('parseUrl')).toEqual(['Url']);
    expect(findMisCasedAcronyms('getHttpResponse')).toEqual(['Http']);
    expect(findMisCasedAcronyms('convertToJson')).toEqual(['Json']);
  });

  it('detects lowercase acronyms in PascalCase', () => {
    expect(findMisCasedAcronyms('UrlParser')).toEqual(['Url']);
    expect(findMisCasedAcronyms('HttpsConnection')).toEqual(['Https']);
  });

  it('detects multiple mis-cased acronyms', () => {
    expect(findMisCasedAcronyms('parseUrlFromJson')).toEqual(['Url', 'Json']);
  });

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

  it('skips words where digit-stripped alpha is single character', () => {
    expect(findMisCasedAcronyms('myFuncT2')).toEqual([]);
    expect(findMisCasedAcronyms('doA1')).toEqual([]);
  });

  it('returns empty for snake_case identifiers (different convention)', () => {
    // Snake_case lowercase convention is fine — acronyms are lowercase in snake_case
    expect(findMisCasedAcronyms('api_key')).toEqual([]);
    expect(findMisCasedAcronyms('user_id')).toEqual([]);
    expect(findMisCasedAcronyms('is_enabled')).toEqual([]);
  });

  it('returns empty for SCREAMING_SNAKE_CASE', () => {
    expect(findMisCasedAcronyms('API_KEY')).toEqual([]);
    expect(findMisCasedAcronyms('MAX_RETRIES')).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(findMisCasedAcronyms('')).toEqual([]);
  });

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

  it('handles XMLHttpRequest edge case', () => {
    // XML and HTTP are both acronyms, Request is not
    expect(findMisCasedAcronyms('XMLHttpRequest')).toEqual(['Http']);
    expect(findMisCasedAcronyms('XMLHTTPRequest')).toEqual([]);
  });

  it('handles acronym followed by single letter', () => {
    // API + Key → "APIKey" is fine, "ApiKey" is wrong
    expect(findMisCasedAcronyms('APIKey')).toEqual([]);
    expect(findMisCasedAcronyms('ApiKey')).toEqual(['Api']);
  });

  it('handles mixed with numbers', () => {
    expect(findMisCasedAcronyms('parseURL2')).toEqual([]);
    expect(findMisCasedAcronyms('parseUrl2')).toEqual(['Url2']);
  });
});
