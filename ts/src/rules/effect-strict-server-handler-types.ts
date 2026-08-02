/* -------------------------------------------------------------------------- */
/*      Shared source-index types for server-handler detection helpers.       */
/* -------------------------------------------------------------------------- */

/**
 * Describes an inclusive source range.
 *
 * @param start - The first source offset in the range.
 * @param end - The final source offset in the range.
 * @returns A validated source interval.
 * @throws Does not throw.
 * @internal
 */
export interface SourceRange {
  end: number;
  start: number;
}

/**
 * Describes imported bindings that can identify Effect.runSync.
 *
 * @param direct - Named runSync imports.
 * @param namespace - Effect module namespace imports.
 * @param root - Root Effect namespace imports.
 * @param hasEffectImport - Whether any Effect module import is present.
 * @returns A runSync binding set.
 * @throws Does not throw.
 * @internal
 */
export interface RunSyncBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespace: ReadonlySet<string>;
  readonly root: ReadonlySet<string>;
  readonly hasEffectImport: boolean;
}
