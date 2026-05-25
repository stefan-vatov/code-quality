/* -------------------------------------------------------------------------- */
/*  Programming acronyms for the acronym-case naming rule. 1570 entries from  */
/*    Computing standards, protocols, vendor names, programming terms, and    */
/*  Common source code abbreviations. Stored lowercase for case-insensitive   */
/*                                Set lookup.                                 */
/* -------------------------------------------------------------------------- */
import { Array } from 'effect';
import acronyms1 from './acronyms-1';
import acronyms2 from './acronyms-2';
import acronyms3 from './acronyms-3';
import acronyms4 from './acronyms-4';

const acronymGroups = [acronyms1, acronyms2, acronyms3, acronyms4] as const;

const acronyms: ReadonlySet<string> = new Set(Array.flatten(acronymGroups));

export default acronyms;
