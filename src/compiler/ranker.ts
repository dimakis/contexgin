import type { ExtractedSection, RankedSection } from './types.js';

/** Relevance ranking tiers */
const TIER_WEIGHTS = {
  constitutional: 1.0, // Purpose, principles, boundaries — always top
  navigational: 0.8, // Architecture, directory semantics, entry points
  identity: 0.7, // Profile, communication style, working style
  reference: 0.5, // Services, memory observations
  historical: 0.3, // Session notes, old decisions
};

/** Heading keywords that indicate navigational content */
const NAVIGATIONAL_HEADINGS = [
  'architecture',
  'directory',
  'structure',
  'entry point',
  'navigation',
  'boundaries',
  'layout',
];

/** Heading keywords that indicate constitutional content */
const CONSTITUTIONAL_HEADINGS = [
  'purpose',
  'principles',
  'boundaries',
  'constitution',
  'governance',
];

/** Heading keywords that indicate historical content */
const HISTORICAL_HEADINGS = ['session', 'history', 'decisions', 'log', 'journal'];

/**
 * Determine the tier weight for a section based on its source kind and heading content.
 */
function getTierWeight(section: ExtractedSection): { weight: number; reason: string } {
  const headingText = section.headingPath.join(' ').toLowerCase();

  // Constitutional source + constitutional heading = top tier
  if (section.source.kind === 'constitution') {
    if (CONSTITUTIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.constitutional, reason: 'constitutional content' };
    }
    if (NAVIGATIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.navigational, reason: 'navigational content' };
    }
    // Default for constitution source
    return { weight: TIER_WEIGHTS.navigational, reason: 'constitution source' };
  }

  if (section.source.kind === 'profile') {
    return { weight: TIER_WEIGHTS.identity, reason: 'profile/identity content' };
  }

  if (section.source.kind === 'memory') {
    if (HISTORICAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.historical, reason: 'historical content' };
    }
    return { weight: TIER_WEIGHTS.reference, reason: 'memory content' };
  }

  if (section.source.kind === 'service') {
    return { weight: TIER_WEIGHTS.reference, reason: 'service reference' };
  }

  // Default for reference and unknown kinds
  return { weight: TIER_WEIGHTS.reference, reason: 'reference content' };
}

/**
 * Calculate task hint boost based on term overlap.
 */
function getTaskBoost(section: ExtractedSection, taskHint: string): number {
  const taskTerms = taskHint
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (taskTerms.length === 0) return 0;

  const sectionText = [...section.headingPath, section.content].join(' ').toLowerCase();

  let matches = 0;
  for (const term of taskTerms) {
    if (sectionText.includes(term)) {
      matches++;
    }
  }

  // Boost proportional to term overlap, max 0.2
  return (matches / taskTerms.length) * 0.2;
}

/**
 * Rank sections by relevance.
 * Base ranking by source kind + section type.
 * If taskHint provided, boost sections whose headings/content match task terms.
 */
export function rankSections(
  sections: ExtractedSection[],
  options?: { taskHint?: string },
): RankedSection[] {
  const ranked: RankedSection[] = sections.map((section) => {
    const { weight, reason } = getTierWeight(section);
    const boost = options?.taskHint ? getTaskBoost(section, options.taskHint) : 0;
    const relevance = Math.min(weight + boost, 1.0);

    return {
      ...section,
      relevance,
      reason: boost > 0 ? `${reason} + task boost` : reason,
    };
  });

  // Stable sort by relevance descending
  ranked.sort((a, b) => b.relevance - a.relevance);

  return ranked;
}
