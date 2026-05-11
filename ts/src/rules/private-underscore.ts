/**
 * Check if a name has a leading underscore (private member convention).
 */
export default function hasLeadingUnderscore(name: string): boolean {
  return name.length > 1 && name.charCodeAt(0) === 95;
}

/**
 * Suggest a private-underscore-prefixed name.
 */
export function suggestPrivateName(name: string): string {
  return name.length === 0 ? '_field' : `_${name}`;
}
