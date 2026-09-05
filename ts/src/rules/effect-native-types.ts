import type { ASTNode } from './effect-ast';

export interface NativeImportNode {
  readonly importKind?: string;
}

export interface NativeDefinition {
  readonly node?: NativeImportNode | null;
  readonly parent?: NativeImportNode | null;
  readonly type?: string;
}

export interface NativeResolvedReference {
  readonly defs?: readonly NativeDefinition[];
}

export interface NativeReference {
  readonly identifier?: ASTNode;
  readonly resolved?: NativeResolvedReference | null;
}

export interface NativeScope {
  readonly references?: readonly NativeReference[];
}

export interface NativeScopeManager {
  readonly scopes?: readonly NativeScope[];
}

export interface NativeSourceCode {
  readonly getText?: () => string;
  readonly isGlobalReference?: (node: ASTNode) => boolean;
  readonly scopeManager?: NativeScopeManager;
  readonly text?: string;
  readonly visitorKeys?: Readonly<Record<string, readonly string[]>>;
}
