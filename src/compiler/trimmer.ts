import type { RankedSection } from './types.js';

/**
 * Estimate token count for text.
 * Use simple heuristic: ~4 chars per token for English text.
 * Good enough for budget enforcement — not billing accuracy.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim sections to fit within a token budget.
 * Drops lowest-relevance sections first.
 * Returns included sections and trimmed sections.
 */
export function trimToBudget(
  sections: RankedSection[],
  budget: number,
): { included: RankedSection[]; trimmed: RankedSection[] } {
  // Sort by relevance descending — highest relevance first
  const sorted = [...sections].sort((a, b) => b.relevance - a.relevance);

  const included: RankedSection[] = [];
  const trimmed: RankedSection[] = [];
  let usedTokens = 0;

  for (const section of sorted) {
    if (usedTokens + section.tokenEstimate <= budget) {
      included.push(section);
      usedTokens += section.tokenEstimate;
    } else {
      trimmed.push(section);
    }
  }

  return { included, trimmed };
}
