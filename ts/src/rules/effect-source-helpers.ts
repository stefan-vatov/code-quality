import {
  findBalancedCallEnd,
  findMatchingBrace,
  findRegexLiteralEnd,
  isRegexLiteralStart,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-scan.js';

const EXPORTED_DECLARATION_CACHE_MAX = 256;
const exportedDeclarationCache = new Map<string, string[]>();
const exportedDeclarationSegmentCache = new Map<string, string[]>();
const exportedCallableDeclarationSegmentCache = new Map<string, string[]>();

function cachedExportedDeclarations(source: string): string[] | undefined {
  return exportedDeclarationCache.get(source);
}

function cacheExportedDeclarations(source: string, declarations: string[]): string[] {
  if (exportedDeclarationCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedDeclarationCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedDeclarationCache.delete(firstKey);
    }
  }
  exportedDeclarationCache.set(source, declarations);
  return declarations;
}

function cacheExportedDeclarationSegments(source: string, segments: string[]): string[] {
  if (exportedDeclarationSegmentCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedDeclarationSegmentCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedDeclarationSegmentCache.delete(firstKey);
    }
  }
  exportedDeclarationSegmentCache.set(source, segments);
  return segments;
}

function cacheExportedCallableDeclarationSegments(source: string, segments: string[]): string[] {
  if (exportedCallableDeclarationSegmentCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedCallableDeclarationSegmentCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedCallableDeclarationSegmentCache.delete(firstKey);
    }
  }
  exportedCallableDeclarationSegmentCache.set(source, segments);
  return segments;
}

function findEnclosingBraceOpen(source: string, targetIndex: number): number {
  const stack: number[] = [];
  let quote = '';
  let isEscaped = false;

  for (let index = 0; index < targetIndex; index++) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '/' && nextChar === '/') {
      const newlineIndex = source.indexOf('\n', index + 2);
      index = newlineIndex === -1 ? targetIndex : newlineIndex;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? targetIndex : commentEnd + 1;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      stack.push(index);
    } else if (char === '}') {
      stack.pop();
    }
  }

  return stack.at(-1) ?? -1;
}

function isInsideCall(source: string, targetIndex: number, callPattern: RegExp): boolean {
  for (const match of source.matchAll(callPattern)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1 || openParenIndex > targetIndex) {
      continue;
    }
    if (targetIndex <= findBalancedCallEnd(source, openParenIndex)) {
      return true;
    }
  }

  return false;
}

function statementAfter(source: string, targetIndex: number, maxLength = 320): string {
  const end = source.indexOf(';', targetIndex);
  return source.slice(targetIndex, end === -1 ? targetIndex + maxLength : end + 1);
}

function findStatementEnd(source: string, startIndex: number): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote = '';
  let isEscaped = false;

  for (let index = startIndex; index < source.length; index++) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      const newlineIndex = source.indexOf('\n', index + 2);
      index = newlineIndex === -1 ? source.length : newlineIndex;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (isRegexLiteralStart(source, index)) {
      index = findRegexLiteralEnd(source, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '{') {
      braceDepth++;
    } else if (char === '}') {
      braceDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (char === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return source.length - 1;
}

function exportedDeclarationTexts(source: string): string[] {
  const cachedValue = cachedExportedDeclarations(source);
  if (cachedValue) {
    return cachedValue;
  }

  const code = stripCommentsAndStrings(source);
  const declarations: string[] = [];

  for (const match of code.matchAll(
    /\bexport\s+default\s+(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g,
  )) {
    const statementEnd = findStatementEnd(source, match.index);
    declarations.push(source.slice(match.index, statementEnd + 1));
  }

  for (const match of code.matchAll(
    /\bexport\s+(?:default\s+)?(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\b/g,
  )) {
    const bodyStart = source.indexOf('{', match.index);
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1) {
      declarations.push(source.slice(match.index, bodyEnd + 1));
    }
  }

  for (const match of code.matchAll(/\bexport\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\b/g)) {
    const statementEnd = findStatementEnd(source, match.index);
    declarations.push(source.slice(match.index, statementEnd + 1));
  }

  for (const match of code.matchAll(/\bexport\s+type\s+[A-Za-z_$][\w$]*\b/g)) {
    const statementEnd = findStatementEnd(source, match.index);
    declarations.push(source.slice(match.index, statementEnd + 1));
  }

  for (const match of code.matchAll(/\bexport\s+interface\s+[A-Za-z_$][\w$]*\b/g)) {
    const bodyStart = source.indexOf('{', match.index);
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1) {
      declarations.push(source.slice(match.index, bodyEnd + 1));
    }
  }

  for (const match of code.matchAll(
    /\bexport\s+(?:default\s+)?(?:abstract\s+)?class(?:\s+[A-Za-z_$][\w$]*)?\b/g,
  )) {
    const bodyStart = source.indexOf('{', match.index);
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1) {
      declarations.push(source.slice(match.index, bodyEnd + 1));
    }
  }

  for (const match of code.matchAll(/\bexport\s+default\s+(?!class\b|(?:async\s+)?function\b)/g)) {
    const statementEnd = findStatementEnd(source, match.index);
    declarations.push(source.slice(match.index, statementEnd + 1));
  }

  for (const exportMatch of code.matchAll(/\bexport\s+(?:type\s+)?{\s*([^}]+)\s*}/g)) {
    const exportStatementEnd = findStatementEnd(code, exportMatch.index);
    const exportStatement = code.slice(exportMatch.index, exportStatementEnd + 1);
    if (/\bfrom\s*['"]/.test(exportStatement)) {
      continue;
    }

    const exportedNames = exportMatch[1]
      .split(',')
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter(Boolean);
    for (const exportedName of exportedNames) {
      const declarationMatch = new RegExp(
        `\\b(?:(?:const|let|var)\\s+${exportedName}\\b|(?:async\\s+)?function\\s+${exportedName}\\b|type\\s+${exportedName}\\b|interface\\s+${exportedName}\\b|(?:abstract\\s+)?class\\s+${exportedName}\\b)`,
      ).exec(code);
      if (!declarationMatch) {
        continue;
      }

      if (
        /\b(?:async\s+)?function\b|\b(?:abstract\s+)?class\b|\binterface\b/.test(
          declarationMatch[0],
        )
      ) {
        const bodyStart = source.indexOf('{', declarationMatch.index);
        if (bodyStart === -1) {
          continue;
        }
        const bodyEnd = findMatchingBrace(source, bodyStart);
        if (bodyEnd !== -1) {
          declarations.push(source.slice(declarationMatch.index, bodyEnd + 1));
        }
        continue;
      }

      const statementEnd = findStatementEnd(source, declarationMatch.index);
      declarations.push(source.slice(declarationMatch.index, statementEnd + 1));
    }
  }

  return cacheExportedDeclarations(source, declarations);
}

function findAssignmentEquals(declaration: string): number {
  for (let index = 0; index < declaration.length; index++) {
    const char = declaration[index];
    const previousChar = declaration[index - 1];
    const nextChar = declaration[index + 1];
    if (
      char === '=' &&
      previousChar !== '=' &&
      previousChar !== '!' &&
      previousChar !== '<' &&
      previousChar !== '>' &&
      nextChar !== '=' &&
      nextChar !== '>'
    ) {
      return index;
    }
  }

  return -1;
}

function exportedDeclarationSegments(source: string): string[] {
  const cachedValue = exportedDeclarationSegmentCache.get(source);
  if (cachedValue) {
    return cachedValue;
  }

  return cacheExportedDeclarationSegments(
    source,
    exportedDeclarationTexts(source).map((declaration) => {
      if (/^\s*export\s+default\b/.test(declaration)) {
        const value = declaration.replace(/^\s*export\s+default\s+/, '');
        const arrowIndex = value.indexOf('=>');
        if (/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
          return value.slice(arrowIndex + 2);
        }
        return value;
      }

      if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
        const equalsIndex = findAssignmentEquals(declaration);
        const value = equalsIndex === -1 ? declaration : declaration.slice(equalsIndex + 1);
        const arrowIndex = value.indexOf('=>');
        if (/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
          return value.slice(arrowIndex + 2);
        }
        return value;
      }

      const bodyStart = declaration.indexOf('{');
      return bodyStart === -1 ? declaration : declaration.slice(bodyStart);
    }),
  );
}

function exportedCallableDeclarationSegments(source: string): string[] {
  const cachedValue = exportedCallableDeclarationSegmentCache.get(source);
  if (cachedValue) {
    return cachedValue;
  }

  return cacheExportedCallableDeclarationSegments(
    source,
    exportedDeclarationTexts(source).flatMap((declaration) => {
      if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(declaration)) {
        const bodyStart = declaration.indexOf('{');
        return bodyStart === -1 ? [] : [declaration.slice(bodyStart)];
      }

      if (/^\s*export\s+default\b/.test(declaration)) {
        const value = declaration.replace(/^\s*export\s+default\s+/, '');
        if (!/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
          return [];
        }

        const arrowIndex = value.indexOf('=>');
        return [value.slice(arrowIndex + 2)];
      }

      if (!/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
        return [];
      }

      const equalsIndex = findAssignmentEquals(declaration);
      const value = equalsIndex === -1 ? declaration : declaration.slice(equalsIndex + 1);
      if (!/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
        return [];
      }

      const arrowIndex = value.indexOf('=>');
      return [value.slice(arrowIndex + 2)];
    }),
  );
}

function enclosingEffectCallTail(source: string, targetIndex: number): string | undefined {
  for (const match of source.matchAll(/\bEffect\.(?:gen|fn)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1 || openParenIndex > targetIndex) {
      continue;
    }
    const endIndex = findBalancedCallEnd(source, openParenIndex);
    if (targetIndex <= endIndex) {
      return source.slice(targetIndex, endIndex + 1);
    }
  }

  return undefined;
}

function sameFunctionTail(source: string, targetIndex: number): string {
  const effectTail = enclosingEffectCallTail(source, targetIndex);
  if (effectTail) {
    return effectTail;
  }

  const openBrace = findEnclosingBraceOpen(source, targetIndex);
  if (openBrace !== -1) {
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace !== -1) {
      return source.slice(targetIndex, closeBrace + 1);
    }
  }

  const tail = source.slice(targetIndex);
  const nextFunction = tail
    .slice(1)
    .search(
      /\n\s*(?:export\s+)?(?:(?:async\s+)?function\b|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>)/,
    );
  return nextFunction === -1 ? tail : tail.slice(0, nextFunction + 1);
}

export {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  exportedDeclarationTexts,
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  isInsideCall,
  sameFunctionTail,
  statementAfter,
  stripComments,
  stripCommentsAndStrings,
};
