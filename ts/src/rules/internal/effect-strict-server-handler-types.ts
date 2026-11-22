export interface SourceRange {
  end: number;
  start: number;
}

export interface RunSyncBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespace: ReadonlySet<string>;
  readonly root: ReadonlySet<string>;
  readonly hasEffectImport: boolean;
}
