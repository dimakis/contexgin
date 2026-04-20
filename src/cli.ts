#!/usr/bin/env node

import * as path from 'node:path';
import { buildGraph } from './graph/builder.js';
import { validateGraph } from './graph/validate.js';
import type { Violation, ViolationSeverity } from './graph/types.js';
import { createServer } from './server/app.js';
import { startListeners } from './server/listener.js';
import { startWatcher } from './server/watcher.js';
import { DEFAULT_CONFIG, type ServerConfig } from './server/types.js';

// ── Color helpers (no dependency — ANSI codes) ───────────────────

const isColor = process.stdout.isTTY && !process.env.NO_COLOR;
const red = (s: string) => (isColor ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (isColor ? `\x1b[33m${s}\x1b[0m` : s);
const dim = (s: string) => (isColor ? `\x1b[2m${s}\x1b[0m` : s);
const green = (s: string) => (isColor ? `\x1b[32m${s}\x1b[0m` : s);
const bold = (s: string) => (isColor ? `\x1b[1m${s}\x1b[0m` : s);

const SEVERITY_ICON: Record<ViolationSeverity, string> = {
  error: red('✗'),
  warning: yellow('⚠'),
  info: dim('ℹ'),
};

// ── Arg helpers ─────────────────────────────────────────────────

/** Flags that consume the next argument as a value. */
const VALUE_FLAGS = new Set(['--port', '--socket', '--db', '--goals-db']);

/**
 * Extract positional arguments from an args list, skipping flags and
 * their values.  Boolean flags (e.g. --no-watch) are stripped too.
 */
function extractPositionals(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (VALUE_FLAGS.has(args[i])) i++; // skip the value too
      continue;
    }
    positionals.push(args[i]);
  }
  return positionals;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'validate') {
    const roots = args.slice(1);
    if (roots.length === 0) {
      console.error('Usage: contexgin validate <root> [root2] ...');
      process.exit(1);
    }
    await runValidate(roots);
  } else if (command === 'graph') {
    const roots = args.slice(1);
    if (roots.length === 0) {
      console.error('Usage: contexgin graph <root> [root2] ...');
      process.exit(1);
    }
    await runGraph(roots);
  } else if (command === 'serve') {
    const roots = extractPositionals(args).slice(1);
    if (roots.length === 0) {
      console.error(
        'Usage: contexgin serve <root> [root2] ... [--port N] [--socket PATH] [--no-watch]',
      );
      process.exit(1);
    }
    await runServe(roots, args);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
${bold('contexgin')} — structural graph engine for workspaces

${bold('Commands:')}
  validate <root> [root2] ...   Validate workspace structure
  graph <root> [root2] ...      Print graph summary
  serve <root> [root2] ...      Start daemon with HTTP API

${bold('Serve options:')}
  --port N        TCP port (default: 4195)
  --socket PATH   Unix socket path
  --no-watch      Disable file watching
  --db PATH       SQLite database path (default: in-memory)
  --goals-db PATH Goals SQLite database path (default: in-memory)

${bold('Examples:')}
  npx contexgin validate ~/redhat/mgmt
  npx contexgin graph ~/redhat/mgmt
  npx contexgin serve ~/redhat/mgmt --port 4195
  npx contexgin serve ~/redhat/mgmt --socket /tmp/contexgin.sock
`);
}

// ── Validate Command ─────────────────────────────────────────────

async function runValidate(roots: string[]) {
  const resolvedRoots = roots.map((r) => path.resolve(r.replace(/^~/, process.env.HOME || '')));

  console.log(dim('Building graph...'));
  const graph = await buildGraph(resolvedRoots);

  console.log(dim('Validating...'));
  const violations = await validateGraph(graph);

  // Combine build-time and validation violations
  const allViolations = [...graph.violations, ...violations];

  // Group by hub/spoke
  const grouped = new Map<string, Violation[]>();
  for (const v of allViolations) {
    let loc = v.location;
    // Normalize absolute paths — use hub-relative path if possible
    for (const hub of graph.hubs) {
      if (hub.path && loc.startsWith(hub.path)) {
        loc = hub.name + loc.slice(hub.path.length);
        break;
      }
    }
    const key = loc.split('/').slice(0, 2).join('/');
    const list = grouped.get(key) || [];
    list.push(v);
    grouped.set(key, list);
  }

  // Print results
  console.log('');
  for (const hub of graph.hubs) {
    const spokeCount = hub.spokes.length;
    const edgeCount = graph.edges.filter((e) => e.from === hub.id || e.to === hub.id).length;
    console.log(bold(`${hub.path} (${spokeCount} spokes, ${edgeCount} edges)`));
    console.log('');

    // Hub-level violations — location can be a relative name or absolute path
    const hubViolations = allViolations.filter((v) => {
      // Direct match on name or path
      if (v.location === hub.name || v.location === hub.path) return true;
      // Not attributable to any spoke
      return !hub.spokes.some(
        (s) => v.location.startsWith(`${hub.name}/${s.name}`) || v.location.includes(`/${s.name}/`),
      );
    });
    if (hubViolations.length > 0) {
      for (const v of hubViolations) {
        printViolation(v);
      }
      console.log('');
    }

    // Per-spoke violations
    for (const spoke of hub.spokes) {
      const spokeViolations = allViolations.filter(
        (v) =>
          v.location.startsWith(`${hub.name}/${spoke.name}`) ||
          v.location.includes(`/${spoke.name}/`) ||
          v.location === spoke.path,
      );

      if (spokeViolations.length === 0) {
        console.log(`  ${spoke.name}/  ${green('✓')} clean`);
      } else {
        console.log(`  ${spoke.name}/`);
        for (const v of spokeViolations) {
          printViolation(v, '    ');
        }
      }
    }
    console.log('');
  }

  // Summary
  const counts = { error: 0, warning: 0, info: 0 };
  for (const v of allViolations) {
    counts[v.severity]++;
  }

  const parts: string[] = [];
  if (counts.error > 0) parts.push(red(`${counts.error} errors`));
  if (counts.warning > 0) parts.push(yellow(`${counts.warning} warnings`));
  if (counts.info > 0) parts.push(dim(`${counts.info} info`));

  const total = graph.hubs.reduce((n, h) => n + h.spokes.length, 0);
  if (parts.length === 0) {
    console.log(green(`✓ ${total} spokes validated — no issues`));
  } else {
    console.log(`${parts.join(', ')} — ${total} spokes validated`);
  }

  // Exit with error code if there are errors
  if (counts.error > 0) process.exit(1);
}

function printViolation(v: Violation, indent = '  ') {
  const icon = SEVERITY_ICON[v.severity];
  console.log(`${indent}${icon} ${v.kind}: ${v.message}`);
  if (v.suggestion) {
    console.log(`${indent}  ${dim(v.suggestion)}`);
  }
}

// ── Graph Command ────────────────────────────────────────────────

async function runGraph(roots: string[]) {
  const resolvedRoots = roots.map((r) => path.resolve(r.replace(/^~/, process.env.HOME || '')));

  const graph = await buildGraph(resolvedRoots);

  for (const hub of graph.hubs) {
    console.log(bold(`Hub: ${hub.name}`));
    console.log(`  Path: ${hub.path}`);
    console.log(`  Purpose: ${hub.constitution.purpose}`);
    console.log(`  Spokes: ${hub.spokes.length}`);
    console.log('');

    for (const spoke of hub.spokes) {
      const constStatus = spoke.constitution ? green('✓') : yellow('✗ no constitution');
      const confLevel = spoke.confidentiality !== 'none' ? ` [${spoke.confidentiality}]` : '';
      console.log(`  ${spoke.name}/${confLevel}  ${constStatus}`);
      if (spoke.constitution?.purpose) {
        console.log(`    ${dim(spoke.constitution.purpose)}`);
      }
    }

    if (hub.externals.length > 0) {
      console.log('');
      console.log('  Externals:');
      for (const ext of hub.externals) {
        console.log(`    → ${ext.path}${ext.description ? ` (${ext.description})` : ''}`);
      }
    }

    console.log('');
  }

  // Edge summary
  const depEdges = graph.edges.filter((e) => e.kind === 'depends_on');
  if (depEdges.length > 0) {
    console.log(bold('Dependencies:'));
    for (const edge of depEdges) {
      const fromName = edge.from.split('/').pop();
      const toName = edge.to.split('/').pop();
      console.log(`  ${fromName} → ${toName}${edge.description ? ` (${edge.description})` : ''}`);
    }
  }
}

// ── Serve Command ───────────────────────────────────────────────

function parseFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function runServe(roots: string[], args: string[]) {
  const resolvedRoots = roots.map((r) => path.resolve(r.replace(/^~/, process.env.HOME || '')));

  const portFlag = parseFlag(args, '--port');
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    roots: resolvedRoots,
    port: portFlag !== null ? Number(portFlag) : DEFAULT_CONFIG.port,
    socketPath: parseFlag(args, '--socket'),
    dbPath: parseFlag(args, '--db') ?? DEFAULT_CONFIG.dbPath,
    goalsDbPath: parseFlag(args, '--goals-db') ?? DEFAULT_CONFIG.goalsDbPath,
    watch: !args.includes('--no-watch'),
  };

  console.log(dim('Starting ContexGin daemon...'));

  const server = await createServer(config);

  // Initial build
  console.log(dim('Building initial graph...'));
  const buildStart = Date.now();
  await server.rebuild();
  const buildTime = Date.now() - buildStart;

  const graph = server.state.graph!;
  const spokeCount = graph.hubs.reduce((n, h) => n + h.spokes.length, 0);
  console.log(
    green(`✓ Built graph: ${graph.hubs.length} hubs, ${spokeCount} spokes (${buildTime}ms)`),
  );

  // Start listener
  const listener = await startListeners(server, config);
  if (listener.isSocket) {
    console.log(green(`✓ Listening on Unix socket: ${listener.address}`));
  } else {
    console.log(green(`✓ Listening on ${listener.address}`));
  }

  // Start file watcher
  let watcher: ReturnType<typeof startWatcher> | null = null;
  if (config.watch) {
    watcher = startWatcher(server, config);
    console.log(dim(`  Watching ${watcher.watchCount} roots for constitution changes`));
  }

  // Cleanup on shutdown — always register, even without watcher
  const cleanup = async () => {
    console.log(dim('\nShutting down...'));
    watcher?.close();
    await server.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const base = listener.isSocket ? `unix:${listener.address}` : listener.address;
  console.log('');
  console.log(bold('API endpoints:'));
  console.log(`  GET  ${base}/health`);
  console.log(`  POST ${base}/compile`);
  console.log(`  POST ${base}/validate`);
  console.log(`  GET  ${base}/graph`);
  console.log(`  GET  ${base}/graph/:hubId`);
  console.log('');
  console.log(dim('Press Ctrl+C to stop'));
}

// ── Run ──────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
