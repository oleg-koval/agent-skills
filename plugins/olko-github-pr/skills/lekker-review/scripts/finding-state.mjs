#!/usr/bin/env node
// Per-PR finding state for lekker-review, so re-reviews converge.
//
// A re-review used to know only the last head sha and dedupe by file:line, so a
// finding the author had already rejected came back every round. This keeps one
// small JSON file per PR next to the run ledger (${LEKKER_STATE_DIR:-
// ~/.local/state/lekker-review}/findings/) holding each finding's status and the
// number of review cycles.
//
// Statuses: open | fixed | rejected | intentional. A finding is
//   fixed       when GitHub marks its thread outdated (the line changed)
//   intentional when the author replied "by design" and the code did not change
//   rejected    when the author replied with another dismissal, or the thread
//               was resolved without a code change
//
// Usage:
//   node finding-state.mjs begin  --repo <slug> --target <pr-N> [--threads <threads.json>]
//       Folds thread outcomes into the stored statuses, counts the cycle, and
//       prints {cycle, rethink, suppressed, recurringClasses} for workflow.js.
//   node finding-state.mjs record --repo <slug> --target <pr-N> --findings <findings.json>
//       Stores this run's findings as open (an already-known finding keeps its status).
//   node finding-state.mjs show   --repo <slug> --target <pr-N>
//
// threads.json: { prAuthor, threads: [{ path, line, body, isResolved, isOutdated,
// replies: [{ author, body }] }] }, where `body` is lekker's comment and only
// replies by `prAuthor` count as the author's answer. A bare array is accepted
// when the author is unknown; it can then only yield fixed (outdated) threads.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETHINK_CYCLE = 4;
const LINE_WINDOW = 30;
const INTENT = /\b(intentional(ly)?|by design|on purpose|deliberate(ly)?|as designed|expected behaviou?r)\b/i;
const DISMISS = /\b(won'?t fix|wontfix|not a (bug|problem|concern)|false positive|disagree|n\/a|not applicable|out of scope|ignor(e|ing)|nit)\b/i;

export function titleTokens(title) {
  return (String(title || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

export function sameIssue(a, b) {
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const shared = ta.filter((w) => setB.has(w)).length;
  return shared / new Set(ta.concat(tb)).size >= 0.4;
}

export function sameFinding(a, b) {
  const la = Number(a.line);
  const lb = Number(b.line);
  const near = Number.isFinite(la) && Number.isFinite(lb) ? Math.abs(la - lb) <= LINE_WINDOW : a.line === b.line;
  return a.file === b.file && near && sameIssue(a, b);
}

// Group key for "the same kind of finding came back again".
export function findingClass(f) {
  return f.bugClass || titleTokens(f.title).slice(0, 4).sort().join('-') || 'unclassified';
}

export function classifyThread(thread, prAuthor) {
  const authorReplies = (thread.replies || []).filter((r) => r.author && r.author === prAuthor);
  const text = authorReplies.map((r) => r.body).join('\n');
  if (thread.isOutdated) return 'fixed';
  if (INTENT.test(text)) return 'intentional';
  if (DISMISS.test(text)) return 'rejected';
  if (thread.isResolved) return 'rejected';
  return 'open';
}

export function applyThreads(findings, threads, prAuthor) {
  return findings.map((f) => {
    const thread = threads.find((t) => sameFinding(f, { file: t.path, line: t.line, title: t.title || t.body }));
    if (!thread) return f;
    const status = classifyThread(thread, prAuthor);
    return status === 'open' || f.status === status ? f : { ...f, status };
  });
}

export function mergeFindings(prior, found, cycle) {
  const added = found
    .filter((f) => !prior.some((p) => sameFinding(p, f)))
    .map((f) => ({ file: f.file, line: f.line, title: f.title, class: findingClass(f), status: 'open', cycles: [cycle] }));
  const seen = prior.map((p) => (found.some((f) => sameFinding(p, f)) && !p.cycles.includes(cycle)
    ? { ...p, cycles: [...p.cycles, cycle] }
    : p));
  return seen.concat(added);
}

export function recurringClasses(findings) {
  const byClass = findings.reduce((acc, f) => {
    const cycles = new Set([...(acc[f.class] || []), ...f.cycles]);
    return { ...acc, [f.class]: [...cycles] };
  }, {});
  return Object.entries(byClass)
    .filter(([, cycles]) => cycles.length >= 2)
    .map(([cls, cycles]) => ({ class: cls, cycles: cycles.length }))
    .sort((a, b) => b.cycles - a.cycles);
}

export function suppressedFindings(findings) {
  return findings
    .filter((f) => f.status === 'rejected' || f.status === 'intentional')
    .map(({ file, line, title, status }) => ({ file, line, title, status }));
}

export function begin(state, threads, prAuthor) {
  const findings = applyThreads(state.findings, threads, prAuthor);
  const cycle = state.cycle + 1;
  return {
    state: { cycle, findings },
    summary: {
      cycle,
      rethink: cycle >= RETHINK_CYCLE,
      suppressed: suppressedFindings(findings),
      recurringClasses: recurringClasses(findings),
    },
  };
}

const STATE_DIR = process.env.LEKKER_STATE_DIR || join(homedir(), '.local', 'state', 'lekker-review');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const statePath = (repo, target) => join(STATE_DIR, 'findings', `${slug(repo)}-${slug(target)}.json`);

function load(path) {
  if (!existsSync(path)) return { cycle: 0, findings: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { cycle: 0, findings: [] }; }
}

function save(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

function main(argv) {
  const flag = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1]; };
  const repo = flag('repo');
  const target = flag('target');
  if (!repo || !target) { console.log(JSON.stringify({ error: '--repo and --target are required' })); process.exit(2); }
  const path = statePath(repo, target);
  const state = load(path);
  const cmd = argv[0];
  if (cmd === 'begin') {
    const raw = flag('threads') ? JSON.parse(readFileSync(flag('threads'), 'utf8')) : [];
    const threads = Array.isArray(raw) ? raw : raw.threads || [];
    const prAuthor = Array.isArray(raw) ? null : raw.prAuthor || null;
    const next = begin(state, threads, prAuthor);
    save(path, next.state);
    console.log(JSON.stringify(next.summary));
  } else if (cmd === 'record') {
    const raw = JSON.parse(readFileSync(flag('findings'), 'utf8'));
    const found = Array.isArray(raw) ? raw : raw.findings || [];
    const cycle = Math.max(state.cycle, 1);
    save(path, { cycle, findings: mergeFindings(state.findings, found, cycle) });
    console.log(JSON.stringify({ recorded: found.length, cycle }));
  } else if (cmd === 'show') {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log(JSON.stringify({ error: 'usage: begin|record|show' }));
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
