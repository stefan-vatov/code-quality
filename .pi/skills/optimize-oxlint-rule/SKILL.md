# Optimize an Oxlint custom rule to its performance limit

Use this skill when you have a working custom Oxlint rule (built via the `oxlint-custom-rule` skill) and need to push its performance to the absolute ceiling. This is a **100-pass optimization framework** — each pass targets a specific category, from algorithmic rewrites down to single-instruction micro-tweaks.

## When to use

- New rule is passing tests but you want it production-grade fast
- Existing rule is showing up as a hotspot in Oxlint `TIMING` output
- Preparing a rule for inclusion in a large monorepo where nanoseconds add up
- After any functional change to a rule — re-run the full pipeline

## Architecture of the optimization pipeline

```
ts/bench/
├─ benchmark.ts      ← Reusable micro-benchmark runner (warmup, median, p95)
├─ fixtures.ts       ← Fixture generators for all rule categories
└─ run-all.ts        ← Master runner: one command benchmarks everything

ts/src/rules/
├─ char-class.ts     ← 256-byte Uint8Array character class table (shared)
├─ <rule>.ts         ← Rule implementations (use char-class.ts)
└─ ...
```

## Phase 1: Establish baseline (passes 0-5)

**1. Run the benchmark harness.**

```bash
node --import tsx ts/bench/run-all.ts
```

Capture every rule's ops/sec, median, and p95. Save as baseline.

**2. Identify the hot path.**

For every heuristic function, ask: what does it spend time on?

- String allocations (`toLowerCase()`, `slice()`, `split()`, regex)
- Per-character loops (look for `charCodeAt` in a for-loop body)
- Function call overhead (look for helpers called millions of times)
- GC pressure (look for temporary arrays/Strings created per invocation)

**3. Classify the rule type.**

| Type                     | Example                       | Hot path                    | Optimization strategy                  |
| ------------------------ | ----------------------------- | --------------------------- | -------------------------------------- |
| Simple boolean check     | `isPascalCase`, `isCamelCase` | charCodeAt comparisons      | Class table, indexOf, early exit       |
| Prefix/suffix check      | `hasBooleanPrefix`            | Regex or multi-char scan    | Manual charCodeAt switch               |
| Word decomposition       | `findMisCasedAcronyms`        | splitMixedCase + Set lookup | Index tracking, LRU cache, class table |
| Multi-line text analysis | `isCommentedOutCode`          | split() + regex loop        | Pre-compiled regex, indexOf scan       |

## Phase 2: Data-structure pre-computation (passes 6-20)

### The character class table (highest-impact single optimization)

This is the **single most impactful optimization**. Build it once, use it everywhere.

```typescript
// ts/src/rules/char-class.ts
// 256-byte Uint8Array: one lookup replaces 2-3 comparisons.
const CHAR_CLASS = new Uint8Array(128);

for (let idx = 65; idx <= 90; idx++) CHAR_CLASS[idx] = 1; // A-Z
for (let idx = 97; idx <= 122; idx++) CHAR_CLASS[idx] = 2; // a-z
for (let idx = 48; idx <= 57; idx++) CHAR_CLASS[idx] = 4; // 0-9
CHAR_CLASS[95] = 8; // _

const CLS_UPPER = 1;
const CLS_LOWER = 2;
const CLS_DIGIT = 4;

// Usage in every rule:
//   (CHAR_CLASS[code] & CLS_UPPER) !== 0   ← replaces: code >= 65 && code <= 90
//   (CHAR_CLASS[code] & CLS_LOWER) !== 0   ← replaces: code >= 97 && code <= 122
```

**Why it works:** V8's typed array access is ~1ns. Two comparisons + logical AND is ~4ns. Over 100K iterations with 20-char identifiers, that's millions of saved operations.

**Rule:** Every new rule that examines character codes MUST use the class table. Define `isUp`/`isLo` helpers as module-level arrow functions for V8 inlining:

```typescript
import { CHAR_CLASS, CLS_UPPER, CLS_LOWER } from './char-class.js';
const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;
const isLo = (code: number): boolean => (CHAR_CLASS[code] & CLS_LOWER) !== 0;
```

### LRU caching for repeated work

If your rule processes the same identifiers repeatedly (they will — a codebase reuses type names, variable names, and import paths hundreds of times), cache the results:

```typescript
const CACHE_MAX = 4096;
const cache = new Map<string, ResultType>();

function addToCache(key: string, value: ResultType): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
}

// In the rule:
const cached = cache.get(name);
if (cached !== undefined) {
  // LRU refresh: delete + re-insert moves to end
  cache.delete(name);
  cache.set(name, cached);
  return cached;
}
```

**Cache sizing:**

- 256 entries: minimal memory (~16KB), useful for single-file linting
- 1,024 entries: sweet spot for medium projects
- 4,096 entries: large monorepo, still <1MB memory
- Never exceed 16,384 — diminishing returns, GC pressure

**What to cache:**

- SplitMixedCase results (list of words from an identifier)
- Violation arrays (list of mis-cased acronyms found)
- Any computation involving Set/HashMap lookups with `toLowerCase()`

**What NOT to cache:**

- Simple boolean checks (isPascalCase, isCamelCase) — the check is cheaper than the cache lookup
- Results that depend on mutable state
- Results for identifiers shorter than 4 chars

### Pre-compiled regex patterns

Every regex literal in a function body is re-compiled on every call if the function isn't optimized by V8. Hoist to module scope:

```typescript
// BAD — compiled every call if function deoptimizes
function check(text: string) {
  return /pattern/.test(text);
}

// GOOD — compiled once at module load
const RE_PATTERN = /pattern/;
function check(text: string) {
  return RE_PATTERN.test(text);
}
```

### Pre-computed acronym/keyword Sets

If your rule checks against a fixed set of strings, store them in a `Set` at module level. `Set.has()` is O(1) average with a very low constant factor in V8.

For case-insensitive lookups: store lowercase versions. Then check `set.has(word.toLowerCase())` — OR, if most words are already lowercase (common for identifiers), add a pre-check:

```typescript
// Avoid toLowerCase() allocation for already-lowercase words
const key = isAllLower(alpha) ? alpha : alpha.toLowerCase();
if (acronyms.has(key)) {
  /* ... */
}
```

## Phase 3: Algorithmic rewrites (passes 21-40)

### Replace regex with manual charCodeAt scanning

Regex is convenient but has setup cost. For prefix matching, character-by-character `charCodeAt` comparison is faster:

```typescript
// BAD — regex for simple prefix match
function hasPrefix(name: string): boolean {
  return /^(is|has|should)(.)/i.test(name);
}

// GOOD — manual charCodeAt (case-insensitive via arithmetic)
function hasPrefix(name: string): boolean {
  const c0 = name.charCodeAt(0);
  if (c0 === 105 || c0 === 73) {
    // 'i' or 'I'
    const c1 = name.charCodeAt(1);
    if (c1 !== 115 && c1 !== 83) return false; // 's' or 'S'
    const next = name.charCodeAt(2);
    return next === 95 || isUpper(next) || isDigit(next);
  }
  // ... has, should
}
```

**Rule of thumb:** Replace regex with manual scan if:

- The pattern is a fixed prefix/suffix (not variable-length)
- The function is called >10K times per lint run
- The regex contains alternation (`|`) or lookahead/lookbehind

Keep regex for:

- Patterns that are fundamentally variable-length (e.g., `/\b\w+\s*=\s*[^=]/`)
- One-time validation (setup code, config parsing)
- Patterns that would require >20 lines of manual code

### Replace split() with indexOf line scanning

`string.split('\n')` allocates an array of all lines. For large comment blocks, this is measurable. Use `indexOf` scanning instead:

```typescript
// BAD — allocates array
const lines = text.split('\n');
for (const line of lines) {
  /* ... */
}

// GOOD — indexOf scanning, zero allocation
let pos = 0;
const len = text.length;
while (pos < len) {
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = len;
  // Process text.slice(pos, lineEnd)
  pos = lineEnd + 1;
}
```

### Replace per-char string concatenation with index tracking

Building strings character-by-character in a loop creates O(n²) garbage. Use index tracking + single `slice()` at word boundaries:

```typescript
// BAD — new string allocated every character
let current = '';
for (const ch of name) {
  current += ch; // Allocates!
  if (boundary) {
    words.push(current);
    current = '';
  }
}

// GOOD — track indices, slice once per word
let wordStart = 0;
for (let idx = 1; idx < len; idx++) {
  if (boundary) {
    words.push(name.slice(wordStart, idx));
    wordStart = idx;
  }
}
words.push(name.slice(wordStart));
```

**Warning:** `slice()` creates a "SlicedString" in V8 that holds a reference to the parent string. For very long parent strings, this can be a memory leak. For identifiers (typically 5-50 chars), this is harmless.

### Replace split().filter().map().join() with manual scanning

This pattern creates 3 intermediate arrays. Replace with a single manual scan:

```typescript
// BAD — 3 intermediate arrays
function toCamelCase(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

// GOOD — single scan, no intermediate arrays
function toCamelCase(name: string): string {
  let start = 0;
  // Skip leading underscores
  while (start < name.length && name.charCodeAt(start) === 95) start++;
  // ... process segments manually
}
```

## Phase 4: Micro-optimizations (passes 41-80)

### Arrow functions for hot helpers

V8's inline caches (ICs) are more aggressive with arrow functions. Define helpers as `const` arrows at module level:

```typescript
// PREFERRED — V8 inlines aggressively
const isUp = (code: number): boolean => (CHAR_CLASS[code] & CLS_UPPER) !== 0;

// AVOID for hot paths — may not inline
function isUpper(code: number): boolean {
  return (CHAR_CLASS[code] & CLS_UPPER) !== 0;
}
```

### indexOf over includes for single-character search

`name.includes('_')` is semantically clearer but `name.indexOf('_') === -1` is ~10% faster because V8 has a dedicated fast path for single-character `indexOf`:

```typescript
// PREFERRED
if (name.indexOf('_') !== -1) return false;

// SLOWER
if (name.includes('_')) return false;
```

### charCodeAt over charAt + comparison

`charAt()` returns a 1-char string; `charCodeAt()` returns a number. Number comparisons are faster:

```typescript
// PREFERRED
name.charCodeAt(0) === 95; // '_' check

// SLOWER
name[0] === '_'; // Still works but less fast
name.charAt(0) === '_'; // Allocates a 1-char string
```

### Magic number constants

Extract repeated magic numbers as named constants at module scope. V8 can constant-fold them:

```typescript
const DIGIT_0 = 48;
const DIGIT_9 = 57;
const UNDERSCORE = 95;

// Then use:
if (code < DIGIT_0 || code > DIGIT_9) break;
```

### Early-exit ordering

Order checks from most-likely-to-fail to least-likely. For identifier validation:

```typescript
function isPascalCase(name: string): boolean {
  const len = name.length;
  if (len === 0) return false; // 1. Trivial reject
  if (!isUp(name.charCodeAt(0))) return false; // 2. First-char check (common fail)
  if (name.indexOf('_') !== -1) return false; // 3. Underscore check (rare)
  // ... expensive checks last
}
```

### Hoist length to local variable

`string.length` is fast but not free. Cache it in a local:

```typescript
const len = name.length;
for (let idx = 0; idx < len; idx++) {
  /* ... */
}
```

### Avoid toLowerCase/toUpperCase when unnecessary

These allocate new strings. Guard with a pre-check:

```typescript
// Before lowercasing, check if already lowercase
const key = isAllLower(alpha, alphaEnd) ? alpha : alpha.toLowerCase();
```

### Inline single-use helpers

If a helper is called from exactly one location and is short (<5 lines), inline it:

```typescript
// Instead of:  if (isAllUpper(word)) ...
// Inline:      check in the calling loop directly
```

### Use const over let when value never reassigned

This isn't just style — V8's type feedback differentiates const/let and can optimize const more aggressively.

## Phase 5: SWAR-adjacent patterns (passes 81-90)

### What SWAR is and why we use its ideas

SWAR = SIMD Within A Register. Process multiple bytes in one CPU instruction using bitwise operations on a wide register (32 or 64 bits).

**JavaScript limitation:** Bitwise operators (`|`, `&`, `^`, `<<`, `>>`) truncate to 32 bits. You cannot do true 64-bit SWAR in JS without BigInt (which is slower than char-by-char for short strings).

**What we use instead:** The character class table achieves the same conceptual goal (batch character classification) through a different mechanism — a single array lookup per character instead of multiple comparisons.

### When SWAR would help (and why we don't use it)

- **BigInt SWAR:** Can process 8 bytes at once, but BigInt construction + bitwise ops cost more than 8× `charCodeAt` calls for strings under ~200 chars. Our identifiers are 5-50 chars.
- **32-bit SWAR (Number):** Can process 4 bytes at once. Viable but adds ~10 lines of bit-manipulation code per check. Only worth it for functions called >50M times per lint run.
- **TypedArray views:** `Uint8Array` over a string doesn't work directly in JS. You'd need `TextEncoder.encode()` which allocates.

**Verdict:** The class table + indexOf combination achieves 95%+ of theoretical SWAR gains with 5% of the code complexity.

## Phase 6: Final tuning (passes 91-100)

### Remove dead code

After all optimizations, check for:

- Unused imports and constants
- Helper functions that were inlined but not deleted
- Assertions or debug code
- Commented-out alternative implementations

### Re-run benchmarks and verify no regression

```bash
pnpm --dir ts build
npx vitest run --config vitest.config.mts ts/test/rules/
node --import tsx ts/bench/run-all.ts
```

### Verify mutation scores

```bash
pnpm stryker run
```

Mutation scores should not regress. If they drop below 50%, the optimization made the code harder to test — add tests for the new branches.

### Document the gains

Record before/after in the commit message. Every optimization pass should have measurable evidence.

## Bench harness reference

### Adding a new rule to benchmarks

1. Add fixture generator to `ts/bench/fixtures.ts`
2. Add import and benchmark call to `ts/bench/run-all.ts`
3. Run: `node --import tsx ts/bench/run-all.ts`

### Fixture design rules

- **100-500 unique inputs** per rule for proper cache-busting
- Include edge cases: empty string, single char, all-caps, all-lower, mixed
- Include realistic identifiers from actual codebases
- Include "false friends" (e.g., `island` for boolean prefix check)
- Include very long inputs (50+ chars) for stress testing

### Interpreting results

| Median latency | Assessment                                                         |
| -------------- | ------------------------------------------------------------------ |
| <50ns          | **Optimal.** Any further optimization is diminishing returns.      |
| 50-100ns       | **Excellent.** Potentially optimizable but gains will be marginal. |
| 100-500ns      | **Good.** Room for improvement. Focus on the hot loop.             |
| 500ns-1μs      | **Needs work.** Look for unnecessary allocations.                  |
| >1μs           | **Slow.** Algorithmic rewrite needed.                              |

| Ops/sec (heuristic only) | Assessment                                                                |
| ------------------------ | ------------------------------------------------------------------------- |
| >20M                     | **Exceptional.** Single-digit nanosecond checks.                          |
| 10-20M                   | **Very good.** Production-grade.                                          |
| 5-10M                    | **Solid.** Cache or pre-compute if called frequently.                     |
| 1-5M                     | **Acceptable.** Only if the function does real work (regex, Set lookups). |
| <1M                      | **Concerning.** Profile and identify the bottleneck.                      |

## Optimization checklist for new rules

Before declaring a rule "done":

- [ ] Uses `char-class.ts` for all character classification
- [ ] Regex patterns are pre-compiled at module scope
- [ ] No `split()` in hot paths (use `indexOf` scanning)
- [ ] No per-character string concatenation (use index tracking)
- [ ] No `split().filter().map().join()` chains (manual scan)
- [ ] Early-exit: most common failures checked first
- [ ] Identifiers cached via LRU if same values repeat
- [ ] `indexOf('_')` used instead of `includes('_')`
- [ ] `charCodeAt()` used instead of `charAt()` or `[index]`
- [ ] `toLowerCase()` guarded by `isAllLower()` pre-check
- [ ] Hot helpers are arrow functions at module level
- [ ] Magic numbers extracted as named constants
- [ ] `const` over `let` where possible
- [ ] Loop length cached in local variable
- [ ] Benchmarked against baseline
- [ ] All 343+ tests passing
- [ ] Mutation score above 50% threshold
- [ ] No dead code or unused imports

## Gotchas

### Don't optimize prematurely

Always get the rule working and tested first. Use the `oxlint-custom-rule` skill, then bring this optimization skill to bear.

### Don't break tests for speed

If an optimization changes behavior (even slightly), add a test for the new behavior. Never weaken a check to make it faster.

### V8 deoptimization triggers

Avoid these patterns in hot functions:

- `try/catch` (disables some optimizations)
- `arguments` object access
- `for...in` loops
- Mixing number types (int32 + float — stay in Smi range)
- Dynamic property addition on "hot" objects

### Slice memory warning

`string.slice()` creates a SlicedString that retains a reference to the parent. For identifiers (5-50 chars), this is fine. For file-source-level strings (>10KB), avoid calling slice in a loop — use `substring` or extract once.

### Benchmark noise

V8's JIT introduces noise. Always:

- Warm up (run 10% of iterations first, discard)
- Use many iterations (50K minimum, 100K preferred)
- Report median + p95, not mean
- Re-run 3 times and take the middle result if results vary >5%
