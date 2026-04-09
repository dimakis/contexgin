import type { ConstitutionEntry, ReadingList, ReadingItem } from './types.js';

/**
 * Score how relevant a constitution entry is to a given task.
 */
function scoreEntry(entry: ConstitutionEntry, taskTerms: string[]): number {
  let score = 0;
  const searchableText = [
    entry.spokeName,
    entry.purpose,
    ...entry.entryPoints,
    ...Array.from(entry.directorySemantics.values()),
  ]
    .join(' ')
    .toLowerCase();

  for (const term of taskTerms) {
    if (searchableText.includes(term)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Generate a directed reading list for a task.
 *
 * 1. Check which constitutions mention relevant terms
 * 2. Order by relevance (constitutional -> dependencies -> reference)
 * 3. Include specific sections where possible
 * 4. Cap at 10 items
 */
export function generateReadingList(
  task: string,
  index: ConstitutionEntry[],
): ReadingList {
  const taskTerms = task
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  // Score and sort entries by relevance
  const scored = index.map((entry) => ({
    entry,
    score: scoreEntry(entry, taskTerms),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Build reading list items
  const items: ReadingItem[] = [];
  let priority = 1;

  for (const { entry, score } of scored) {
    if (score <= 0) continue;

    // Add constitution itself
    items.push({
      path: entry.path,
      reason: `${entry.spokeName}: ${entry.purpose}`,
      priority: priority++,
    });

    // Add entry points
    for (const ep of entry.entryPoints) {
      items.push({
        path: ep,
        reason: `Entry point for ${entry.spokeName}`,
        section: undefined,
        priority: priority++,
      });
    }

    if (items.length >= 10) break;
  }

  // Cap at 10
  const capped = items.slice(0, 10);

  return {
    task,
    items: capped,
  };
}
