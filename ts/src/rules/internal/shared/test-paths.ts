const testOrToolingPath =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|__mocks__|tests?|fixtures)\/|(?:^|\/)[^/]*\.config\.[cm]?[jt]s$|(?:^|\/)[^/]*(?:test|vitest|jest)[-.]?setup[^/]*\.[cm]?[jt]sx?$|(?:^|\/)setup-?tests?\.[cm]?[jt]sx?$)/u;

export const isTestOrToolingFile = (filename: string | undefined): boolean =>
  filename !== undefined && testOrToolingPath.test(filename.replaceAll('\\', '/'));
