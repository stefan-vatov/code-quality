const CHAR_CODE_UNDERSCORE = 95;

/**
 * Check if a name has a leading underscore (private member convention).
 */
export default function hasLeadingUnderscore(name: string): boolean {
  return name.length > 1 && name.charCodeAt(0) === CHAR_CODE_UNDERSCORE;
}

/**
 * Suggest a private-underscore-prefixed name.
 */
export const suggestPrivateName = (name: string): string => {
  if (name.length === 0) {
    return '_field';
  }
  return `_${name}`;
};
