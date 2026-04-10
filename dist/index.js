// src/compiler/index.ts
import * as fs from 'fs/promises';
import * as path from 'path';

// src/compiler/parser.ts
function stripFrontmatter(source) {
  if (!source.startsWith('---')) {
    return source;
  }
  const endIndex = source.indexOf('\n---', 3);
  if (endIndex === -1) {
    return source;
  }
  const afterFrontmatter = endIndex + 4;
  return source.slice(afterFrontmatter).replace(/^\n/, '');
}
function parseMarkdown(source) {
  const lines = source.split('\n');
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  const headings = [];
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = headingRegex.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        lineNumber: i + 1,
        // 1-based
        lineIndex: i,
      });
    }
  }
  if (headings.length === 0) {
    return [];
  }
  const flatNodes = headings.map((h, idx) => {
    const startLine = h.lineIndex + 1;
    const endLine = idx < headings.length - 1 ? headings[idx + 1].lineIndex : lines.length;
    const contentLines = lines.slice(startLine, endLine);
    const content = contentLines.join('\n');
    return {
      level: h.level,
      title: h.title,
      content,
      children: [],
      line: h.lineNumber,
    };
  });
  return buildTree(flatNodes);
}
function buildTree(flatNodes) {
  const roots = [];
  const stack = [];
  for (const node of flatNodes) {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      trimParentContent(parent, node);
    }
    stack.push(node);
  }
  return roots;
}
function trimParentContent(parent, child) {
  const parentContentLines = parent.content.split('\n');
  const headingPattern = '#'.repeat(child.level) + ' ' + child.title;
  let cutIndex = -1;
  let inCodeBlock = false;
  for (let i = 0; i < parentContentLines.length; i++) {
    const line = parentContentLines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock && line.trim() === headingPattern) {
      cutIndex = i;
      break;
    }
  }
  if (cutIndex >= 0) {
    parent.content = parentContentLines.slice(0, cutIndex).join('\n');
  }
}

// src/compiler/trimmer.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function trimToBudget(sections, budget) {
  const sorted = [...sections].sort((a, b) => b.relevance - a.relevance);
  const included = [];
  const trimmed = [];
  let usedTokens = 0;
  for (const section of sorted) {
    if (usedTokens + section.tokenEstimate <= budget) {
      included.push(section);
      usedTokens += section.tokenEstimate;
    } else {
      trimmed.push(section);
    }
  }
  return { included, trimmed };
}

// src/compiler/extractor.ts
function extractSection(nodes, path4, source) {
  if (path4.length === 0) return null;
  const [first, ...rest] = path4;
  const node = nodes.find((n) => n.title === first);
  if (!node) return null;
  if (rest.length === 0) {
    const fullContent = collectFullContent(node);
    return {
      source,
      headingPath: path4,
      level: node.level,
      content: fullContent,
      tokenEstimate: estimateTokens(fullContent),
    };
  }
  const child = extractSection(node.children, rest, source);
  if (!child) return null;
  return {
    ...child,
    headingPath: [first, ...child.headingPath],
  };
}
function collectFullContent(node) {
  let content = node.content;
  for (const child of node.children) {
    content +=
      '\n' + '#'.repeat(child.level) + ' ' + child.title + '\n' + collectFullContent(child);
  }
  return content;
}
function extractAllLevel2(nodes, source) {
  const sections = [];
  for (const node of nodes) {
    if (node.level === 2) {
      const fullContent = collectFullContent(node);
      sections.push({
        source,
        headingPath: [node.title],
        level: node.level,
        content: fullContent,
        tokenEstimate: estimateTokens(fullContent),
      });
    }
    for (const child of node.children) {
      if (child.level === 2) {
        const fullContent = collectFullContent(child);
        sections.push({
          source,
          headingPath: [node.title, child.title],
          level: child.level,
          content: fullContent,
          tokenEstimate: estimateTokens(fullContent),
        });
      }
    }
  }
  return sections;
}
function cleanContent(content) {
  let cleaned = content;
  cleaned = cleaned.replace(/^See:.*$/gm, '');
  cleaned = cleaned.replace(/^Applied in:.*$/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();
  return cleaned;
}

// src/compiler/ranker.ts
var TIER_WEIGHTS = {
  constitutional: 1,
  // Purpose, principles, boundaries — always top
  navigational: 0.8,
  // Architecture, directory semantics, entry points
  identity: 0.7,
  // Profile, communication style, working style
  reference: 0.5,
  // Services, memory observations
  historical: 0.3,
  // Session notes, old decisions
};
var NAVIGATIONAL_HEADINGS = [
  'architecture',
  'directory',
  'structure',
  'entry point',
  'navigation',
  'boundaries',
  'layout',
];
var CONSTITUTIONAL_HEADINGS = ['purpose', 'principles', 'boundaries', 'constitution', 'governance'];
var HISTORICAL_HEADINGS = ['session', 'history', 'decisions', 'log', 'journal'];
function getTierWeight(section) {
  const headingText = section.headingPath.join(' ').toLowerCase();
  if (section.source.kind === 'constitution') {
    if (CONSTITUTIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.constitutional, reason: 'constitutional content' };
    }
    if (NAVIGATIONAL_HEADINGS.some((kw) => headingText.includes(kw))) {
      return { weight: TIER_WEIGHTS.navigational, reason: 'navigational content' };
    }
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
  return { weight: TIER_WEIGHTS.reference, reason: 'reference content' };
}
function getTaskBoost(section, taskHint) {
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
  return (matches / taskTerms.length) * 0.2;
}
function rankSections(sections, options) {
  const ranked = sections.map((section) => {
    const { weight, reason } = getTierWeight(section);
    const boost = options?.taskHint ? getTaskBoost(section, options.taskHint) : 0;
    const relevance = Math.min(weight + boost, 1);
    return {
      ...section,
      relevance,
      reason: boost > 0 ? `${reason} + task boost` : reason,
    };
  });
  ranked.sort((a, b) => b.relevance - a.relevance);
  return ranked;
}

// src/compiler/index.ts
async function discoverSources(workspaceRoot) {
  const sources = [];
  const root = path.resolve(workspaceRoot);
  const rootFiles = [
    { file: 'CONSTITUTION.md', kind: 'constitution' },
    { file: 'CLAUDE.md', kind: 'reference' },
    { file: 'SERVICES.md', kind: 'service' },
  ];
  for (const { file, kind } of rootFiles) {
    const fullPath = path.join(root, file);
    if (await fileExists(fullPath)) {
      sources.push({ path: fullPath, kind, relativePath: file });
    }
  }
  const profileDir = path.join(root, 'memory', 'Profile');
  if (await dirExists(profileDir)) {
    const profileFiles = await fs.readdir(profileDir);
    for (const file of profileFiles) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(profileDir, file);
        const relativePath = path.join('memory', 'Profile', file);
        sources.push({ path: fullPath, kind: 'profile', relativePath });
      }
    }
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('node_modules') &&
        entry.name !== 'dist'
      ) {
        const spokeConst = path.join(root, entry.name, 'CONSTITUTION.md');
        if (await fileExists(spokeConst)) {
          sources.push({
            path: spokeConst,
            kind: 'constitution',
            relativePath: path.join(entry.name, 'CONSTITUTION.md'),
          });
        }
      }
    }
  } catch {}
  return sources;
}
async function compile(options) {
  const { workspaceRoot, tokenBudget, taskHint } = options;
  const sources = options.sources ?? (await discoverSources(workspaceRoot));
  const allSections = [];
  for (const source of sources) {
    try {
      const raw = await fs.readFile(source.path, 'utf-8');
      const content = stripFrontmatter(raw);
      const nodes = parseMarkdown(content);
      const sections = extractAllLevel2(nodes, source);
      for (const section of sections) {
        section.content = cleanContent(section.content);
        const headingOverhead = section.headingPath[section.headingPath.length - 1].length + 10;
        section.tokenEstimate =
          estimateTokens(section.content) + estimateTokens(' '.repeat(headingOverhead));
      }
      allSections.push(...sections);
    } catch {}
  }
  const ranked = rankSections(allSections, { taskHint });
  const filtered = options.excluded
    ? ranked.filter(
        (s) =>
          !options.excluded.some(
            (excl) =>
              excl.length <= s.headingPath.length &&
              excl.every((seg, i) => s.headingPath[i] === seg),
          ),
      )
    : ranked;
  const { included, trimmed } = trimToBudget(filtered, tokenBudget);
  const bootPayload = included
    .map((s) => {
      const heading = '#'.repeat(s.level) + ' ' + s.headingPath[s.headingPath.length - 1];
      return heading + '\n\n' + s.content;
    })
    .join('\n\n');
  const navigationHints = included.map((s) => s.headingPath.join(' > '));
  return {
    bootPayload,
    contextBlocks: /* @__PURE__ */ new Map(),
    navigationHints,
    bootTokens: estimateTokens(bootPayload),
    sources,
    trimmed,
  };
}
async function fileExists(p) {
  try {
    const stat3 = await fs.stat(p);
    return stat3.isFile();
  } catch {
    return false;
  }
}
async function dirExists(p) {
  try {
    const stat3 = await fs.stat(p);
    return stat3.isDirectory();
  } catch {
    return false;
  }
}

// src/integrity/claims.ts
var COMMAND_PATTERNS = [
  /^(npm|npx|git|yarn|pnpm|pip|python|node|cargo|go|make|docker)\b/,
  /^(cd|ls|cat|echo|rm|mv|cp|mkdir|chmod|chown|curl|wget)\b/,
  /^(export|source|set|unset)\b/,
];
function isPathLike(text) {
  if (/^https?:\/\//.test(text)) return false;
  if (/^[a-z]+:\/\//.test(text)) return false;
  if (COMMAND_PATTERNS.some((p) => p.test(text))) return false;
  if (!text.includes('/') && !text.includes('.') && !text.includes('\\')) return false;
  if (/\s/.test(text) && !text.startsWith('./') && !text.startsWith('../')) return false;
  return /[a-zA-Z0-9_\-.]+(\/[a-zA-Z0-9_\-.]+)*\/?/.test(text);
}
function extractClaims(content, sourcePath) {
  const claims = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let inEntryPointsSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (/^#{1,6}\s+.*[Ee]ntry\s*[Pp]oint/i.test(line)) {
      inEntryPointsSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line) && inEntryPointsSection) {
      inEntryPointsSection = false;
    }
    const backtickPattern = /`([^`]+)`/g;
    let match;
    while ((match = backtickPattern.exec(line)) !== null) {
      const text = match[1].trim();
      if (!isPathLike(text)) continue;
      if (inEntryPointsSection) {
        claims.push({
          source: sourcePath,
          assertion: `Entry point ${text} exists`,
          kind: 'entry_point',
          target: text,
          line: lineNumber,
        });
      } else if (text.endsWith('/')) {
        claims.push({
          source: sourcePath,
          assertion: `Directory ${text} exists`,
          kind: 'directory_exists',
          target: text,
          line: lineNumber,
        });
      } else {
        claims.push({
          source: sourcePath,
          assertion: `File ${text} exists`,
          kind: 'file_exists',
          target: text,
          line: lineNumber,
        });
      }
    }
    if (inEntryPointsSection && line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim());
      for (const cell of cells) {
        const cellBackticks = /`([^`]+)`/g;
        let cellMatch;
        while ((cellMatch = cellBackticks.exec(cell)) !== null) {
          const text = cellMatch[1].trim();
          if (isPathLike(text)) {
            if (!claims.some((c) => c.target === text && c.line === lineNumber)) {
              claims.push({
                source: sourcePath,
                assertion: `Entry point ${text} exists`,
                kind: 'entry_point',
                target: text,
                line: lineNumber,
              });
            }
          }
        }
      }
    }
  }
  return claims;
}

// src/integrity/validator.ts
import * as fs2 from 'fs/promises';
import * as path2 from 'path';
async function validateClaim(claim, workspaceRoot) {
  const targetPath = path2.resolve(workspaceRoot, claim.target.replace(/\/$/, ''));
  switch (claim.kind) {
    case 'file_exists': {
      try {
        const stat3 = await fs2.stat(targetPath);
        if (stat3.isFile()) {
          return { claim, valid: true, message: `File ${claim.target} exists` };
        }
        return {
          claim,
          valid: false,
          actual: 'directory',
          message: `${claim.target} exists but is a directory, not a file`,
        };
      } catch {
        return { claim, valid: false, message: `File ${claim.target} not found` };
      }
    }
    case 'directory_exists': {
      try {
        const stat3 = await fs2.stat(targetPath);
        if (stat3.isDirectory()) {
          return { claim, valid: true, message: `Directory ${claim.target} exists` };
        }
        return {
          claim,
          valid: false,
          actual: 'file',
          message: `${claim.target} exists but is a file, not a directory`,
        };
      } catch {
        return { claim, valid: false, message: `Directory ${claim.target} not found` };
      }
    }
    case 'entry_point': {
      try {
        await fs2.stat(targetPath);
        return { claim, valid: true, message: `Entry point ${claim.target} exists` };
      } catch {
        return { claim, valid: false, message: `Entry point ${claim.target} not found` };
      }
    }
    case 'boundary':
    case 'structural': {
      return {
        claim,
        valid: true,
        message: `${claim.kind} claim \u2014 skipped (requires manual review)`,
      };
    }
    default: {
      return { claim, valid: false, message: `Unknown claim kind: ${claim.kind}` };
    }
  }
}
async function validateAll(claims, workspaceRoot) {
  const results = await Promise.all(claims.map((claim) => validateClaim(claim, workspaceRoot)));
  const drift = results.filter((r) => !r.valid);
  const byKind = {};
  for (const result of results) {
    const kind = result.claim.kind;
    if (!byKind[kind]) {
      byKind[kind] = { total: 0, invalid: 0 };
    }
    byKind[kind].total++;
    if (!result.valid) {
      byKind[kind].invalid++;
    }
  }
  return {
    timestamp: /* @__PURE__ */ new Date(),
    workspaceRoot,
    results,
    drift,
    summary: {
      total: results.length,
      valid: results.length - drift.length,
      invalid: drift.length,
      byKind,
    },
  };
}

// src/navigation/constitution-index.ts
import * as fs3 from 'fs/promises';
import * as path3 from 'path';
function extractPurpose(content) {
  const lines = content.split('\n');
  let inPurpose = false;
  for (const line of lines) {
    if (/^##\s+Purpose/i.test(line)) {
      inPurpose = true;
      continue;
    }
    if (inPurpose) {
      if (/^#{1,6}\s+/.test(line)) break;
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return '';
}
function extractEntryPoints(content) {
  const lines = content.split('\n');
  let inEntryPoints = false;
  const entryPoints = [];
  for (const line of lines) {
    if (/^#{1,6}\s+.*[Ee]ntry\s*[Pp]oint/i.test(line)) {
      inEntryPoints = true;
      continue;
    }
    if (inEntryPoints && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inEntryPoints && line.includes('|')) {
      const backtickPattern = /`([^`]+)`/g;
      let match;
      while ((match = backtickPattern.exec(line)) !== null) {
        const text = match[1].trim();
        if (text && !text.match(/^-+$/) && text !== 'Command' && text !== 'Export') {
          entryPoints.push(text);
        }
      }
    }
  }
  return entryPoints;
}
function extractDirectorySemantics(content) {
  const semantics = /* @__PURE__ */ new Map();
  const lines = content.split('\n');
  let inDirectorySection = false;
  for (const line of lines) {
    if (/^#{1,6}\s+.*(directory|structure|semantics)/i.test(line)) {
      inDirectorySection = true;
      continue;
    }
    if (inDirectorySection && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inDirectorySection && line.includes('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2) {
        const dir = cells[0].replace(/`/g, '').trim();
        const desc = cells[1].replace(/`/g, '').trim();
        if (dir && desc && !dir.match(/^-+$/) && dir !== 'Directory') {
          semantics.set(dir, desc);
        }
      }
    }
  }
  return semantics;
}
function extractDependencies(content) {
  const deps = [];
  const lines = content.split('\n');
  let inDeps = false;
  for (const line of lines) {
    if (/^#{1,6}\s+.*[Dd]ependenc/i.test(line)) {
      inDeps = true;
      continue;
    }
    if (inDeps && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inDeps) {
      const match = /^\s*[-*]\s+(.+)/.exec(line);
      if (match) {
        deps.push(match[1].replace(/`/g, '').trim());
      }
    }
  }
  return deps;
}
function extractExcluded(content) {
  const excluded = [];
  const lines = content.split('\n');
  let inExcluded = false;
  for (const line of lines) {
    if (/^#{1,6}\s+.*(excluded|confidential|boundar)/i.test(line)) {
      inExcluded = true;
      continue;
    }
    if (inExcluded && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (inExcluded) {
      const match = /^\s*[-*]\s+(.+)/.exec(line);
      if (match) {
        excluded.push(match[1].replace(/`/g, '').trim());
      }
    }
  }
  return excluded;
}
async function indexConstitutions(roots) {
  const entries = [];
  for (const root of roots) {
    const resolvedRoot = path3.resolve(root);
    const spokeName = path3.basename(resolvedRoot);
    const constPath = path3.join(resolvedRoot, 'CONSTITUTION.md');
    try {
      const content = await fs3.readFile(constPath, 'utf-8');
      entries.push({
        path: constPath,
        relativePath: 'CONSTITUTION.md',
        spokeName,
        purpose: extractPurpose(content),
        directorySemantics: extractDirectorySemantics(content),
        dependencies: extractDependencies(content),
        excluded: extractExcluded(content),
        entryPoints: extractEntryPoints(content),
      });
    } catch {}
    try {
      const dirEntries = await fs3.readdir(resolvedRoot, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          entry.name !== 'dist'
        ) {
          const spokeConstPath = path3.join(resolvedRoot, entry.name, 'CONSTITUTION.md');
          try {
            const content = await fs3.readFile(spokeConstPath, 'utf-8');
            entries.push({
              path: spokeConstPath,
              relativePath: path3.join(entry.name, 'CONSTITUTION.md'),
              spokeName: entry.name,
              purpose: extractPurpose(content),
              directorySemantics: extractDirectorySemantics(content),
              dependencies: extractDependencies(content),
              excluded: extractExcluded(content),
              entryPoints: extractEntryPoints(content),
            });
          } catch {}
        }
      }
    } catch {}
  }
  return entries;
}

// src/navigation/reading-list.ts
function scoreEntry(entry, taskTerms) {
  let score = 0;
  const searchableText = [
    entry.spokeName,
    entry.purpose,
    ...entry.entryPoints,
    ...Array.from(entry.directorySemantics.values()),
  ]
    .join(' ')
    .toLowerCase();
  for (const term of taskTerms) {
    if (searchableText.includes(term)) {
      score += 1;
    }
  }
  return score;
}
function generateReadingList(task, index) {
  const taskTerms = task
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const scored = index.map((entry) => ({
    entry,
    score: scoreEntry(entry, taskTerms),
  }));
  scored.sort((a, b) => b.score - a.score);
  const items = [];
  let priority = 1;
  for (const { entry, score } of scored) {
    if (score <= 0) continue;
    items.push({
      path: entry.path,
      reason: `${entry.spokeName}: ${entry.purpose}`,
      priority: priority++,
    });
    for (const ep of entry.entryPoints) {
      items.push({
        path: ep,
        reason: `Entry point for ${entry.spokeName}`,
        section: void 0,
        priority: priority++,
      });
    }
    if (items.length >= 10) break;
  }
  const capped = items.slice(0, 10);
  return {
    task,
    items: capped,
  };
}

// src/navigation/boundaries.ts
function isAccessAllowed(requestingSpoke, targetSpokeName) {
  return !requestingSpoke.excluded.includes(targetSpokeName);
}
function getAccessibleSpokes(from, allSpokes) {
  return allSpokes.filter((spoke) => isAccessAllowed(from, spoke.spokeName));
}

// src/tools/registry.ts
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  register(tool) {
    this.tools.set(tool.name, tool);
  }
  get(name) {
    return this.tools.get(name);
  }
  list() {
    return Array.from(this.tools.values());
  }
  has(name) {
    return this.tools.has(name);
  }
  remove(name) {
    return this.tools.delete(name);
  }
};

// src/permissions/policy.ts
function evaluatePermission(toolName, policy) {
  for (const rule of policy.rules) {
    if (matchesToolPattern(toolName, rule.tool)) {
      return {
        decision: rule.decision,
        matchedRule: rule,
        reason: `Matched rule: ${rule.tool} -> ${rule.decision}`,
      };
    }
  }
  return {
    decision: policy.defaultDecision,
    reason: `No matching rule, using default: ${policy.defaultDecision}`,
  };
}
function matchesToolPattern(toolName, pattern) {
  if (pattern === '*') return true;
  if (pattern === toolName) return true;
  const regexStr = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr).test(toolName);
}
export {
  ToolRegistry,
  cleanContent,
  compile,
  discoverSources,
  estimateTokens,
  evaluatePermission,
  extractAllLevel2,
  extractClaims,
  extractEntryPoints,
  extractPurpose,
  extractSection,
  generateReadingList,
  getAccessibleSpokes,
  indexConstitutions,
  isAccessAllowed,
  parseMarkdown,
  rankSections,
  stripFrontmatter,
  trimToBudget,
  validateAll,
  validateClaim,
};
//# sourceMappingURL=index.js.map
