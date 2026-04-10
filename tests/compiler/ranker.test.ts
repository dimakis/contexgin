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
});
