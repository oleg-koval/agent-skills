import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LABEL, publishReview, reviewComment, validateReceipt } from '../plugins/olko-github-pr/skills/lekker-review/scripts/review-label.mjs';

const receipt = (overrides = {}) => ({
  version: 1, mode: 'branch', result: 'passed', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
  engine: 'codex', depth: 'medium', reviewedAt: '2026-10-29T09:00:00Z', findings: [], ...overrides,
});

function fakeGh(heads = ['a'.repeat(40)]) {
  const calls = [];
  let reads = 0;
  const run = (exe, args, options) => {
    assert.equal(exe, 'gh');
    calls.push({ args, input: options.input });
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ state: 'OPEN', headRefOid: heads[Math.min(reads++, heads.length - 1)] });
    }
    return '{}';
  };
  return { calls, run };
}

test('receipt rejects PR-mode, missing evidence and unresolved blocking findings', () => {
  for (const invalid of [
    { mode: 'pr' }, { headSha: 'short' }, { result: 'failed' }, { reviewedAt: 'unknown' },
    { findings: [{ severity: 'important', disposition: 'open' }] },
    { findings: [{ severity: 'critical', disposition: 'fixed' }] },
    { findings: [{ severity: 'critical', disposition: 'rebutted', evidence: '' }] },
  ]) assert.throws(() => validateReceipt(receipt(invalid)));
  assert.doesNotThrow(() => validateReceipt(receipt({ findings: [
    { severity: 'critical', disposition: 'fixed', evidence: 'Verifier and regression test passed' },
    { severity: 'important', disposition: 'rebutted', evidence: 'Guard exists in the caller' },
    { severity: 'observation', disposition: 'open' },
  ] })));
});

test('publishes commit, engine, depth, result before adding the label', () => {
  const { calls, run } = fakeGh();
  assert.deepEqual(publishReview({ repo: 'owner/repo', pr: 12, receipt: receipt() }, run), { label: LABEL, headSha: 'a'.repeat(40) });
  const posted = calls.findIndex(c => c.args.includes('POST'));
  const labeled = calls.findIndex(c => c.args.includes('--add-label'));
  assert.ok(posted < labeled);
  const body = JSON.parse(calls[posted].input).body;
  assert.match(body, /Engine: codex\nDepth: medium/);
  assert.match(body, /"headSha":"a{40}"/);
  assert.match(body, /Result: passed/);
  assert.ok(calls.some(c => c.args.includes('repos/owner/repo/contents/.github/workflows/reviewed-before-push.yml')));
});

test('does not publish or label a stale receipt or invalid target', () => {
  const { calls, run } = fakeGh(['c'.repeat(40)]);
  assert.throws(() => publishReview({ repo: 'owner/repo', pr: 12, receipt: receipt() }, run), /head differs/);
  assert.equal(calls.length, 1);
  assert.throws(() => publishReview({ repo: '--evil', pr: 12, receipt: receipt() }, run), /Expected --repo/);
  assert.equal(calls.length, 1);
});

test('withholds label when the head moves before labeling and removes it if it moves afterwards', () => {
  for (const heads of [
    ['a'.repeat(40), 'c'.repeat(40)],
    ['a'.repeat(40), 'a'.repeat(40), 'c'.repeat(40)],
  ]) {
    const { calls, run } = fakeGh(heads);
    assert.throws(() => publishReview({ repo: 'owner/repo', pr: 12, receipt: receipt() }, run), /head differs/);
    assert.equal(calls.some(c => c.args.includes('--add-label')), heads.length === 3);
    assert.equal(calls.some(c => c.args.includes('--remove-label')), heads.length === 3);
  }
});

test('missing cleanup workflow fails before posting or labeling', () => {
  const gh = fakeGh();
  const run = (exe, args, options) => {
    if (args.includes('repos/owner/repo/contents/.github/workflows/reviewed-before-push.yml')) throw new Error('404');
    return gh.run(exe, args, options);
  };
  assert.throws(() => publishReview({ repo: 'owner/repo', pr: 12, receipt: receipt() }, run), /404/);
  assert.equal(gh.calls.length, 1);
});

const workflowPath = 'plugins/olko-github-pr/skills/lekker-review/references/reviewed-before-push.yml';
const workflow = readFileSync(workflowPath, 'utf8');
const script = workflow.split('          script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function reconcile(comments, head = 'a'.repeat(40)) {
  const removed = [];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { head: { sha: head }, labels: [{ name: LABEL }] } }) },
      issues: { listComments: Symbol('listComments'), removeLabel: async args => removed.push(args) },
    },
    paginate: async () => comments,
  };
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 12 } } };
  await new AsyncFunction('github', 'context', script)(github, context);
  return removed;
}

test('publisher and cleanup require valid UTC ISO review timestamps', async () => {
  for (const reviewedAt of [
    '2026-10-29T09:00:00Z', '2026-10-29T09:00:00.123Z',
    '2026-10-29T09:00:00.1Z', '2026-10-29T09:00:00.123456Z',
    '2024-02-29T23:59:59Z',
  ]) {
    const valid = receipt({ reviewedAt });
    assert.doesNotThrow(() => validateReceipt(valid), reviewedAt);
    assert.equal((await reconcile([{ author_association: 'OWNER', body: reviewComment(valid) }])).length, 0, reviewedAt);
  }
  for (const reviewedAt of [
    undefined, null, 0, 2026, [], {}, '', 'unknown', '2026-10-29',
    'Thu, 29 Oct 2026 09:00:00 GMT', '2026-10-29 09:00:00Z',
    '2026-10-29T09:00:00', '2026-10-29T09:00:00+00:00',
    '2026-10-29T10:00:00+01:00', '2026-10-29T09:00Z',
    '2026-10-29T24:00:00Z', '2026-10-29T09:60:00Z', '2026-10-29T09:00:60Z',
    '2026-02-29T09:00:00Z', '2026-04-31T09:00:00Z', '2026-13-01T09:00:00Z',
    '2026-10-29T09:00:00Z\n',
  ]) {
    const invalid = receipt({ reviewedAt });
    const { calls, run } = fakeGh();
    assert.throws(() => publishReview({ repo: 'owner/repo', pr: 12, receipt: invalid }, run), /Invalid branch-review receipt/);
    assert.equal(calls.length, 0);
    const body = `<!-- lekker:reviewed-before-push ${JSON.stringify(invalid)} -->`;
    assert.equal((await reconcile([{ author_association: 'OWNER', body }])).length, 1, String(reviewedAt));
  }
});

test('workflow preserves matching evidence and removes stale, malformed or untrusted evidence', async () => {
  const comment = { author_association: 'COLLABORATOR', body: reviewComment(receipt()) };
  assert.equal((await reconcile([comment])).length, 0);
  assert.equal((await reconcile([comment], 'c'.repeat(40))).length, 1);
  assert.equal((await reconcile([{ ...comment, author_association: 'NONE' }])).length, 1);
  assert.equal((await reconcile([{ ...comment, body: '<!-- lekker:reviewed-before-push {broken} -->' }])).length, 1);
  assert.equal((await reconcile([])).length, 1);
});

test('workflow accepts a new reviewed head after an older receipt, and is shipped without checkout', async () => {
  const old = { author_association: 'OWNER', body: reviewComment(receipt()) };
  const current = { author_association: 'OWNER', body: reviewComment(receipt({ headSha: 'c'.repeat(40) })) };
  assert.equal((await reconcile([old, current], 'c'.repeat(40))).length, 0);
  assert.match(workflow, /synchronize/);
  assert.match(workflow, /github\.paginate/);
  assert.doesNotMatch(workflow, /uses: actions\/checkout/);
  assert.equal(readFileSync('.github/workflows/reviewed-before-push.yml', 'utf8'), workflow);
});
