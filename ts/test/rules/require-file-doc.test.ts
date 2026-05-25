import { describe, expect, it } from 'vitest';
import hasRequiredFileDoc, { extractDocHeader } from '../../src/rules/require-file-doc';

// ============================================================================
// extractDocHeader — JSDoc extraction
// ============================================================================
describe('extractDocHeader', (): void => {
  // ── basic extraction ──────────────────────────────────────────────────

  it('extracts single-line JSDoc after shebang', (): void => {
    expect(
      extractDocHeader(
        '#!/usr/bin/env node\n/** @fileoverview CLI entry. */\n\nimport { foo } from "./foo.js";',
      ),
    ).toBe('/** @fileoverview CLI entry. */');
  });

  it('extracts divider-style file headers', (): void => {
    const source = `/* -------------------------------------------------------------------------- */
/*                               Header comment                               */
/* -------------------------------------------------------------------------- */
import { value } from './value';
`;

    expect(extractDocHeader(source))
      .toBe(`/* -------------------------------------------------------------------------- */
/*                               Header comment                               */
/* -------------------------------------------------------------------------- */`);
  });

  it('extracts single-line JSDoc at file start', (): void => {
    expect(
      extractDocHeader('/** @fileoverview Core utilities. */\n\nimport { foo } from "./foo.js";'),
    ).toBe('/** @fileoverview Core utilities. */');
  });

  it('extracts multi-line JSDoc block', (): void => {
    const src = '/**\n * Core utilities.\n * @module\n */\n\nimport { foo } from "./foo.js";';
    expect(extractDocHeader(src)).toBe('/**\n * Core utilities.\n * @module\n */');
  });

  it('extracts multi-line JSDoc with tags and descriptions', (): void => {
    const src =
      '/**\n * Main application entry point.\n * @module app\n * @license MIT\n * @author team\n */\n\nconst app = express();';
    expect(extractDocHeader(src)).toBe(
      '/**\n * Main application entry point.\n * @module app\n * @license MIT\n * @author team\n */',
    );
  });

  it('extracts JSDoc with double shebang', (): void => {
    const src =
      '#!/usr/bin/env node\n#!/usr/bin/env -S node --loader tsx\n/** CLI entry. */\ncode();';
    expect(extractDocHeader(src)).toBe('/** CLI entry. */');
  });

  // ── undefined returns ──────────────────────────────────────────────────────

  it('returns undefined when no JSDoc present', (): void => {
    expect(extractDocHeader('import { foo } from "./foo.js";')).toBeUndefined();
  });

  it('returns undefined for non-JSDoc block comment', (): void => {
    expect(
      extractDocHeader('/* not a JSDoc comment */\nimport { foo } from "./foo.js";'),
    ).toBeUndefined();
  });

  it('returns undefined for single-line comment', (): void => {
    expect(extractDocHeader('// some comment\nimport { foo } from "./foo.js";')).toBeUndefined();
  });

  it('returns undefined for empty source', (): void => {
    expect(extractDocHeader('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only source', (): void => {
    expect(extractDocHeader('   \n  \n  ')).toBeUndefined();
  });

  it('returns undefined for source with only shebang', (): void => {
    expect(extractDocHeader('#!/usr/bin/env node')).toBeUndefined();
    expect(extractDocHeader('#!/usr/bin/env node\n')).toBeUndefined();
  });

  it('returns undefined for unclosed JSDoc', (): void => {
    expect(extractDocHeader('/** unclosed doc comment\ncode();')).toBeUndefined();
  });

  // ── shebang edge cases ────────────────────────────────────────────────

  it('returns undefined for shebang-only file (no newline)', (): void => {
    expect(extractDocHeader('#!shebang')).toBeUndefined();
  });

  it('returns undefined for shebang followed by code without JSDoc', (): void => {
    expect(extractDocHeader('#!/usr/bin/env node\n\nconst x = 1;')).toBeUndefined();
  });

  // ── whitespace edge cases ─────────────────────────────────────────────

  it('handles leading tabs before JSDoc', (): void => {
    expect(extractDocHeader('\t\t/** tabs before doc */\ncode();')).toBe('/** tabs before doc */');
  });

  it('handles mixed whitespace (spaces, tabs, newlines, carriage returns)', (): void => {
    expect(extractDocHeader('  \r\n\t \n  /** doc */\ncode();')).toBe('/** doc */');
  });

  it('returns undefined when source is too short for JSDoc (len < 3)', (): void => {
    expect(extractDocHeader('/')).toBeUndefined();
    expect(extractDocHeader('/*')).toBeUndefined();
  });

  it('returns undefined for /** immediately followed by EOF (no */)', (): void => {
    expect(extractDocHeader('/**')).toBeUndefined();
  });

  // ── character boundary checks ─────────────────────────────────────────

  it('returns undefined when first non-ws char is / but not /*', (): void => {
    expect(extractDocHeader('/foo\ncode();')).toBeUndefined();
  });

  it('returns undefined when first non-ws char is /* but not /**', (): void => {
    expect(extractDocHeader('/* regular */\ncode();')).toBeUndefined();
  });

  it('returns undefined when JSDoc start /* is followed by non-* third char', (): void => {
    expect(extractDocHeader('/*/ something */\ncode();')).toBeUndefined();
  });

  it('extracts JSDoc with only two asterisks (/** */)', (): void => {
    expect(extractDocHeader('/** */\ncode();')).toBe('/** */');
  });

  // ── JSDoc positioning ─────────────────────────────────────────────────

  it('extracts JSDoc with inline content after closing */', (): void => {
    expect(extractDocHeader('/** docs */ const x = 1;')).toBe('/** docs */');
  });

  it('extracts JSDoc with compressed formatting', (): void => {
    expect(extractDocHeader('/**@fileoverview desc*/code();')).toBe('/**@fileoverview desc*/');
  });
});

// ============================================================================
// hasRequiredFileDoc — full validation
// ============================================================================
describe('hasRequiredFileDoc', (): void => {
  // ── fails: JSDoc is declaration/API documentation, not a file header ──

  it('fails when file has single-line JSDoc instead of a divider header', (): void => {
    expect(hasRequiredFileDoc('/** Module docs. */\n\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails when file has multi-line JSDoc instead of a divider header', (): void => {
    expect(
      hasRequiredFileDoc(
        '/**\n * Core utilities.\n * @module shared\n */\n\nimport { foo } from "./foo.js";',
      ),
    ).toBe(false);
  });

  it('fails when file has shebang plus multi-line JSDoc instead of a divider header', (): void => {
    expect(
      hasRequiredFileDoc('#!/usr/bin/env node\n/**\n * CLI entry point.\n */\n\nparseArgs();'),
    ).toBe(false);
  });

  it('fails with shebang plus compact single-line JSDoc', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/** CLI. */\ncode();')).toBe(false);
  });

  it('fails with JSDoc containing @fileoverview tag', (): void => {
    expect(
      hasRequiredFileDoc(
        '/** @fileoverview Authentication module. */\n\nexport function login() {}',
      ),
    ).toBe(false);
  });

  it('fails with JSDoc containing @module tag', (): void => {
    expect(hasRequiredFileDoc('/** @module config */\n\nexport const PORT = 3000;')).toBe(false);
  });

  it('fails with JSDoc containing @license and @author', (): void => {
    expect(
      hasRequiredFileDoc(
        '/** @license MIT\n * @author team\n */\n\nexport const VERSION = "1.0.0";',
      ),
    ).toBe(false);
  });

  it('fails with JSDoc followed by code on the same line', (): void => {
    expect(hasRequiredFileDoc('/** docs */ const x = 1;')).toBe(false);
  });

  // ── passes: opt-out markers ───────────────────────────────────────────

  it('passes when file has // @internal marker', (): void => {
    expect(hasRequiredFileDoc('// @internal\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes when file has // @generated marker', (): void => {
    expect(hasRequiredFileDoc('// @generated\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes when file has /* @internal */ marker', (): void => {
    expect(hasRequiredFileDoc('/* @internal */\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes with // @internal after leading whitespace', (): void => {
    expect(hasRequiredFileDoc('   \n  // @internal\ncode();')).toBe(true);
  });

  it('passes with // @generated after leading tabs', (): void => {
    expect(hasRequiredFileDoc('\t\t// @generated\ncode();')).toBe(true);
  });

  it('passes when /* @internal */ marker has no trailing */ (unclosed block comment)', (): void => {
    expect(hasRequiredFileDoc('/* @internal \ncode();')).toBe(true);
  });

  it('passes when /* @internal */ has trailing text before closing', (): void => {
    expect(hasRequiredFileDoc('/* @internal private module */\ncode();')).toBe(true);
  });

  it('passes when // @internal has trailing description', (): void => {
    expect(
      hasRequiredFileDoc('// @internal - this module is not part of the public API\ncode();'),
    ).toBe(true);
  });

  // ── passes: empty / whitespace-only ───────────────────────────────────

  it('passes for empty file', (): void => {
    expect(hasRequiredFileDoc('')).toBe(true);
  });

  it('passes for whitespace-only file', (): void => {
    expect(hasRequiredFileDoc('   \n  ')).toBe(true);
  });

  it('passes for tab+newline-only file', (): void => {
    expect(hasRequiredFileDoc('\t\n\t\n')).toBe(true);
  });

  it('passes for carriage-return-only file (Windows)', (): void => {
    expect(hasRequiredFileDoc('\r\n\r\n')).toBe(true);
  });

  it('passes for shebang-only file (no code after)', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node')).toBe(true);
  });

  it('passes for shebang + newline only', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n')).toBe(true);
  });

  it('passes for shebang + whitespace only', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n   \n  \t\n')).toBe(true);
  });

  // ── fails: JSDoc tags are not file-header opt-outs ────────────────────

  it('fails for /** @internal */ because it is JSDoc, not an opt-out comment', (): void => {
    expect(hasRequiredFileDoc('/** @internal */\ncode();')).toBe(false);
  });

  it('fails for /** @generated */ because it is JSDoc, not an opt-out comment', (): void => {
    expect(hasRequiredFileDoc('/** @generated */\ncode();')).toBe(false);
  });

  // ── fails: no documentation ───────────────────────────────────────────

  it('fails when file lacks JSDoc header (starts with import)', (): void => {
    expect(hasRequiredFileDoc('import { x } from "./y.js";')).toBe(false);
  });

  it('fails when file starts with code', (): void => {
    expect(hasRequiredFileDoc('const x = 1;\nfunction foo() {}')).toBe(false);
  });

  it('fails when file starts with a class', (): void => {
    expect(hasRequiredFileDoc('export class User {}\n')).toBe(false);
  });

  it('fails when file starts with a function', (): void => {
    expect(hasRequiredFileDoc('export function main() {\n  return 0;\n}\n')).toBe(false);
  });

  it('fails when file starts with type export', (): void => {
    expect(hasRequiredFileDoc('export type Foo = string;\n')).toBe(false);
  });

  it('fails when file starts with interface', (): void => {
    expect(hasRequiredFileDoc('export interface Config {\n  port: number;\n}\n')).toBe(false);
  });

  it('fails when file starts with declaration JSDoc instead of a divider file header', (): void => {
    expect(
      hasRequiredFileDoc('/** Documents the exported function. */\nexport function main() {}\n'),
    ).toBe(false);
  });

  // ── fails: wrong comment type ─────────────────────────────────────────

  it('fails for regular block comment (not JSDoc, not opt-out)', (): void => {
    expect(hasRequiredFileDoc('/* some comment */\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for line comment (not opt-out)', (): void => {
    expect(hasRequiredFileDoc('// some comment\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for shebang without JSDoc', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for shebang + non-JSDoc comment + code', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/* not JSDoc */\ncode();')).toBe(false);
  });

  it('fails for shebang + line comment + code', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n// some note\ncode();')).toBe(false);
  });

  // ── fails: false positive prevention ──────────────────────────────────

  it('fails for copyright header only', (): void => {
    expect(
      hasRequiredFileDoc('/* Copyright 2024 Acme Corp. */\n\nimport { x } from "./y.js";'),
    ).toBe(false);
  });

  it('fails for license header only', (): void => {
    expect(
      hasRequiredFileDoc(
        '/* MIT License\n * Copyright (c) 2024\n * Permission is hereby granted...\n */\n\ncode();',
      ),
    ).toBe(false);
  });

  it('fails for @internal as plain text (not in comment)', (): void => {
    // "@internal" is a string literal, not a comment marker
    expect(hasRequiredFileDoc('const marker = "@internal";\ncode();')).toBe(false);
  });

  it('fails for "use strict" directive without JSDoc', (): void => {
    expect(hasRequiredFileDoc("'use strict';\n\nimport { x } from './y.js';")).toBe(false);
  });

  it('fails for "use strict" directive with double quotes without JSDoc', (): void => {
    expect(hasRequiredFileDoc('"use strict";\n\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails when file has triple-slash directive without JSDoc', (): void => {
    expect(hasRequiredFileDoc('/// <reference path="./types.d.ts" />\n\nconst x = 1;')).toBe(false);
  });

  it('fails for TODO comment at top', (): void => {
    expect(hasRequiredFileDoc('// TODO: document this module\nimport { x } from "./y.js";')).toBe(
      false,
    );
  });

  it('fails for eslint-disable comment at top', (): void => {
    expect(hasRequiredFileDoc('/* eslint-disable */\nimport { x } from "./y.js";')).toBe(false);
  });

  // ── false positive prevention ────────────────────────────────────────

  it('fails when /** appears inside a string literal near the file start', (): void => {
    const src = 'import { x } from "./y.js";\nconst s = "/** not jsdoc */";\n';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });

  it('fails when /** appears far past 50 chars (even in string literal)', (): void => {
    const src =
      '// many many many many many many many many characters before jsdoc\n/** module doc */\ncode();';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });

  it('fails when /** appears in a string within 50 chars', (): void => {
    const src = 'import { x } from "./y.js";\nconst s = "/** not jsdoc */";\n';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });

  // ── fails: unclosed JSDoc ─────────────────────────────────────────────

  it('fails when JSDoc is never closed', (): void => {
    expect(hasRequiredFileDoc('/** unclosed doc\ncode();')).toBe(false);
  });

  // ── edge: short files ─────────────────────────────────────────────────

  it('handles file with exactly /** (too short, no */)', (): void => {
    // 3 chars: /* and * — but no closing */ and nothing after
    // This is a JSDoc start without end → fails
    expect(hasRequiredFileDoc('/**')).toBe(false);
  });

  it('handles file shorter than opt-out window size', (): void => {
    // Line comment shorter than 20 chars window
    expect(hasRequiredFileDoc('// @int')).toBe(false); // '// @int' is not a known opt-out
  });

  it('handles file with only // @internal (at exact minimum length)', (): void => {
    // 13 chars — this is a valid opt-out
    expect(hasRequiredFileDoc('// @internal')).toBe(true);
  });

  // ── edge: Windows line endings ────────────────────────────────────────

  it('handles CRLF line endings', (): void => {
    expect(hasRequiredFileDoc('/** docs */\r\n\r\nimport { x } from "./y.js";')).toBe(false);
  });

  it('passes for divider-style file headers', (): void => {
    const source = `/* -------------------------------------------------------------------------- */
/*                               Header comment                               */
/* -------------------------------------------------------------------------- */
import { value } from './value';
`;

    expect(hasRequiredFileDoc(source)).toBe(true);
  });

  it('passes when divider header is useful but not exact fixed-width format', (): void => {
    const source = `/* ------------------------- */
/* Header comment */
/* ------------------------- */
import { value } from './value';
`;

    expect(hasRequiredFileDoc(source)).toBe(true);
  });

  it('passes for shebang plus tool directive before divider header', (): void => {
    const source = `#!/usr/bin/env node
/* eslint-disable no-console */
/* --- */
/* CLI entrypoint for local developer tooling. */
/* --- */
console.log('ok');
`;

    expect(hasRequiredFileDoc(source)).toBe(true);
  });

  it('passes for CRLF divider headers', (): void => {
    const source =
      '/* --- */\r\n/* Cross-platform file-level documentation. */\r\n/* --- */\r\ncode();';

    expect(hasRequiredFileDoc(source)).toBe(true);
  });

  it('fails when flexible divider body has no meaningful text', (): void => {
    const source = `/* --- */
/* --- */
/* --- */
code();
`;

    expect(hasRequiredFileDoc(source)).toBe(false);
  });

  it('handles shebang with CRLF', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\r\n/** CLI. */\r\ncode();')).toBe(false);
  });

  // ── edge: @generated with shebang ─────────────────────────────────────

  it('passes for shebang + // @generated', (): void => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n// @generated\ncode();')).toBe(true);
  });

  // ── edge: mix of whitespace types ─────────────────────────────────────

  it('fails for JSDoc after many blank lines', (): void => {
    expect(hasRequiredFileDoc('\n\n\n\n\n/** docs */\ncode();')).toBe(false);
  });

  it('fails when // @internal appears after non-comment non-ws content', (): void => {
    // The @internal must be at the very start, not after code
    expect(hasRequiredFileDoc('const x = 1;\n// @internal')).toBe(false);
  });

  // ── large file stress test ────────────────────────────────────────────

  it('handles large synthetic source without JSDoc', (): void => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`export function fn${i}() { return ${i}; }`);
    }
    expect(hasRequiredFileDoc(lines.join('\n'))).toBe(false);
  });

  it('fails for large synthetic source with only JSDoc at top', (): void => {
    const lines = ['/** Big module. */', ''];
    for (let i = 0; i < 500; i++) {
      lines.push(`export function fn${i}() { return ${i}; }`);
    }
    expect(hasRequiredFileDoc(lines.join('\n'))).toBe(false);
  });

  // ── exotic but valid JSDoc forms ──────────────────────────────────────

  it('fails for JSDoc with no space after /** (compact)', (): void => {
    expect(hasRequiredFileDoc('/**docs*/\ncode();')).toBe(false);
  });

  it('fails for JSDoc with only * content (empty docs)', (): void => {
    expect(hasRequiredFileDoc('/** */\ncode();')).toBe(false);
  });

  it('fails for JSDoc at exactly 49 chars offset', (): void => {
    const ws = ' '.repeat(49);
    expect(hasRequiredFileDoc(`${ws}/** docs */\ncode();`)).toBe(false);
  });

  it('fails when code comes first and JSDoc is 51+ chars later', (): void => {
    // The file starts with code, JSDoc appears later — rejected
    const prefix = 'c'.repeat(1);
    const gap = 'x'.repeat(51);
    expect(hasRequiredFileDoc(`${prefix + gap}/** docs */\ncode();`)).toBe(false);
  });

  it('fails when first char is not / and JSDoc is far away', (): void => {
    // First non-ws char is 'x', then 60 chars later a JSDoc appears
    const src = 'x' + 'y'.repeat(60) + '/** docs */\ncode();';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });
});
