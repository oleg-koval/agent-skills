#!/usr/bin/env node
// Measure lekker's noise from what humans did with its comments.
//
// bot-precision.mjs only compares predictions with other bots. The honest signal
// is whether the author acted on a comment, so this reads lekker's own posted
// inline comments and classifies each one:
//   fixed      the thread is outdated: the code at that location changed after the comment
//   dismissed  the PR author replied with a dismissal
//   resolved   the thread was resolved, but its code outcome is unknown
//   ignored    none of the above (no code change, no dismissal, still open)
// and reports the dismissal rate per agent.
//
// Identification: the pending review is posted under the requesting user's own
// account, so the author cannot tell lekker from a human. github-post.md makes
// every inline comment end with `<!-- lekker:<dimension> -->`; only threads whose
// first comment carries that marker are counted.
//
// Usage:
//   node human-noise.mjs --repo <owner/repo> --pr <n> [--pr <n>...] [--json]
//   node human-noise.mjs --from <threads.json> [--json]
//       threads.json: [{ prAuthor, threads: [{ path, line, isResolved, isOutdated,
//       comments: [{ author, body }] }] }]   (offline fixture / saved fetch)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARKER = /<!--\s*lekker:([a-z0-9-]+)\s*-->/i;
export const AGENTS = ['quality', 'implementation', 'simplification', 'conventions', 'test-quality'];

const INTENT = /\b(intentional(ly)?|by design|on purpose|deliberate(ly)?|as designed|expected behaviou?r)\b/i;
const DISMISS = /\b(won'?t fix|wontfix|not a (bug|problem|concern)|false positive|disagree|n\/a|not applicable|out of scope|ignor(e|ing)|nit)\b/i;

// Self-contained on purpose: this script must not depend on other lekker scripts.
export function classifyThread(thread, prAuthor) {
  const text = (thread.replies || [])
    .filter((r) => r.author && r.author === prAuthor)
    .map((r) => r.body)
    .join('\n');
  if (thread.isOutdated) return 'fixed';
  if (INTENT.test(text) || DISMISS.test(text)) return 'dismissed';
  if (thread.isResolved) return 'resolved';
  return 'ignored';
}

export function agentOf(body) {
  const m = MARKER.exec(String(body || ''));
  return m ? m[1].toLowerCase() : null;
}

export function classifyLekkerThread(thread, prAuthor) {
  const [first, ...rest] = thread.comments || [];
  const agent = first ? agentOf(first.body) : null;
  if (!agent) return null;
  const outcome = classifyThread({
    isOutdated: thread.isOutdated,
    isResolved: thread.isResolved,
    replies: rest,
  }, prAuthor);
  return { agent, path: thread.path, line: thread.line, outcome };
}

export function summarize(prs) {
  const rows = prs.flatMap((pr) => (pr.threads || [])
    .map((t) => classifyLekkerThread(t, pr.prAuthor))
    .filter(Boolean));
  const byAgent = rows.reduce((acc, r) => {
    const cur = acc[r.agent] || { fixed: 0, dismissed: 0, resolved: 0, ignored: 0 };
    return { ...acc, [r.agent]: { ...cur, [r.outcome]: cur[r.outcome] + 1 } };
  }, {});
  const agents = Object.entries(byAgent).map(([agent, c]) => {
    const total = c.fixed + c.dismissed + c.resolved + c.ignored;
    return { agent, total, ...c, dismissalRate: total === 0 ? null : c.dismissed / total };
  }).sort((a, b) => AGENTS.indexOf(a.agent) - AGENTS.indexOf(b.agent) || a.agent.localeCompare(b.agent));
  return { comments: rows.length, agents };
}

const QUERY = `query($owner:String!,$name:String!,$pr:Int!,$cursor:String){repository(owner:$owner,name:$name){
pullRequest(number:$pr){author{login} reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor}
nodes{id isResolved isOutdated path line comments(first:50){pageInfo{hasNextPage endCursor}
nodes{author{login} body}}}}}}}`;

const COMMENTS_QUERY = `query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{
comments(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{author{login} body}}}}}`;

export function fetchPr(repo, pr, run = execFileSync) {
  const [owner, name] = repo.split('/');
  const request = (query, fields) => JSON.parse(run('gh', ['api', 'graphql', '-f', `query=${query}`,
    ...Object.entries(fields).flatMap(([key, value]) => [key === 'pr' ? '-F' : '-f', `${key}=${value}`]),
  ], { encoding: 'utf8' })).data;
  const threads = [];
  let prAuthor = null;
  let cursor;
  while (true) {
    const node = request(QUERY, { owner, name, pr, ...(cursor ? { cursor } : {}) }).repository.pullRequest;
    prAuthor = node.author ? node.author.login : null;
    for (const t of node.reviewThreads.nodes) {
      let page = t.comments;
      const comments = [...page.nodes];
      while (page.pageInfo.hasNextPage) {
        page = request(COMMENTS_QUERY, { id: t.id, cursor: page.pageInfo.endCursor }).node.comments;
        comments.push(...page.nodes);
      }
      threads.push({
        path: t.path,
        line: t.line,
        isResolved: t.isResolved,
        isOutdated: t.isOutdated,
        comments: comments.map((c) => ({ author: c.author ? c.author.login : null, body: c.body })),
      });
    }
    if (!node.reviewThreads.pageInfo.hasNextPage) break;
    cursor = node.reviewThreads.pageInfo.endCursor;
  }
  return { prAuthor, threads };
}

function render(s) {
  const pct = (r) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
  const lines = s.agents.map((a) =>
    `${a.agent.padEnd(15)} ${String(a.total).padStart(3)} comments  fixed ${a.fixed}  dismissed ${a.dismissed}  resolved ${a.resolved}  ignored ${a.ignored}  dismissal rate ${pct(a.dismissalRate)}`);
  return [`lekker inline comments scored: ${s.comments}`, ...lines].join('\n');
}

function main(argv) {
  const values = (name) => argv.flatMap((a, i) => (a === '--' + name && argv[i + 1] ? [argv[i + 1]] : []));
  const from = values('from')[0];
  const repo = values('repo')[0];
  const prNumbers = values('pr');
  if (!from && !(repo && prNumbers.length)) {
    console.error('usage: human-noise.mjs --repo <owner/repo> --pr <n> [--pr <n>...] | --from <threads.json> [--json]');
    process.exit(2);
  }
  const prs = from ? JSON.parse(readFileSync(from, 'utf8')) : prNumbers.map((n) => fetchPr(repo, n));
  const summary = summarize(prs);
  console.log(argv.includes('--json') ? JSON.stringify(summary) : render(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
