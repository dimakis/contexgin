import { describe, it, expect } from 'vitest';
import { rankSections } from '../../src/compiler/ranker.js';
import type { ExtractedSection, ContextSource } from '../../src/compiler/types.js';

function makeSection(
  kind: ContextSource['kind'],
  headingPath: string[],
  content: string = 'Some content.',
): ExtractedSection {
  return {
    source: { path: '/test/file.md', kind, relativePath: 'file.md' },
    headingPath,
    level: headingPath.length,
    content,
    tokenEstimate: Math.ceil(content.length / 4),
  };
}

describe('rankSections', () => {
  it('ranks constitutional sections highest', () => {
    const sections = [
      makeSection('reference', ['Services']),
      makeSection('constitution', ['Purpose']),
      makeSection('memory', ['Observations']),
    ];
    const ranked = rankSections(sections);
    expect(ranked[0].source.kind).toBe('constitution');
    expect(ranked[0].relevance).toBeGreaterThan(ranked[1].relevance);
  });

  it('ranks navigational above reference', () => {
    const sections = [
      makeSection('reference', ['Services']),
      makeSection('constitution', ['Architecture']),
    ];
    const ranked = rankSections(sections);
    // Constitution with "Architecture" heading should be navigational tier
    const archSection = ranked.find((s) => s.headingPath.includes('Architecture'));
    const refSection = ranked.find((s) => s.headingPath.includes('Services'));
    expect(archSection!.relevance).toBeGreaterThan(refSection!.relevance);
  });

  it('boosts sections matching task hint', () => {
    const sections = [
      makeSection('reference', ['Email Configuration'], 'Email SMTP setup and configuration.'),
      makeSection('reference', ['Database Setup'], 'PostgreSQL connection pooling.'),
    ];
    const ranked = rankSections(sections, { taskHint: 'fix email sending' });
    const emailSection = ranked.find((s) => s.headingPath.includes('Email Configuration'));
    const dbSection = ranked.find((s) => s.headingPath.includes('Database Setup'));
    expect(emailSection!.relevance).toBeGreaterThan(dbSection!.relevance);
  });

  it('preserves order within same tier', () => {
    const sections = [
      makeSection('reference', ['First Service']),
      makeSection('reference', ['Second Service']),
      makeSection('reference', ['Third Service']),
    ];
    const ranked = rankSections(sections);
    // All same tier, should maintain original order
    expect(ranked[0].headingPath).toContain('First Service');
    expect(ranked[1].headingPath).toContain('Second Service');
    expect(ranked[2].headingPath).toContain('Third Service');
  });

  describe('spoke penalty', () => {
    function makeSpokeSection(
      kind: ContextSource['kind'],
      headingPath: string[],
      relativePath: string,
    ): ExtractedSection {
      return {
        source: { path: `/test/${relativePath}`, kind, relativePath },
        headingPath,
        level: headingPath.length,
        content: 'Some content.',
        tokenEstimate: 4,
      };
    }

    it('penalizes spoke constitution sections below root sections', () => {
      const rootSection = makeSpokeSection('constitution', ['Purpose'], 'CONSTITUTION.md');
      const spokeSection = makeSpokeSection(
        'constitution',
        ['Purpose'],
        'spokes/email/CONSTITUTION.md',
      );

      const ranked = rankSections([spokeSection, rootSection]);
      const root = ranked.find((s) => s.source.relativePath === 'CONSTITUTION.md');
      const spoke = ranked.find((s) => s.source.relativePath === 'spokes/email/CONSTITUTION.md');

      expect(root!.relevance).toBeGreaterThan(spoke!.relevance);
    });

    it('penalizes spoke navigational sections below root navigational', () => {
      const rootSection = makeSpokeSection('constitution', ['Architecture'], 'CONSTITUTION.md');
      const spokeSection = makeSpokeSection(
        'constitution',
        ['Architecture'],
        'command_center/CONSTITUTION.md',
      );

      const ranked = rankSections([spokeSection, rootSection]);
      const root = ranked.find((s) => s.source.relativePath === 'CONSTITUTION.md');
      const spoke = ranked.find(
        (s) => s.source.relativePath === 'command_center/CONSTITUTION.md',
      );

      expect(root!.relevance).toBeGreaterThan(spoke!.relevance);
    });
  });

  describe('ROOT_REFERENCE_HEADINGS demotion', () => {
    it('demotes root catalogue headings to reference tier', () => {
      const purposeSection = makeSection('constitution', ['Purpose']);
      const charterSection = makeSection('constitution', ['Sub-Repo Charter']);

      const ranked = rankSections([charterSection, purposeSection]);
      const purpose = ranked.find((s) => s.headingPath.includes('Purpose'));
      const charter = ranked.find((s) => s.headingPath.includes('Sub-Repo Charter'));

      // Purpose should be constitutional (1.0), charter should be reference (0.5)
      expect(purpose!.relevance).toBe(1.0);
      expect(charter!.relevance).toBe(0.5);
    });

    it('demotes External Projects heading to reference tier', () => {
      const sections = [
        makeSection('constitution', ['External Projects']),
        makeSection('constitution', ['Purpose']),
      ];

      const ranked = rankSections(sections);
      const ext = ranked.find((s) => s.headingPath.includes('External Projects'));
      const purpose = ranked.find((s) => s.headingPath.includes('Purpose'));

      expect(purpose!.relevance).toBeGreaterThan(ext!.relevance);
      expect(ext!.relevance).toBe(0.5);
    });
  });

  describe('CLAUDE.md operational tier', () => {
    function makeClaudeMdSection(headingPath: string[]): ExtractedSection {
      return {
        source: { path: '/test/CLAUDE.md', kind: 'reference', relativePath: 'CLAUDE.md' },
        headingPath,
        level: headingPath.length,
        content: 'Operational content.',
        tokenEstimate: 5,
      };
    }

    it('boosts CLAUDE.md sections to operational tier', () => {
      const claudeSection = makeClaudeMdSection(['General Config']);
      const refSection = makeSection('reference', ['Some Service']);

      const ranked = rankSections([refSection, claudeSection]);
      const claude = ranked.find((s) => s.source.relativePath === 'CLAUDE.md');
      const ref = ranked.find((s) => s.headingPath.includes('Some Service'));

      // CLAUDE.md content (0.75) should outrank generic reference (0.5)
      expect(claude!.relevance).toBeGreaterThan(ref!.relevance);
      expect(claude!.relevance).toBe(0.75);
    });

    it('matches OPERATIONAL_HEADINGS keywords', () => {
      const gitSection = makeClaudeMdSection(['Git Discipline']);
      const sessionSection = makeClaudeMdSection(['Session Isolation']);
      const workflowSection = makeClaudeMdSection(['Branch Workflow']);

      const ranked = rankSections([gitSection, sessionSection, workflowSection]);

      // All should get operational tier
      for (const section of ranked) {
        expect(section.relevance).toBe(0.75);
        expect(section.reason).toBe('operational instructions');
      }
    });
  });
});
