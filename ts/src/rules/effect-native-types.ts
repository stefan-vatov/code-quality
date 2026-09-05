/* -------------------------------------------------------------------------- */
/*           Typed host objects exposed by Oxlint's native rule API.          */
/* -------------------------------------------------------------------------- */

import type { ASTNode } from './effect-ast';

/** The import declaration fragments used by Oxlint's scope definitions. */
export interface NativeImportNode {
  readonly importKind?: string;
}

/** The definition shape needed to distinguish imported bindings. */
export interface NativeDefinition {
  readonly node?: NativeImportNode | null;
  readonly parent?: NativeImportNode | null;
  readonly type?: string;
}

/** The resolved portion of one native scope reference. */
export interface NativeResolvedReference {
  readonly defs?: readonly NativeDefinition[];
}

/** The native scope reference fields consumed by the AST rules. */
export interface NativeReference {
  readonly identifier?: ASTNode;
  readonly resolved?: NativeResolvedReference | null;
}

/** One scope in Oxlint's native scope manager. */
export interface NativeScope {
  readonly references?: readonly NativeReference[];
}

/** The native scope manager fields consumed by the AST rules. */
export interface NativeScopeManager {
  readonly scopes?: readonly NativeScope[];
}

/** The narrow SourceCode host contract used by native-aware rules. */
export interface NativeSourceCode {
  readonly getText?: () => string;
  readonly isGlobalReference?: (node: ASTNode) => boolean;
  readonly scopeManager?: NativeScopeManager;
  readonly text?: string;
  readonly visitorKeys?: Readonly<Record<string, readonly string[]>>;
}
