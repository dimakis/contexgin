const { readFileSync } = require('node:fs');
const { Script } = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const gate = readFileSync('.github/workflows/centaur-gate.yml', 'utf8');
const script = gate.split('          script: |\n')[1].split('\n').map(l => l.slice(12)).join('\n');
const head = 'a'.repeat(40);
const other = 'b'.repeat(40);
const body = `<!-- centaur:sha:${head} -->\n## Centaur Review\nLGTM — no issues found.\n\n### Convergence\n**Recommendation:** \`merge\`\n- New blocking findings: 0\n- Unresolved blocking findings: 0\n`;
const report = { user: { login: 'dimakis' }, body, commit_id: head, state: 'COMMENTED' };
async function run({ reports = [report], prs = [{ number: 1, head: { sha: head } }], next, previous = [], reviewer = '', event = {} } = {}) {
  const statuses = []; const reads = new Map(); const inspected = [];
  const github = { rest: {
    pulls: { list: 'pulls', listReviews: 'reviews', get: async ({ pull_number }) => {
      inspected.push(pull_number); const count = reads.get(pull_number) || 0;
      reads.set(pull_number, count + 1);
      return { data: { state: 'open', head: { sha: count && next ? next : prs.find(p => p.number === pull_number).head.sha } } };
    } },
    issues: { listComments: 'comments' },
    repos: { listCommitStatuses: 'statuses', createCommitStatus: async s => statuses.push(s) },
  }, paginate: async (endpoint, args) => endpoint === 'pulls' ? prs : endpoint === 'reviews' ?
    (Array.isArray(reports) ? reports : reports[args.pull_number] || []) : endpoint === 'statuses' ? previous : [] };
  await new Script(`(async () => {${script}})()`).runInNewContext({ github, context: { repo: { owner: 'dimakis', repo: 'example' }, payload: event }, process: { env: { CENTAUR_STATUS_APP_LOGIN: 'centaur-status[bot]', CENTAUR_REVIEWER_LOGIN: reviewer } } });
  return { statuses, inspected };
}
test('accepts final current-head owner report', async () => assert.equal((await run()).statuses[0].state, 'success'));
test('blocks missing, untrusted, dismissed and non-merge reports', async () => {
  for (const [reports, state] of [[[], 'pending'], [[{ ...report, user: { login: 'other' } }], 'pending'], [[{ ...report, state: 'DISMISSED' }], 'failure'], [[{ ...report, body: body.replace('`merge`', '`fix`') }], 'failure']]) {
    assert.equal((await run({ reports })).statuses[0].state, state);
  }
});
test('blocks unresolved findings and quoted approvals', async () => {
  for (const changed of [body.replace('Unresolved blocking findings: 0', 'Unresolved blocking findings: 1'), body.replace('LGTM — no issues found.', 'Found issues.') + '\n```\n' + body + '\n```']) {
    assert.equal((await run({ reports: [{ ...report, body: changed }] })).statuses[0].state, 'failure');
  }
});
test('invalidates older-head approval and writes nothing after a head race', async () => {
  assert.equal((await run({ prs: [{ number: 1, head: { sha: other } }] })).statuses[0].state, 'pending');
  assert.equal((await run({ next: other })).statuses.length, 0);
});
test('configured reviewer is case insensitive', async () => {
  assert.equal((await run({ reviewer: 'CENTAUR-BOT', reports: [{ ...report, user: { login: 'Centaur-Bot' } }] })).statuses[0].state, 'success');
  assert.equal((await run({ reviewer: 'centaur-bot' })).statuses[0].state, 'pending');
});
test('shared heads never produce a passing commit status', async () => {
  const result = await run({ prs: [{ number: 1, head: { sha: head } }, { number: 2, head: { sha: head } }], reports: { 1: [report], 2: [] } });
  assert.equal(result.statuses.length, 2);
  assert.ok(result.statuses.every(s => s.state === 'failure'));
});
test('every event reconciles unrelated PRs, including retained pending events', async () => {
  const result = await run({ prs: [{ number: 1, head: { sha: head } }, { number: 2, head: { sha: other } }], event: { issue: { number: 1 } } });
  assert.ok(result.inspected.includes(2)); assert.equal(result.statuses.length, 2);
});
test('deduplicates only the dedicated App status', async () => {
  const prior = login => [{ context: 'Centaur final LGTM', state: 'success', creator: { login } }];
  assert.equal((await run({ previous: prior('centaur-status[bot]') })).statuses.length, 0);
  assert.equal((await run({ previous: prior('github-actions[bot]') })).statuses.length, 1);
});
test('withdraws a previous success after dismissal', async () => {
  const result = await run({ reports: [{ ...report, state: 'DISMISSED' }], previous: [{ context: 'Centaur final LGTM', state: 'success', creator: { login: 'centaur-status[bot]' } }] });
  assert.equal(result.statuses[0].state, 'failure');
});
test('review changes signal a protected default-branch reconciliation without PR execution', () => {
  const signal = readFileSync('.github/workflows/centaur-review-signal.yml', 'utf8');
  assert.match(signal, /pull_request_review:/); assert.match(signal, /submitted, edited, dismissed/);
  assert.match(gate, /workflow_run:/); assert.match(gate, /workflows: \[Centaur review signal\]/);
  assert.match(gate, /environment: centaur-status-writer/);
  assert.doesNotMatch(gate, /actions\/checkout/); assert.doesNotMatch(signal, /secrets\.|actions\/checkout/);
});
