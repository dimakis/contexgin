#!/usr/bin/env node

import * as path from 'node:path';
import { buildGraph } from './graph/builder.js';
import { validateGraph } from './graph/validate.js';
import type { Violation, ViolationSeverity } from './graph/types.js';

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
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
${bold('contexgin')} — structural graph validation for workspaces

${bold('Commands:')}
  validate <root> [root2] ...   Validate workspace structure
  graph <root> [root2] ...      Print graph summary

${bold('Examples:')}
  npx contexgin validate ~/redhat/mgmt
  npx contexgin validate ~/redhat/mgmt ~/projects
  npx contexgin graph ~/redhat/mgmt
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
    const key = v.location.split('/').slice(0, 2).join('/');
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

// ── Run ──────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
