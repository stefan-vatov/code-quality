/* -------------------------------------------------------------------------- */
/*      Boundary-schema predicates for opt-in strict Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const NEARBY_SCHEMA_SCAN_WINDOW = 240;
const LOCAL_CONTEXT_WINDOW = 160;

const lineAround = (source: string, targetIndex: number): string => {
  const start = source.lastIndexOf('\n', targetIndex) + 1;
  let end = source.indexOf('\n', targetIndex);
  if (end === -1) {
    end = source.length;
  }
  return source.slice(start, end);
};

const boundaryAccessSegment = (code: string, match: RegExpMatchArray): string => {
  const matchIndex = match.index ?? 0;
  const accessEnd = matchIndex + match[0].length;
  const tail = code.slice(accessEnd);
  const pipeMatch = /^\s*\.pipe\s*\(/.exec(tail);
  if (pipeMatch) {
    return code.slice(matchIndex, accessEnd + findBalancedCallEnd(tail, tail.indexOf('(')) + 1);
  }
  return code.slice(matchIndex, accessEnd);
};

const boundaryAccessNeedsSchema = (code: string, match: RegExpMatchArray): boolean =>
  !isInsideCall(code, match.index ?? 0, /Schema\.decode[A-Za-z]*\s*\(/g) &&
  !/Schema\.decode/.test(boundaryAccessSegment(code, match));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasBoundaryDataWithoutSchema = (source: string): boolean => {
  if (
    !source.includes('.body') &&
    !source.includes('.params') &&
    !source.includes('.query') &&
    !source.includes('.payload')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /(?:req|request|command|message)\.(?:body|params|query|payload)/g,
  )) {
    if (boundaryAccessNeedsSchema(code, match)) {
      return true;
    }
  }

  return false;
};

const requestBindingNeedsSchema = (code: string, match: RegExpMatchArray): boolean => {
  if (match.index === undefined) {
    return false;
  }
  const line = lineAround(code, match.index);
  const bindingName = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(line)?.[1];
  const tail = code.slice(
    match.index,
    findStatementEnd(code, match.index) + NEARBY_SCHEMA_SCAN_WINDOW,
  );
  if (/Schema\.decode/.test(line)) {
    return false;
  }
  return !(
    bindingName &&
    new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${bindingName}\\b`).test(tail)
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasHTTPServerRequestWithoutSchema = (source: string): boolean => {
  if (!source.includes('HttpRouter.') && !source.includes('HttpServerRequest')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  if (!/\b(?:HttpRouter\.|HttpServerRequest\b)/.test(code)) {
    return false;
  }

  for (const match of code.matchAll(/\b(?:body|Body|json|Json|urlParams)\b/g)) {
    if (requestBindingNeedsSchema(code, match)) {
      return true;
    }
  }

  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasPersistenceReadWithoutSchema = (source: string): boolean => {
  if (
    !source.includes('db.') &&
    !source.includes('database.') &&
    !source.includes('collection.') &&
    !source.includes('repository.')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:db|database|collection|repository)\.[\s\S]*?(?:select|find|get|query)\s*\(/g,
  )) {
    const localSource = lineAround(code, match.index);
    const bindingName = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(localSource)?.[1];
    const tail = code.slice(
      match.index,
      findStatementEnd(code, match.index) + NEARBY_SCHEMA_SCAN_WINDOW,
    );
    if (
      !/Schema\.decode/.test(localSource) &&
      !(
        bindingName &&
        new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${bindingName}\\b`).test(tail)
      )
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasCommandHandlerWithoutSchema = (source: string): boolean => {
  if (
    !source.includes('handler') ||
    (!source.includes('Command') &&
      !source.includes('Cli') &&
      !source.includes('Job') &&
      !source.includes('Message'))
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:Command|Cli|Job|Message)\b[\s\S]*?handler/g)) {
    const localSource = code.slice(
      Math.max(0, match.index - LOCAL_CONTEXT_WINDOW),
      match.index + LOCAL_CONTEXT_WINDOW,
    );
    if (!/(?:Schema\.|schema\s*:)/.test(localSource)) {
      return true;
    }
  }

  return false;
};
