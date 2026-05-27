import { describe, expect, it } from 'vitest';
import { renameMisCasedAcronyms } from '../../src/codemods/rename-acronyms';

describe('renameMisCasedAcronyms', (): void => {
  it('renames declarations and references together', (): void => {
    const input = `
const parseJson = (jsonValue: string) => jsonValue;
const result = parseJson("ok");
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
const parseJSON = (jsonValue: string) => jsonValue;
const result = parseJSON("ok");
`);
  });

  it('renames class members and property accesses consistently', (): void => {
    const input = `
class ApiClient {
  parseUrl(value: string): string {
    return value;
  }
}

const client = new ApiClient();
client.parseUrl("https://example.com");
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
class APIClient {
  parseURL(value: string): string {
    return value;
  }
}

const client = new APIClient();
client.parseURL("https://example.com");
`);
  });

  it('does not touch strings, comments, import specifiers, or import source paths', (): void => {
    const input = `
// parseJson remains documentation text
import { parseJson } from "./parse-json.js";
const label = "parseJson";
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
// parseJson remains documentation text
import { parseJson } from "./parse-json.js";
const label = "parseJson";
`);
  });

  it('does not rename exported declarations or object property keys', (): void => {
    const input = `
export function parseJson(value: string): string {
  return value;
}

export default {
  jsPlugins: ["./plugin.js"],
};
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
export function parseJson(value: string): string {
  return value;
}

export default {
  jsPlugins: ["./plugin.js"],
};
`);
  });

  it('does not rename imported API names at call sites', (): void => {
    const input = `
import findMisCasedAcronyms from "./acronym-case.js";

const count = findMisCasedAcronyms("parseJson").length;
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
import findMisCasedAcronyms from "./acronym-case.js";

const count = findMisCasedAcronyms("parseJson").length;
`);
  });

  it('does not rename exported API names at local references', (): void => {
    const input = `
export function renameMisCasedAcronyms(source: string): string {
  return source;
}

const alias = renameMisCasedAcronyms;
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
export function renameMisCasedAcronyms(source: string): string {
  return source;
}

const alias = renameMisCasedAcronyms;
`);
  });

  it('does not rename structural object contract keys', (): void => {
    const input = `
const nextSearchPosition = (): { nextPOS: number } => ({
  nextPOS: 1,
});
`;

    expect(renameMisCasedAcronyms(input)).toBe(`
const nextSearchPosition = (): { nextPOS: number } => ({
  nextPOS: 1,
});
`);
  });

  it('does not rename TypeScript contract identifiers or option object keys', (): void => {
    const input = `
interface RepositoryContext {
  hasGITDirectory: boolean;
  packageJSONPaths: string[];
}

interface SDKMatrix {
  compileSDKVersion: number;
}

type AppPackageJSON = {
  scripts?: Record<string, string>;
};

type TSConfigJSON = {
  compilerOptions?: Record<string, unknown>;
};

const packageJSON: AppPackageJSON = readJSON<AppPackageJSON>();
const tsconfig: TSConfigJSON = readJSON<TSConfigJSON>();
const context: RepositoryContext = {
  hasGITDirectory: true,
  packageJSONPaths,
};
const sdk: SDKMatrix = {
  compileSDKVersion: 35,
};

findGITRepositoryRoot({
  noGITRootMessage: (gitRoot: string) => gitRoot,
  requirePackageJSON: true,
});
`;

    expect(renameMisCasedAcronyms(input)).toBe(input);
  });
});
