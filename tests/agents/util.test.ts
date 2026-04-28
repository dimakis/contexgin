import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveHome } from '../../src/agents/util.js';

describe('resolveHome', () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it('expands tilde prefix using HOME', () => {
    process.env.HOME = '/Users/test';
    expect(resolveHome('~/projects/foo')).toBe('/Users/test/projects/foo');
  });

  it('expands tilde prefix using USERPROFILE when HOME is missing', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = 'C:\\Users\\test';
    expect(resolveHome('~/projects/foo')).toBe('C:\\Users\\test/projects/foo');
  });

  it('returns absolute paths unchanged', () => {
    process.env.HOME = '/Users/test';
    expect(resolveHome('/absolute/path')).toBe('/absolute/path');
  });

  it('returns relative paths unchanged', () => {
    process.env.HOME = '/Users/test';
    expect(resolveHome('relative/path')).toBe('relative/path');
  });

  it('handles bare tilde without slash', () => {
    process.env.HOME = '/Users/test';
    expect(resolveHome('~')).toBe('~');
  });

  it('handles empty string', () => {
    process.env.HOME = '/Users/test';
    expect(resolveHome('')).toBe('');
  });

  it('handles missing HOME and USERPROFILE', () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(resolveHome('~/projects/foo')).toBe('projects/foo');
  });
});
