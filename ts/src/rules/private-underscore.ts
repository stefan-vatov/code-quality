/**
 * Check if a name has a leading underscore (private member convention).
 *
 * Private class members in TypeScript should use a leading underscore
 * to signal "internal use only": `_privateField`, `_internalMethod`.
 *
 * This pairs with the convention that public members do NOT use
 * a leading underscore.
 */
export default function hasLeadingUnderscore(name: string): boolean {
  return name.length > 1 && name[0] === '_';
}

/**
 * Suggest a private-underscore-prefixed name.
 *
 * secret → _secret
 * MyField → _myField
 */
export function suggestPrivateName(name: string): string {
  if (name.length === 0) {
    return '_field';
  }
  return `_${name}`;
}
