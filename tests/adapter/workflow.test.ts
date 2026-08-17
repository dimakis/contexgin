import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { workflowAdapter } from '../../src/adapter/workflow.js';

async function withTempFile(
  content: string,
  filename: string,
  fn: (filePath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contexgin-test-'));
  // Support nested paths like workflows/release.yaml
  const filePath = path.join(dir, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  try {
    await fn(filePath, dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

const SAMPLE_WORKFLOW_YAML = `name: Release Pipeline
description: Feature lifecycle from RFE to shipped

states:
  rfe_filed:
    description: Customer files a Request for Enhancement
    owner: pm
    entry_criteria:
      - Summary describes desired capability
      - Priority is set
    stale_after: 14d

  council_review:
    description: RFE Council evaluates feasibility
    owner: architect
    entry_criteria:
      - RFE has sufficient detail
      - PM has triaged
    stale_after: 14d

  feature_created:
    description: Approved RFE becomes a RHAISTRAT feature
    owner: pm
    entry_criteria:
      - Council approved the RFE
      - Target version assigned

  in_development:
    description: Engineering breaks down and implements
    owner: engineering
    entry_criteria:
      - Epics and stories created
      - Sprint planned
    stale_after: 30d

  shipped:
    description: Feature is released to customers
    owner: pm
    terminal: true

transitions:
  - from: rfe_filed
    to: council_review
    trigger: pm_triages

  - from: council_review
    to: feature_created
    trigger: council_approves

  - from: council_review
    to: rejected
    trigger: council_rejects

  - from: feature_created
    to: in_development
    trigger: breakdown_complete

  - from: in_development
    to: shipped
    trigger: release_ships
`;

const MINIMAL_WORKFLOW_YAML = `name: Simple Flow
states:
  start:
    description: Beginning
  end:
    description: Finished
    terminal: true
transitions:
  - from: start
    to: end
    trigger: complete
`;

describe('workflowAdapter', () => {
  it('has format "workflow"', () => {
    expect(workflowAdapter.format).toBe('workflow');
  });

  describe('canHandle', () => {
    it('handles workflows/*.yaml files', () => {
      expect(workflowAdapter.canHandle('/project/workflows/release.yaml')).toBe(true);
      expect(workflowAdapter.canHandle('/project/workflows/deploy.yml')).toBe(true);
      expect(workflowAdapter.canHandle('workflows/pipeline.yaml')).toBe(true);
    });

    it('handles context/workflow.md', () => {
      expect(workflowAdapter.canHandle('/project/context/workflow.md')).toBe(true);
      expect(workflowAdapter.canHandle('context/workflow.md')).toBe(true);
    });

    it('rejects unrelated files', () => {
      expect(workflowAdapter.canHandle('/project/src/workflow.ts')).toBe(false);
      expect(workflowAdapter.canHandle('/project/workflows.yaml')).toBe(false);
      expect(workflowAdapter.canHandle('/project/README.md')).toBe(false);
      expect(workflowAdapter.canHandle('/project/context/other.md')).toBe(false);
      expect(workflowAdapter.canHandle('/project/config/workflow.yaml')).toBe(false);
    });
  });

  describe('adapt — YAML state machine', () => {
    it('produces nodes for states, transitions, and overview', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThanOrEqual(3);

        // Should have overview, states, and transitions nodes
        const ids = nodes.map((n) => n.id);
        expect(ids).toContain('workflow-release-pipeline-overview');
        expect(ids).toContain('workflow-release-pipeline-states');
        expect(ids).toContain('workflow-release-pipeline-transitions');
      });
    });

    it('assigns operational tier to all nodes', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        for (const node of nodes) {
          expect(node.tier).toBe('operational');
          expect(node.type).toBe('operational');
        }
      });
    });

    it('sets origin format to workflow', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        for (const node of nodes) {
          expect(node.origin.format).toBe('workflow');
        }
      });
    });

    it('includes state descriptions and owners in states node', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const statesNode = nodes.find((n) => n.id.endsWith('-states'));
        expect(statesNode).toBeDefined();
        expect(statesNode!.content).toContain('rfe_filed');
        expect(statesNode!.content).toContain('Customer files a Request for Enhancement');
        expect(statesNode!.content).toContain('pm');
      });
    });

    it('includes stale thresholds in states node', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const statesNode = nodes.find((n) => n.id.endsWith('-states'));
        expect(statesNode).toBeDefined();
        expect(statesNode!.content).toContain('14d');
      });
    });

    it('marks terminal states', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const statesNode = nodes.find((n) => n.id.endsWith('-states'));
        expect(statesNode).toBeDefined();
        expect(statesNode!.content).toContain('terminal');
      });
    });

    it('includes entry criteria in states node', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const statesNode = nodes.find((n) => n.id.endsWith('-states'));
        expect(statesNode).toBeDefined();
        expect(statesNode!.content).toContain('Summary describes desired capability');
      });
    });

    it('includes transition details in transitions node', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const transNode = nodes.find((n) => n.id.endsWith('-transitions'));
        expect(transNode).toBeDefined();
        expect(transNode!.content).toContain('rfe_filed');
        expect(transNode!.content).toContain('council_review');
        expect(transNode!.content).toContain('pm_triages');
      });
    });

    it('includes workflow name in overview', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        const overview = nodes.find((n) => n.id.endsWith('-overview'));
        expect(overview).toBeDefined();
        expect(overview!.content).toContain('Release Pipeline');
      });
    });

    it('handles minimal workflow with just states and transitions', async () => {
      await withTempFile(MINIMAL_WORKFLOW_YAML, 'workflows/simple.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThanOrEqual(2);
        const statesNode = nodes.find((n) => n.id.endsWith('-states'));
        expect(statesNode).toBeDefined();
        expect(statesNode!.content).toContain('start');
        expect(statesNode!.content).toContain('end');
      });
    });

    it('has positive tokenEstimate on all nodes', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        for (const node of nodes) {
          expect(node.tokenEstimate).toBeGreaterThan(0);
        }
      });
    });

    it('sets relativePath correctly', async () => {
      await withTempFile(SAMPLE_WORKFLOW_YAML, 'workflows/release.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        for (const node of nodes) {
          expect(node.origin.relativePath).toBe(path.join('workflows', 'release.yaml'));
        }
      });
    });
  });

  describe('adapt — context/workflow.md', () => {
    it('delegates markdown workflow files to section extraction', async () => {
      const md = `# Feature Lifecycle

## Stage 1: RFE Filed

Customer files a Request for Enhancement.

### RHAIRFE Workflow

New → Draft → Stakeholder Review → Approved → Closed

## Stage 2: Council Review

Council evaluates feasibility.
`;
      await withTempFile(md, 'context/workflow.md', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThanOrEqual(2);
        // Should extract h2 sections
        expect(nodes[0].type).toBe('operational');
        expect(nodes[0].tier).toBe('operational');
        expect(nodes[0].origin.format).toBe('workflow');
      });
    });
  });

  describe('edge cases', () => {
    it('handles null state values without crashing', async () => {
      const yaml = `name: edge-case
states:
  empty_state:
  valid_state:
    description: This one is fine
`;
      await withTempFile(yaml, 'workflows/edge.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes.length).toBeGreaterThanOrEqual(1);
        // Should skip null state, include valid_state
        const statesNode = nodes.find((n) => n.id.includes('states'));
        if (statesNode) {
          expect(statesNode.content).toContain('valid_state');
        }
      });
    });

    it('returns only overview for YAML with no states or transitions', async () => {
      const yaml = `name: bare-workflow
description: A workflow with no states
`;
      await withTempFile(yaml, 'workflows/bare.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes.length).toBe(1);
        expect(nodes[0].id).toContain('overview');
      });
    });

    it('returns empty array for non-object YAML', async () => {
      const yaml = `just a string`;
      await withTempFile(yaml, 'workflows/bad.yaml', async (filePath, dir) => {
        const nodes = await workflowAdapter.adapt(filePath, dir);
        expect(nodes).toHaveLength(0);
      });
    });
  });
});
