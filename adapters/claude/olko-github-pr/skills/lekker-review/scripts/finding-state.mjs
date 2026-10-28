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
//               was resolved without a code change and the PR author is known
//
// Usage:
//   node finding-state.mjs begin  --repo <slug> --target <pr-N> [--threads <threads.json>]
//       Folds thread outcomes into the stored statuses, counts the cycle, and
//       prints {cycle, rethink, suppressed, recurringClasses} for workflow.js.
//   node finding-state.mjs record --repo <slug> --target <pr-N> --findings <findings.json>
//       Stores this run's findings as open (an already-known finding keeps its status).
//   node finding-state.mjs show   --repo <slug> --target <pr-N>
//
// threads.json: { prAuthor, threads: [{ path, line, title?, body, isResolved, isOutdated,
// replies: [{ author, body }] }] }, where `body` is lekker's comment and only
// replies by `prAuthor` count as the author's answer. A bare array is accepted
// when the author is unknown; it can then only yield fixed (outdated) threads.
// When title is absent, the first nonempty comment line supplies the title.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETHINK_CYCLE = 4;
const INTENT = /\b(intentional(ly)?|by design|on purpose|deliberate(ly)?|as designed|expected behaviou?r)\b/i;
const DISMISS = /\b(won'?t fix|wontfix|not a (bug|problem|concern)|false positive|disagree|n\/a|not applicable|out of scope|ignor(e|ing)|nit)\b/i;

export function titleTokens(title) {
  return (String(title || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
}

export function sameIssue(a, b) {
  const normalize = (title) => String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const title = normalize(a.title);
  return title !== '' && title === normalize(b.title);
}

export function sameFinding(a, b) {
  // Status reuse requires the same anchor and title; word overlap is only a
  // class signal, never proof that two findings identify the same issue.
  return Boolean(a.file) && a.file === b.file && a.line === b.line && sameIssue(a, b);
}

// Group key for "the same kind of finding came back again".
export function findingClass(f) {
  return f.bugClass || titleTokens(f.title).slice(0, 4).sort().join('-') || 'unclassified';
}

const NEGATOR = /\b(not|no|never|nor|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|won'?t|cannot)\b/i;

// Check only the three words before each keyword in its clause for negation.
function mentions(pattern, text) {
  return [...text.matchAll(new RegExp(pattern.source, 'gi'))]
    .some((match) => {
      const before = text.slice(0, match.index).split(/[.!?;:,\n-]/).pop();
      return !NEGATOR.test(before.trim().split(/\s+/).slice(-3).join(' '));
    });
}

export function classifyThread(thread, prAuthor) {
  const authorReplies = (thread.replies || []).filter((r) => r.author && r.author === prAuthor);
  const text = authorReplies.map((r) => r.body).join('\n');
  if (thread.isOutdated) return 'fixed';
  if (mentions(INTENT, text)) return 'intentional';
  if (mentions(DISMISS, text)) return 'rejected';
  if (thread.isResolved && prAuthor) return 'rejected';
  return 'open';
}

export function applyThreads(findings, threads, prAuthor) {
  return findings.map((f) => {
    const thread = threads.find((t) => {
      const title = t.title?.trim() || String(t.body || '').split(/\r?\n/).find((line) => line.trim())
        ?.trim().replace(/^#{1,6}\s+/, '').replace(/^(\*\*|__)(.*?)\1[.:]?$/, '$2');
      return sameFinding(f, { file: t.path, line: t.line, title });
    });
    if (!thread) return f;
    const status = classifyThread(thread, prAuthor);
    return f.status === status ? f : { ...f, status };
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

// A run id makes begin idempotent: a retry of the same run reuses its cycle instead of inflating the count.
export function begin(state, threads, prAuthor, run = null) {
  const findings = applyThreads(state.findings, threads, prAuthor);
  const known = run === null ? undefined : state.runs?.[run];
  const cycle = known ?? state.cycle + 1;
  const runs = run === null || known !== undefined ? state.runs : { ...state.runs, [run]: cycle };
  return {
    state: { ...state, cycle: Math.max(state.cycle, cycle), findings, ...(runs && { runs }) },
    summary: {
      cycle,
      rethink: cycle >= RETHINK_CYCLE,
      suppressed: suppressedFindings(findings),
      recurringClasses: recurringClasses(findings),
    },
  };
}

const STATE_DIR = process.env.LEKKER_STATE_DIR || join(homedir(), '.local', 'state', 'lekker-review');
// Hash the tuple so punctuation, case and repo/target boundaries stay distinct.
const statePath = (repo, target) => join(STATE_DIR, 'findings',
  `${createHash('sha256').update(JSON.stringify([repo, target])).digest('hex')}.json`);

function load(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { cycle: 0, findings: [] };
    throw error;
  }
  const state = JSON.parse(raw);
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || !Number.isSafeInteger(state.cycle) || state.cycle < 0 || !Array.isArray(state.findings)) {
    throw new Error(`Invalid finding state: ${path}`);
  }
  if (state.runs !== undefined && (!state.runs || typeof state.runs !== 'object' || Array.isArray(state.runs)
    || !Object.values(state.runs).every((c) => Number.isSafeInteger(c) && c >= 1))) {
    throw new Error(`Invalid finding state runs: ${path}`);
  }
  return state;
}

function save(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
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
    const next = begin(state, threads, prAuthor, flag('run') ?? null);
    save(path, next.state);
    console.log(JSON.stringify(next.summary));
  } else if (cmd === 'record') {
    const raw = JSON.parse(readFileSync(flag('findings'), 'utf8'));
    const found = Array.isArray(raw) ? raw : raw.findings || [];
    const run = flag('run') ?? null;
    // A late record for an earlier run keeps that run's cycle; the current cycle stays as it was.
    const cycle = run === null ? Math.max(state.cycle, 1) : state.runs?.[run];
    if (cycle === undefined) { console.log(JSON.stringify({ error: `unknown --run ${run}; call begin --run first` })); process.exit(2); }
    save(path, { ...state, cycle: Math.max(state.cycle, 1), findings: mergeFindings(state.findings, found, cycle) });
    console.log(JSON.stringify({ recorded: found.length, cycle }));
  } else if (cmd === 'show') {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log(JSON.stringify({ error: 'usage: begin|record|show' }));
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
