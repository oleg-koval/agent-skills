#!/usr/bin/env node
// Measure lekker's noise from what humans did with its comments.
//
// bot-precision.mjs only compares predictions with other bots. The honest signal
// is whether the author acted on a comment, so this reads lekker's own posted
// inline comments and classifies each one:
//   fixed      the thread is outdated: the code at that location changed after the comment
//   dismissed  the PR author replied with a dismissal
//   resolved   resolved, but no code outcome is known
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
    const cur = acc[r.agent] || { fixed: 0, dismissed: 0, ignored: 0, resolved: 0 };
    return { ...acc, [r.agent]: { ...cur, [r.outcome]: cur[r.outcome] + 1 } };
  }, {});
  const agents = Object.entries(byAgent).map(([agent, c]) => {
    const total = c.fixed + c.dismissed + c.ignored;
    const allComments = total + c.resolved;
    return {
      agent,
      total: allComments,
      ...c,
      dismissalRate: total === 0 ? null : c.dismissed / total,
    };
  }).sort((a, b) => AGENTS.indexOf(a.agent) - AGENTS.indexOf(b.agent) || a.agent.localeCompare(b.agent));
  return { comments: rows.length, agents };
}

const FETCH_TIMEOUT_MS = 30_000;
const THREADS_QUERY = `query($owner:String!,$name:String!,$pr:Int!,$threadCursor:String){repository(owner:$owner,name:$name){
pullRequest(number:$pr){author{login} reviewThreads(first:100,after:$threadCursor){nodes{id isResolved isOutdated path line
comments(first:50){nodes{author{login} body} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}`;
const COMMENTS_QUERY = `query($threadId:ID!,$commentCursor:String){node(id:$threadId){... on PullRequestReviewThread{
comments(first:50,after:$commentCursor){nodes{author{login} body} pageInfo{hasNextPage endCursor}}}}}`;

function graphql(repo, pr, query, cursors, run) {
  const [owner, name] = repo.split('/');
  const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`,
    '-F', `name=${name}`, '-F', `pr=${pr}`];
  for (const [key, value] of Object.entries(cursors)) {
    if (value !== undefined) args.push('-f', `${key}=${value}`);
  }
  let output;
  try {
    output = run('gh', args, { encoding: 'utf8', timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ETIMEDOUT') {
      throw new Error(`GitHub GraphQL fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${repo}#${pr}`, { cause: error });
    }
    throw error;
  }
  return JSON.parse(output).data;
}

function nextCursor(pageInfo, connection) {
  if (!pageInfo.hasNextPage) return null;
  if (!pageInfo.endCursor) throw new Error(`GitHub GraphQL ${connection} page has no end cursor`);
  return pageInfo.endCursor;
}

function allComments(repo, pr, thread, run) {
  const comments = thread.comments.nodes.map((c) => ({
    author: c.author ? c.author.login : null,
    body: c.body,
  }));
  let cursor = nextCursor(thread.comments.pageInfo, 'comments');
  while (cursor) {
    const data = graphql(repo, pr, COMMENTS_QUERY, { threadId: thread.id, commentCursor: cursor }, run);
    const page = data.node.comments;
    comments.push(...page.nodes.map((c) => ({
      author: c.author ? c.author.login : null,
      body: c.body,
    })));
    cursor = nextCursor(page.pageInfo, 'comments');
  }
  return comments;
}

export function fetchPr(repo, pr, run = execFileSync) {
  const threads = [];
  let cursor;
  let prAuthor = null;
  do {
    const data = graphql(repo, pr, THREADS_QUERY, { threadCursor: cursor }, run);
    const pullRequest = data.repository.pullRequest;
    if (pullRequest.author) prAuthor = pullRequest.author.login;
    const page = pullRequest.reviewThreads;
    threads.push(...page.nodes.map((thread) => ({
      path: thread.path,
      line: thread.line,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      comments: allComments(repo, pr, thread, run),
    })));
    cursor = nextCursor(page.pageInfo, 'reviewThreads');
  } while (cursor);
  return {
    prAuthor,
    threads,
  };
}

export function fetchPrs(repo, prNumbers, fetch = fetchPr) {
  return Array.from(new Set(prNumbers), (pr) => fetch(repo, pr));
}

function render(s) {
  const pct = (r) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
  const lines = s.agents.map((a) =>
    `${a.agent.padEnd(15)} ${String(a.total).padStart(3)} comments  fixed ${a.fixed}  dismissed ${a.dismissed}  ignored ${a.ignored}  resolved ${a.resolved}  dismissal rate ${pct(a.dismissalRate)}`);
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
  const prs = from ? JSON.parse(readFileSync(from, 'utf8')) : fetchPrs(repo, prNumbers);
  const summary = summarize(prs);
  console.log(argv.includes('--json') ? JSON.stringify(summary) : render(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
