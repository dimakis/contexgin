import type { ExtractedSection, RankedSection } from './types.js';

/** Relevance ranking tiers */
const TIER_WEIGHTS = {
  constitutional: 1.0, // Purpose, principles, boundaries — always top
  navigational: 0.8, // Architecture, directory semantics, entry points
  operational: 0.75, // How-to-work rules (git, CLI, worktrees)
  identity: 0.7, // Profile, communication style, working style
  reference: 0.5, // Services, memory observations
  historical: 0.3, // Session notes, old decisions
};

/** Spoke constitution penalty — these are context, not instructions */
const SPOKE_PENALTY = 0.35;

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

/** Heading keywords that indicate operational CLAUDE.md content */
const OPERATIONAL_HEADINGS = [
  'git',
  'commit',
  'branch',
  'workflow',
  'remote',
  'entry point',
  'cli',
  'command',
  'worktree',
  'session',
  'closeout',
  'boot',
  'memory',
  'agent',
];

/** Whether a constitution source is a spoke (not the workspace root) */
function isSpoke(section: ExtractedSection): boolean {
  return section.source.relativePath.includes('/');
}

/**
 * Determine the tier weight for a section based on its source kind and heading content.
 */
function getTierWeight(section: ExtractedSection): { weight: number; reason: string } {
  const headingText = section.headingPath.join(' ').toLowerCase();

  // Constitution sources — root vs spoke distinction
  if (section.source.kind === 'constitution') {
    const spoke = isSpoke(section);
    const penalty = spoke ? SPOKE_PENALTY : 0;

    if (CONSTITUTIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      const w = TIER_WEIGHTS.constitutional - penalty;
      return { weight: w, reason: spoke ? 'spoke constitutional' : 'constitutional content' };
    }
    if (NAVIGATIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      const w = TIER_WEIGHTS.navigational - penalty;
      return { weight: w, reason: spoke ? 'spoke navigational' : 'navigational content' };
    }
    const w = TIER_WEIGHTS.navigational - penalty;
    return { weight: w, reason: spoke ? 'spoke content' : 'constitution source' };
  }

  // CLAUDE.md — operational instructions, not generic references
  if (section.source.kind === 'reference' && section.source.relativePath === 'CLAUDE.md') {
    if (OPERATIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.operational, reason: 'operational instructions' };
    }
    return { weight: TIER_WEIGHTS.operational, reason: 'CLAUDE.md content' };
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

  // Default for unknown kinds
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
