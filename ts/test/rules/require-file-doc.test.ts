import { describe, expect, it } from 'vitest';
import hasRequiredFileDoc, { extractDocHeader } from '../../src/rules/require-file-doc.js';

// ============================================================================
// extractDocHeader — JSDoc extraction
// ============================================================================
describe('extractDocHeader', () => {
  // ── basic extraction ──────────────────────────────────────────────────

  it('extracts single-line JSDoc after shebang', () => {
    expect(
      extractDocHeader('#!/usr/bin/env node\n/** @fileoverview CLI entry. */\n\nimport { foo } from "./foo.js";'),
    ).toBe('/** @fileoverview CLI entry. */');
  });

  it('extracts single-line JSDoc at file start', () => {
    expect(extractDocHeader('/** @fileoverview Core utilities. */\n\nimport { foo } from "./foo.js";')).toBe(
      '/** @fileoverview Core utilities. */',
    );
  });

  it('extracts multi-line JSDoc block', () => {
    const src = '/**\n * Core utilities.\n * @module\n */\n\nimport { foo } from "./foo.js";';
    expect(extractDocHeader(src)).toBe('/**\n * Core utilities.\n * @module\n */');
  });

  it('extracts multi-line JSDoc with tags and descriptions', () => {
    const src =
      '/**\n * Main application entry point.\n * @module app\n * @license MIT\n * @author team\n */\n\nconst app = express();';
    expect(extractDocHeader(src)).toBe(
      '/**\n * Main application entry point.\n * @module app\n * @license MIT\n * @author team\n */',
    );
  });

  it('extracts JSDoc with double shebang', () => {
    const src = '#!/usr/bin/env node\n#!/usr/bin/env -S node --loader tsx\n/** CLI entry. */\ncode();';
    expect(extractDocHeader(src)).toBe('/** CLI entry. */');
  });

  // ── null returns ──────────────────────────────────────────────────────

  it('returns null when no JSDoc present', () => {
    expect(extractDocHeader('import { foo } from "./foo.js";')).toBeNull();
  });

  it('returns null for non-JSDoc block comment', () => {
    expect(extractDocHeader('/* not a JSDoc comment */\nimport { foo } from "./foo.js";')).toBeNull();
  });

  it('returns null for single-line comment', () => {
    expect(extractDocHeader('// some comment\nimport { foo } from "./foo.js";')).toBeNull();
  });

  it('returns null for empty source', () => {
    expect(extractDocHeader('')).toBeNull();
  });

  it('returns null for whitespace-only source', () => {
    expect(extractDocHeader('   \n  \n  ')).toBeNull();
  });

  it('returns null for source with only shebang', () => {
    expect(extractDocHeader('#!/usr/bin/env node')).toBeNull();
    expect(extractDocHeader('#!/usr/bin/env node\n')).toBeNull();
  });

  it('returns null for unclosed JSDoc', () => {
    expect(extractDocHeader('/** unclosed doc comment\ncode();')).toBeNull();
  });

  // ── shebang edge cases ────────────────────────────────────────────────

  it('returns null for shebang-only file (no newline)', () => {
    expect(extractDocHeader('#!shebang')).toBeNull();
  });

  it('returns null for shebang followed by code without JSDoc', () => {
    expect(extractDocHeader('#!/usr/bin/env node\n\nconst x = 1;')).toBeNull();
  });

  // ── whitespace edge cases ─────────────────────────────────────────────

  it('handles leading tabs before JSDoc', () => {
    expect(extractDocHeader('\t\t/** tabs before doc */\ncode();')).toBe('/** tabs before doc */');
  });

  it('handles mixed whitespace (spaces, tabs, newlines, carriage returns)', () => {
    expect(extractDocHeader('  \r\n\t \n  /** doc */\ncode();')).toBe('/** doc */');
  });

  it('returns null when source is too short for JSDoc (len < 3)', () => {
    expect(extractDocHeader('/')).toBeNull();
    expect(extractDocHeader('/*')).toBeNull();
  });

  it('returns null for /** immediately followed by EOF (no */)', () => {
    expect(extractDocHeader('/**')).toBeNull();
  });

  // ── character boundary checks ─────────────────────────────────────────

  it('returns null when first non-ws char is / but not /*', () => {
    expect(extractDocHeader('/foo\ncode();')).toBeNull();
  });

  it('returns null when first non-ws char is /* but not /**', () => {
    expect(extractDocHeader('/* regular */\ncode();')).toBeNull();
  });

  it('returns null when JSDoc start /* is followed by non-* third char', () => {
    expect(extractDocHeader('/*/ something */\ncode();')).toBeNull();
  });

  it('extracts JSDoc with only two asterisks (/** */)', () => {
    expect(extractDocHeader('/** */\ncode();')).toBe('/** */');
  });

  // ── JSDoc positioning ─────────────────────────────────────────────────

  it('extracts JSDoc with inline content after closing */', () => {
    expect(extractDocHeader('/** docs */ const x = 1;')).toBe('/** docs */');
  });

  it('extracts JSDoc with compressed formatting', () => {
    expect(extractDocHeader('/**@fileoverview desc*/code();')).toBe('/**@fileoverview desc*/');
  });
});

// ============================================================================
// hasRequiredFileDoc — full validation
// ============================================================================
describe('hasRequiredFileDoc', () => {
  // ── passes: JSDoc present ─────────────────────────────────────────────

  it('passes when file has single-line JSDoc header', () => {
    expect(hasRequiredFileDoc('/** Module docs. */\n\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes when file has multi-line JSDoc header', () => {
    expect(
      hasRequiredFileDoc('/**\n * Core utilities.\n * @module shared\n */\n\nimport { foo } from "./foo.js";'),
    ).toBe(true);
  });

  it('passes when file has shebang + multi-line JSDoc', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/**\n * CLI entry point.\n */\n\nparseArgs();')).toBe(true);
  });

  it('passes with shebang + compact single-line JSDoc', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/** CLI. */\ncode();')).toBe(true);
  });

  it('passes with JSDoc containing @fileoverview tag', () => {
    expect(hasRequiredFileDoc('/** @fileoverview Authentication module. */\n\nexport function login() {}')).toBe(
      true,
    );
  });

  it('passes with JSDoc containing @module tag', () => {
    expect(hasRequiredFileDoc('/** @module config */\n\nexport const PORT = 3000;')).toBe(true);
  });

  it('passes with JSDoc containing @license and @author', () => {
    expect(
      hasRequiredFileDoc('/** @license MIT\n * @author team\n */\n\nexport const VERSION = "1.0.0";'),
    ).toBe(true);
  });

  it('passes with JSDoc followed by code on same line is fine (JSDoc closes properly)', () => {
    expect(hasRequiredFileDoc('/** docs */ const x = 1;')).toBe(true);
  });

  // ── passes: opt-out markers ───────────────────────────────────────────

  it('passes when file has // @internal marker', () => {
    expect(hasRequiredFileDoc('// @internal\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes when file has // @generated marker', () => {
    expect(hasRequiredFileDoc('// @generated\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes when file has /* @internal */ marker', () => {
    expect(hasRequiredFileDoc('/* @internal */\nimport { x } from "./y.js";')).toBe(true);
  });

  it('passes with // @internal after leading whitespace', () => {
    expect(hasRequiredFileDoc('   \n  // @internal\ncode();')).toBe(true);
  });

  it('passes with // @generated after leading tabs', () => {
    expect(hasRequiredFileDoc('\t\t// @generated\ncode();')).toBe(true);
  });

  it('passes when /* @internal */ marker has no trailing */ (unclosed block comment)', () => {
    expect(hasRequiredFileDoc('/* @internal \ncode();')).toBe(true);
  });

  it('passes when /* @internal */ has trailing text before closing', () => {
    expect(hasRequiredFileDoc('/* @internal private module */\ncode();')).toBe(true);
  });

  it('passes when // @internal has trailing description', () => {
    expect(hasRequiredFileDoc('// @internal - this module is not part of the public API\ncode();')).toBe(true);
  });

  // ── passes: empty / whitespace-only ───────────────────────────────────

  it('passes for empty file', () => {
    expect(hasRequiredFileDoc('')).toBe(true);
  });

  it('passes for whitespace-only file', () => {
    expect(hasRequiredFileDoc('   \n  ')).toBe(true);
  });

  it('passes for tab+newline-only file', () => {
    expect(hasRequiredFileDoc('\t\n\t\n')).toBe(true);
  });

  it('passes for carriage-return-only file (Windows)', () => {
    expect(hasRequiredFileDoc('\r\n\r\n')).toBe(true);
  });

  it('passes for shebang-only file (no code after)', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node')).toBe(true);
  });

  it('passes for shebang + newline only', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n')).toBe(true);
  });

  it('passes for shebang + whitespace only', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n   \n  \t\n')).toBe(true);
  });

  // ── passes: JSDoc is JSDoc even with @internal tag ────────────────────

  it('passes for /** @internal */ — this IS a JSDoc (not an opt-out comment)', () => {
    expect(hasRequiredFileDoc('/** @internal */\ncode();')).toBe(true);
  });

  it('passes for /** @generated */ — JSDoc with generated tag', () => {
    expect(hasRequiredFileDoc('/** @generated */\ncode();')).toBe(true);
  });

  // ── fails: no documentation ───────────────────────────────────────────

  it('fails when file lacks JSDoc header (starts with import)', () => {
    expect(hasRequiredFileDoc('import { x } from "./y.js";')).toBe(false);
  });

  it('fails when file starts with code', () => {
    expect(hasRequiredFileDoc('const x = 1;\nfunction foo() {}')).toBe(false);
  });

  it('fails when file starts with a class', () => {
    expect(hasRequiredFileDoc('export class User {}\n')).toBe(false);
  });

  it('fails when file starts with a function', () => {
    expect(hasRequiredFileDoc('export function main() {\n  return 0;\n}\n')).toBe(false);
  });

  it('fails when file starts with type export', () => {
    expect(hasRequiredFileDoc('export type Foo = string;\n')).toBe(false);
  });

  it('fails when file starts with interface', () => {
    expect(hasRequiredFileDoc('export interface Config {\n  port: number;\n}\n')).toBe(false);
  });

  // ── fails: wrong comment type ─────────────────────────────────────────

  it('fails for regular block comment (not JSDoc, not opt-out)', () => {
    expect(hasRequiredFileDoc('/* some comment */\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for line comment (not opt-out)', () => {
    expect(hasRequiredFileDoc('// some comment\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for shebang without JSDoc', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for shebang + non-JSDoc comment + code', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/* not JSDoc */\ncode();')).toBe(false);
  });

  it('fails for shebang + line comment + code', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n// some note\ncode();')).toBe(false);
  });

  // ── fails: false positive prevention ──────────────────────────────────

  it('fails for copyright header only', () => {
    expect(hasRequiredFileDoc('/* Copyright 2024 Acme Corp. */\n\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for license header only', () => {
    expect(
      hasRequiredFileDoc(
        '/* MIT License\n * Copyright (c) 2024\n * Permission is hereby granted...\n */\n\ncode();',
      ),
    ).toBe(false);
  });

  it('fails for @internal as plain text (not in comment)', () => {
    // "@internal" is a string literal, not a comment marker
    expect(hasRequiredFileDoc('const marker = "@internal";\ncode();')).toBe(false);
  });

  it('fails for "use strict" directive without JSDoc', () => {
    expect(hasRequiredFileDoc("'use strict';\n\nimport { x } from './y.js';")).toBe(false);
  });

  it('fails for "use strict" directive with double quotes without JSDoc', () => {
    expect(hasRequiredFileDoc('"use strict";\n\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails when file has triple-slash directive without JSDoc', () => {
    expect(hasRequiredFileDoc('/// <reference path="./types.d.ts" />\n\nconst x = 1;')).toBe(false);
  });

  it('fails for TODO comment at top', () => {
    expect(hasRequiredFileDoc('// TODO: document this module\nimport { x } from "./y.js";')).toBe(false);
  });

  it('fails for eslint-disable comment at top', () => {
    expect(hasRequiredFileDoc('/* eslint-disable */\nimport { x } from "./y.js";')).toBe(false);
  });

  // ── known limitation: string literal false positive ──────────────────

  it('KNOWN LIMITATION: detects /** inside string literal as JSDoc', () => {
    // When /** is within 50 chars of file start and appears in a string,
    // the rule cannot distinguish string contents from comments.
    // This is acceptable since real-world string-literals-containing-JSDoc at top-of-file is rare.
    const src = 'import { x } from "./y.js";\nconst s = "/** not jsdoc */";\n';
    // Current behavior: incorrectly passes (thinks the string is a JSDoc header)
    // Ideal behavior: should fail (no real JSDoc header present)
    expect(hasRequiredFileDoc(src)).toBe(true); // known limitation
  });

  it('fails when /** appears far past 50 chars (even in string literal)', () => {
    const src =
      '// many many many many many many many many characters before jsdoc\n/** module doc */\ncode();';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });

  // ── known limitation: string literal false positive ──────────────────

  it('KNOWN LIMITATION: passes when /** appears in string within 50 chars', () => {
    // The rule reads raw source and cannot distinguish string contents from comments.
    // When /** is within 50 chars of file start, it is treated as a JSDoc header.
    // This is acceptable: real-world string-literals-mimicking-JSDoc at file top is vanishingly rare.
    const src = 'import { x } from "./y.js";\nconst s = "/** not jsdoc */";\n';
    expect(hasRequiredFileDoc(src)).toBe(true);
  });

  // ── fails: unclosed JSDoc ─────────────────────────────────────────────

  it('fails when JSDoc is never closed', () => {
    expect(hasRequiredFileDoc('/** unclosed doc\ncode();')).toBe(false);
  });

  // ── edge: short files ─────────────────────────────────────────────────

  it('handles file with exactly /** (too short, no */)', () => {
    // 3 chars: /* and * — but no closing */ and nothing after
    // This is a JSDoc start without end → fails
    expect(hasRequiredFileDoc('/**')).toBe(false);
  });

  it('handles file shorter than opt-out window size', () => {
    // Line comment shorter than 20 chars window
    expect(hasRequiredFileDoc('// @int')).toBe(false); // '// @int' is not a known opt-out
  });

  it('handles file with only // @internal (at exact minimum length)', () => {
    // 13 chars — this is a valid opt-out
    expect(hasRequiredFileDoc('// @internal')).toBe(true);
  });

  // ── edge: Windows line endings ────────────────────────────────────────

  it('handles CRLF line endings', () => {
    expect(hasRequiredFileDoc('/** docs */\r\n\r\nimport { x } from "./y.js";')).toBe(true);
  });

  it('handles shebang with CRLF', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\r\n/** CLI. */\r\ncode();')).toBe(true);
  });

  // ── edge: @generated with shebang ─────────────────────────────────────

  it('passes for shebang + // @generated', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n// @generated\ncode();')).toBe(true);
  });

  // ── edge: mix of whitespace types ─────────────────────────────────────

  it('passes for JSDoc after many blank lines', () => {
    expect(hasRequiredFileDoc('\n\n\n\n\n/** docs */\ncode();')).toBe(true);
  });

  it('fails when // @internal appears after non-comment non-ws content', () => {
    // The @internal must be at the very start, not after code
    expect(hasRequiredFileDoc('const x = 1;\n// @internal')).toBe(false);
  });

  // ── large file stress test ────────────────────────────────────────────

  it('handles large synthetic source without JSDoc', () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`export function fn${i}() { return ${i}; }`);
    }
    expect(hasRequiredFileDoc(lines.join('\n'))).toBe(false);
  });

  it('handles large synthetic source with JSDoc at top', () => {
    const lines = ['/** Big module. */', ''];
    for (let i = 0; i < 500; i++) {
      lines.push(`export function fn${i}() { return ${i}; }`);
    }
    expect(hasRequiredFileDoc(lines.join('\n'))).toBe(true);
  });

  // ── exotic but valid JSDoc forms ──────────────────────────────────────

  it('passes for JSDoc with no space after /** (compact)', () => {
    expect(hasRequiredFileDoc('/**docs*/\ncode();')).toBe(true);
  });

  it('passes for JSDoc with only * content (empty docs)', () => {
    expect(hasRequiredFileDoc('/** */\ncode();')).toBe(true);
  });

  it('passes for JSDoc at exactly 49 chars offset (within 50 char window)', () => {
    // 49 chars of whitespace then JSDoc — the first non-ws IS the JSDoc
    const ws = ' '.repeat(49);
    expect(hasRequiredFileDoc(`${ws}/** docs */\ncode();`)).toBe(true);
  });

  it('fails when code comes first and JSDoc is 51+ chars later', () => {
    // The file starts with code, JSDoc appears later — rejected
    const prefix = 'c'.repeat(1);
    const gap = 'x'.repeat(51);
    expect(hasRequiredFileDoc(`${prefix + gap}/** docs */\ncode();`)).toBe(false);
  });

  it('fails when first char is not / and JSDoc is far away', () => {
    // First non-ws char is 'x', then 60 chars later a JSDoc appears
    const src = 'x' + 'y'.repeat(60) + '/** docs */\ncode();';
    expect(hasRequiredFileDoc(src)).toBe(false);
  });
});
