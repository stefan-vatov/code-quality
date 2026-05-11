import { describe, expect, it } from 'vitest';
import hasRequiredFileDoc, { extractDocHeader } from '../../src/rules/require-file-doc.js';

describe('extractDocHeader', () => {
  it('extracts JSDoc header after shebang', () => {
    const source = `#!/usr/bin/env node\n/** @fileoverview CLI entry point. */\n\nimport { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBe('/** @fileoverview CLI entry point. */');
  });

  it('extracts JSDoc header at file start', () => {
    const source = `/** @fileoverview Core utilities. */\n\nimport { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBe('/** @fileoverview Core utilities. */');
  });

  it('returns null when no JSDoc header present', () => {
    const source = `import { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBeNull();
  });

  it('returns null when comment is not JSDoc-style', () => {
    const source = `/* not a JSDoc comment */\nimport { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBeNull();
  });

  it('returns null for single-line comment', () => {
    const source = `// some comment\nimport { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBeNull();
  });

  it('handles multi-line JSDoc block', () => {
    const source = `/**\n * Core utilities.\n * @package\n */\n\nimport { foo } from './foo.js';`;
    expect(extractDocHeader(source)).toBe('/**\n * Core utilities.\n * @package\n */');
  });

  it('ignores shebang and gets JSDoc', () => {
    const source = `#!/usr/bin/env node\n#!/usr/bin/env -S node --loader tsx\n/** CLI entry. */\ncode();`;
    expect(extractDocHeader(source)).toBe('/** CLI entry. */');
  });

  it('returns null for empty source', () => {
    expect(extractDocHeader('')).toBeNull();
  });

  it('returns null for whitespace-only source', () => {
    expect(extractDocHeader('   \n  \n  ')).toBeNull();
  });
});

describe('hasRequiredFileDoc', () => {
  it('returns true when file has JSDoc header', () => {
    expect(hasRequiredFileDoc('/** Module docs. */\n\nimport { x } from "./y.js";')).toBe(true);
  });

  it('returns true when file has @internal marker', () => {
    expect(hasRequiredFileDoc('// @internal\nimport { x } from "./y.js";')).toBe(true);
    expect(hasRequiredFileDoc('/* @internal */\nimport { x } from "./y.js";')).toBe(true);
  });

  it('returns true when file has @generated marker', () => {
    expect(hasRequiredFileDoc('// @generated\nimport { x } from "./y.js";')).toBe(true);
  });

  it('returns true for empty file', () => {
    expect(hasRequiredFileDoc('')).toBe(true);
  });

  it('returns true for whitespace-only file', () => {
    expect(hasRequiredFileDoc('   \n  ')).toBe(true);
  });

  it('returns true for shebang + JSDoc', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/** CLI. */\ncode();')).toBe(true);
  });

  it('returns false when file lacks JSDoc header', () => {
    expect(hasRequiredFileDoc('import { x } from "./y.js";')).toBe(false);
  });

  it('returns false when only a regular comment exists', () => {
    expect(hasRequiredFileDoc('/* some comment */\nimport { x } from "./y.js";')).toBe(false);
    expect(hasRequiredFileDoc('// some comment\nimport { x } from "./y.js";')).toBe(false);
  });

  it('returns false for shebang without JSDoc', () => {
    expect(hasRequiredFileDoc('#!/usr/bin/env node\nimport { x } from "./y.js";')).toBe(false);
  });

  it('considers first non-shebang content as the header start', () => {
    // Shebang then regular comment (not JSDoc) then code = no valid header
    expect(hasRequiredFileDoc('#!/usr/bin/env node\n/* not JSDoc */\ncode();')).toBe(false);
  });
});
