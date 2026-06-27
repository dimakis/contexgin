import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '../store.js';
import type { ServerConfig } from '../types.js';

const execFileAsync = promisify(execFile);

interface RebuildRequest {
  /** Repository name (e.g. "dimakis/mgmt") — used for logging, not path resolution */
  repo?: string;
  /** What triggered the rebuild (e.g. "push:dimakis", "manual", "post-merge") */
  trigger?: string;
}

interface RebuildResponse {
  status: 'ok' | 'error';
  duration_ms: number;
  artifact_count: number;
  trigger: string;
  root: string;
  error?: string;
}

/**
 * Find the mgmt workspace root from configured roots.
 * Matches any root whose basename or path contains "mgmt".
 */
function findMgmtRoot(roots: string[]): string | null {
  for (const root of roots) {
    if (path.basename(root) === 'mgmt' || root.includes('/mgmt')) {
      return root;
    }
  }
  return null;
}

/**
 * Run a Python script from the knowledge_space directory.
 * Uses the workspace's .venv/bin/python for correct dependencies.
 */
async function runKnowledgeSpaceScript(
  root: string,
  script: string,
): Promise<{ stdout: string; stderr: string }> {
  const pythonPath = path.join(root, '.venv', 'bin', 'python');
  const scriptPath = path.join(root, 'knowledge_space', script);

  return execFileAsync(pythonPath, [scriptPath], {
    cwd: root,
    timeout: 120_000, // 2 minutes — generous for 657 artifacts
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

/**
 * Extract artifact count from crawl.py stdout.
 * Looks for "Crawled N artifacts" pattern.
 */
function parseArtifactCount(stdout: string): number {
  const match = stdout.match(/Crawled (\d+) artifacts/);
  return match ? parseInt(match[1], 10) : 0;
}

// Serialize rebuilds — only one knowledge space rebuild at a time
let rebuildInFlight: Promise<RebuildResponse> | null = null;

export function knowledgeSpaceRoute(
  app: FastifyInstance,
  store: GraphStore,
  config: ServerConfig,
): void {
  app.post<{ Body: RebuildRequest }>('/api/knowledge-space/rebuild', async (request, reply) => {
    const trigger = request.body?.trigger ?? 'manual';
    const mgmtRoot = findMgmtRoot(config.roots);

    if (!mgmtRoot) {
      return reply.status(404).send({
        status: 'error',
        error: 'No mgmt workspace root found in configured roots',
      });
    }

    // Check knowledge_space directory exists
    const ksDir = path.join(mgmtRoot, 'knowledge_space');
    if (!fs.existsSync(ksDir)) {
      return reply.status(404).send({
        status: 'error',
        error: `knowledge_space directory not found at ${ksDir}`,
      });
    }

    // Serialize — if a rebuild is already running, wait for it
    if (rebuildInFlight) {
      const result = await rebuildInFlight;
      return { ...result, trigger: `${trigger}:waited` };
    }

    const doRebuild = async (): Promise<RebuildResponse> => {
      const start = Date.now();
      try {
        // Step 1: git pull latest main
        await execFileAsync('git', ['-C', mgmtRoot, 'pull', '--ff-only', 'origin', 'main'], {
          timeout: 30_000,
        });

        // Step 2: crawl
        const crawlResult = await runKnowledgeSpaceScript(mgmtRoot, 'crawl.py');
        const artifactCount = parseArtifactCount(crawlResult.stdout);

        // Step 3: embed
        await runKnowledgeSpaceScript(mgmtRoot, 'embed.py');

        const duration = Date.now() - start;
        store.recordBuild(duration, `knowledge-space:${trigger}`, true);

        return {
          status: 'ok',
          duration_ms: duration,
          artifact_count: artifactCount,
          trigger,
          root: mgmtRoot,
        };
      } catch (err) {
        const duration = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        store.recordBuild(duration, `knowledge-space:${trigger}`, false, message);

        return {
          status: 'error',
          duration_ms: duration,
          artifact_count: 0,
          trigger,
          root: mgmtRoot,
          error: message,
        };
      }
    };

    rebuildInFlight = doRebuild();
    try {
      const result = await rebuildInFlight;
      if (result.status === 'error') {
        return reply.status(500).send(result);
      }
      return result;
    } finally {
      rebuildInFlight = null;
    }
  });
}
