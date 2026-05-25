/* -------------------------------------------------------------------------- */
/*        Private member naming helper for underscore-prefixed names.         */
/* -------------------------------------------------------------------------- */
import { Match, Predicate, String, pipe } from 'effect';

const CHAR_CODE_UNDERSCORE = 95;
const PRIVATE_FIELD_FALLBACK_NAME = '_field';

const isLongEnoughForPrivateName = (name: string): boolean => name.length > 1;

const startsWithUnderscore = (name: string): boolean => name.charCodeAt(0) === CHAR_CODE_UNDERSCORE;

/**
 * Check if a name has a leading underscore (private member convention).
 */
const hasLeadingUnderscore = Predicate.and(isLongEnoughForPrivateName, startsWithUnderscore);

export default hasLeadingUnderscore;

/**
 * Suggest a private-underscore-prefixed name.
 */
export const suggestPrivateName = (name: string): string =>
  Match.value(name).pipe(
    Match.when(String.isEmpty, () => PRIVATE_FIELD_FALLBACK_NAME),
    Match.orElse((privateName) => pipe('_', String.concat(privateName))),
  );
