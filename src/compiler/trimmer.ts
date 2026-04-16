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
 * Normalize a heading for dedup comparison.
 * "Claude Code Instructions > Entry Points" → "entry points"
 */
function normalizeHeading(headingPath: string[]): string {
  return headingPath[headingPath.length - 1].toLowerCase().trim();
}

/**
 * Trim sections to fit within a token budget.
 * Drops lowest-relevance sections first.
 * Deduplicates: when a lower-relevance section shares a heading with an
 * already-included higher-relevance section, skip it.
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
  const seenHeadings = new Set<string>();
  let usedTokens = 0;

  for (const section of sorted) {
    const heading = normalizeHeading(section.headingPath);

    // Skip if a higher-relevance section with the same heading was already included
    // (only dedup across different source files)
    if (seenHeadings.has(heading)) {
      const alreadyIncluded = included.find(
        (s) =>
          normalizeHeading(s.headingPath) === heading &&
          s.source.relativePath !== section.source.relativePath,
      );
      if (alreadyIncluded) {
        trimmed.push(section);
        continue;
      }
    }

    if (usedTokens + section.tokenEstimate <= budget) {
      included.push(section);
      usedTokens += section.tokenEstimate;
      seenHeadings.add(heading);
    } else {
      trimmed.push(section);
    }
  }

  return { included, trimmed };
}
