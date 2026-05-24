/* -------------------------------------------------------------------------- */
/*      Shared source helpers used by Effect lint rule implementations.       */
/* -------------------------------------------------------------------------- */
export { stripComments } from './effect-source-comments';
export {
  findBalancedCallEnd,
  findMatchingBrace,
  stripCommentsAndStrings,
} from './effect-source-scan';

export {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  exportedDeclarationTexts,
} from './effect-exported-declarations';

export {
  findStatementEnd,
  isInsideCall,
  sameFunctionTail,
  statementAfter,
} from './effect-source-navigation';
