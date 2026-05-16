import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { compile } from '../../src/compiler/index.js';

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-compile-'));

  // CLAUDE.md
  await fs.writeFile(
    path.join(dir, 'CLAUDE.md'),
    `# Instructions

## Git Discipline

### Conventional Commits
All commits use: \`<type>(scope): description\`

Types: feat, fix, docs, style, refactor

## Entry Points

| Command | Description |
|---------|-------------|
| \`./start\` | Start the app |

## Security Boundaries

Never expose API keys in source code.

## Agent System

Agents are autonomous and post proposals to inbox.
`,
  );

  // CONSTITUTION.md
  await fs.writeFile(
    path.join(dir, 'CONSTITUTION.md'),
    `# My Project

## Purpose

A context orchestration engine for AI agents.

## Directory Semantics

| Path | Description |
|------|-------------|
| \`src/\` | All source code |
| \`tests/\` | Test files |

## Principles

### TDD
Tests first, always.

### Separation of Concerns
Each module has one job.
`,
  );

  // .cursor/rules/
  const rulesDir = path.join(dir, '.cursor', 'rules');
  await fs.mkdir(rulesDir, { recursive: true });
  await fs.writeFile(
    path.join(rulesDir, 'commit.mdc'),
    `---
description: Conventional commit format.
alwaysApply: true
---

All commits MUST follow conventional commit format.
`,
  );

  // README.md
  await fs.writeFile(
    path.join(dir, 'README.md'),
    `## Overview

This is a test project.

## Installation

\`npm install\`
`,
  );

  return dir;
}

describe('compile', () => {
  it('compiles a workspace into grouped payload', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      expect(result.bootPayload).toBeTruthy();
      expect(result.bootTokens).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.nodes).toBeDefined();
      expect(result.nodes!.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('groups payload by type with section headers', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      // Should have governance, architecture, conventions sections
      expect(result.bootPayload).toContain('## Governance');
      expect(result.bootPayload).toContain('## Conventions');
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('returns typed nodes with correct metadata', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      const nodes = result.nodes!;

      // Check node types are present
      const types = new Set(nodes.map((n) => n.type));
      expect(types.size).toBeGreaterThan(1);

      // Check formats are present
      const formats = new Set(nodes.map((n) => n.origin.format));
      expect(formats).toContain('claude_md');
      expect(formats).toContain('constitution');

      // Every node should have required fields
      for (const node of nodes) {
        expect(node.id).toBeTruthy();
        expect(node.type).toBeTruthy();
        expect(node.tier).toBeTruthy();
        expect(node.content).toBeTruthy();
        expect(node.tokenEstimate).toBeGreaterThan(0);
      }
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('returns included sections with correct metadata', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      expect(result.included).toBeDefined();
      expect(result.included.length).toBeGreaterThan(0);

      // Every included section should have required fields
      for (const section of result.included) {
        expect(section.source).toBeDefined();
        expect(section.source.path).toBeTruthy();
        expect(section.source.relativePath).toBeTruthy();
        expect(section.headingPath.length).toBeGreaterThan(0);
        expect(section.content).toBeTruthy();
        expect(section.tokenEstimate).toBeGreaterThan(0);
      }

      // included count should match nodes count
      expect(result.included.length).toBe(result.nodes!.length);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('returns trimmed sections when budget is tight', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 100,
      });

      expect(result.trimmed).toBeDefined();
      expect(result.trimmed.length).toBeGreaterThan(0);

      // trimmed count should match trimmedNodes count
      expect(result.trimmed.length).toBe(result.trimmedNodes!.length);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('respects token budget', async () => {
    const dir = await createWorkspace();
    try {
      const small = await compile({
        workspaceRoot: dir,
        tokenBudget: 100,
      });

      const large = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      expect(small.nodes!.length).toBeLessThan(large.nodes!.length);
      expect(small.bootTokens).toBeLessThanOrEqual(large.bootTokens);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('applies task hint boost', async () => {
    const dir = await createWorkspace();
    try {
      const withHint = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
        taskHint: 'git commit conventional',
      });

      // Git-related nodes should be boosted
      const gitNodes = withHint.nodes!.filter(
        (n) => n.id.includes('git') || n.content.toLowerCase().includes('commit'),
      );
      expect(gitNodes.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('handles excluded sections', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
        excluded: [['agent-system']],
      });

      const agentNodes = result.nodes!.filter((n) => n.id === 'agent-system');
      expect(agentNodes).toHaveLength(0);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  it('provides navigation hints', async () => {
    const dir = await createWorkspace();
    try {
      const result = await compile({
        workspaceRoot: dir,
        tokenBudget: 10000,
      });

      expect(result.navigationHints.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });

  describe('real-world: mgmt workspace', () => {
    const mgmtRoot = path.resolve(process.env.HOME || '~', 'redhat/mgmt');

    it('compiles mgmt workspace with adapter pipeline', async () => {
      try {
        await fs.access(mgmtRoot);
      } catch {
        return;
      }

      const result = await compile({
        workspaceRoot: mgmtRoot,
        tokenBudget: 12000,
        taskHint: 'Review PR for git discipline violations',
      });

      expect(result.bootPayload).toBeTruthy();
      expect(result.nodes).toBeDefined();
      expect(result.nodes!.length).toBeGreaterThan(5);
      expect(result.bootPayload).toContain('## Governance');

      // Should have nodes from multiple formats
      const formats = new Set(result.nodes!.map((n) => n.origin.format));
      expect(formats.size).toBeGreaterThanOrEqual(2);
    });
  });
});
