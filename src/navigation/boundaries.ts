import type { ConstitutionEntry } from './types.js';

/**
 * Check if accessing a spoke is allowed based on constitution boundaries.
 * A spoke access is denied if the requesting spoke lists the target in its excluded list.
 */
export function isAccessAllowed(
  requestingSpoke: ConstitutionEntry,
  targetSpokeName: string,
): boolean {
  return !requestingSpoke.excluded.includes(targetSpokeName);
}

/**
 * Get all spokes that are accessible from a given spoke.
 */
export function getAccessibleSpokes(
  from: ConstitutionEntry,
  allSpokes: ConstitutionEntry[],
): ConstitutionEntry[] {
  return allSpokes.filter((spoke) => isAccessAllowed(from, spoke.spokeName));
}
