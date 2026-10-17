#!/usr/bin/env node
// Close the loop on bot-comment prediction: record what the review predicted,
// then score it against what the bots actually said.
//
// Without this, "we pre-empted the bot comments" is a claim nobody checks. The
// only honest way to know whether pre-emption works is to write the prediction
// down BEFORE the bots run and compare afterwards - so that is what this does.
//
// Usage:
//   node bot-precision.mjs record --repo <slug> --pr <n> --predicted <findings.json> [--at <iso>]
//   node bot-precision.mjs score  --repo <slug> --pr <n>
//   node bot-precision.mjs summary
//
// Store: $LEKKER_DATA_DIR/bot-precision.jsonl, default ~/.cache/lekker-review
// (one JSON object per line, append-only). Override with --jsonl <path>.
//
// `record` takes either a lint-findings.mjs output ({findings:[...]}) or a bare
// array of findings; each needs at least `file`, and `line`/`title` when known.

import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, fallback = null) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
}

const JSONL = flag(
  'jsonl',
  join(process.env.LEKKER_DATA_DIR || join(homedir(), '.cache', 'lekker-review'), 'bot-precision.jsonl'),
);

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

// Private: the store quotes review comments, which can come from private repos.
function ensureStore() {
  mkdirSync(dirname(JSONL), { recursive: true, mode: 0o700 });
}

function readRecords() {
  if (!existsSync(JSONL)) return [];
  return readFileSync(JSONL, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function append(record) {
  ensureStore();
  appendFileSync(JSONL, JSON.stringify(record) + '\n', { mode: 0o600 });
}

// --- matching -------------------------------------------------------------
//
// A prediction counts as matched when a bot commented on the SAME FILE within
// LINE_WINDOW lines of it. Deliberately not semantic: an LLM judging its own
// prediction against the comment it was trying to predict would grade itself,
// and file+line is checkable by hand from the jsonl.
const LINE_WINDOW = 20;

// Both sides are repo-relative paths, so only a leading "./" or "/" differs.
function normFile(p) {
  return String(p || '').replace(/^(\.\/|\/)+/, '');
}

// null/undefined is "no line", not line 0 (Number(null) is 0).
function toLine(v) {
  return v == null ? NaN : Number(v);
}

function matches(prediction, comment) {
  if (normFile(prediction.file) !== normFile(comment.path)) return false;
  const a = toLine(prediction.line);
  const b = toLine(comment.line ?? comment.original_line);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true; // same file, no usable line
  return Math.abs(a - b) <= LINE_WINDOW;
}

const BOT_RE = /gemini-code-assist|greptile|coderabbit/i;

const pct = v => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

function fetchBotComments(repo, pr) {
  const raw = execFileSync(
    'gh',
    ['api', `repos/${repo}/pulls/${pr}/comments?per_page=100`, '--paginate', '--slurp'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const pages = JSON.parse(raw);
  const flat = [];
  for (const page of pages) {
    if (Array.isArray(page)) flat.push(...page);
    else if (page) flat.push(page);
  }
  // Replies in a bot's own thread ("Thanks, updated") are not new findings.
  return flat
    .filter(c => c?.user?.type === 'Bot' && BOT_RE.test(c?.user?.login || '') && !c.in_reply_to_id)
    .map(c => ({
      path: c.path,
      line: c.line ?? c.original_line,
      createdAt: c.created_at || null,
      author: c.user.login,
      url: c.html_url,
      claim: String(c.body || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    }));
}

// --- commands -------------------------------------------------------------

if (cmd === 'record') {
  const repo = flag('repo');
  const pr = flag('pr');
  const predictedPath = flag('predicted');
  if (!repo || !pr || !predictedPath) {
    die('usage: bot-precision.mjs record --repo <slug> --pr <n> --predicted <findings.json>');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(predictedPath, 'utf8'));
  } catch (err) {
    die(`could not read predictions: ${err.message}`);
  }
  const findings = Array.isArray(parsed) ? parsed : parsed.findings || [];
  // A grouped lint finding stands for every site it lists; a bot comment on
  // any of them was predicted.
  const predicted = findings.flatMap(f =>
    (Array.isArray(f.lintSites) && f.lintSites.length ? f.lintSites : [f]).map(s => ({
      file: s.file,
      line: s.line,
      title: f.title,
      rule: f.rule || null,
      severity: f.severity || null,
      source: f.botPredicted ? 'lint-preflight' : 'review-agent',
    })),
  );
  // --at backdates the prediction to when it was made: branch mode records it
  // after creating the PR, and a bot can comment in between.
  const at = flag('at') || new Date().toISOString();
  if (Number.isNaN(Date.parse(at))) die(`--at is not a timestamp: ${at}`);
  append({
    kind: 'prediction',
    repo,
    pr: Number(pr),
    at,
    predictedCount: predicted.length,
    predicted,
  });
  console.log(`bot-precision: recorded ${predicted.length} prediction(s) for ${repo}#${pr}`);
  process.exit(0);
}

if (cmd === 'score') {
  const repo = flag('repo');
  const pr = flag('pr');
  if (!repo || !pr) die('usage: bot-precision.mjs score --repo <slug> --pr <n>');

  // The FIRST prediction is the one made before the bots ran; a re-review
  // records another after seeing their comments.
  const prediction = readRecords().find(
    r => r.kind === 'prediction' && r.repo === repo && r.pr === Number(pr),
  );
  if (!prediction) {
    // No prediction is "unknown", not "0% precision" - scoring an unrecorded
    // review would manufacture a number out of a missing input.
    console.log(`bot-precision: no recorded prediction for ${repo}#${pr} - nothing to score`);
    process.exit(0);
  }

  let fetched;
  try {
    fetched = fetchBotComments(repo, pr);
  } catch (err) {
    die(`gh api failed: ${err.message}`, 1);
  }
  // A comment posted before the prediction was visible when it was made, so
  // it cannot count as predicted or missed.
  // Compared as instants at whole-second precision: GitHub timestamps have no
  // fraction, and a string compare against "...:00.500Z" orders them wrongly.
  const cutoff = Math.floor(Date.parse(prediction.at) / 1000) * 1000;
  const comments = fetched.filter(c => !c.createdAt || Date.parse(c.createdAt) >= cutoff);
  const preexisting = fetched.length - comments.length;

  if (comments.length === 0) {
    // Distinguish "the bots left nothing" from "the bots have not run yet":
    // the caller knows which, this script does not, so say both.
    console.log(
      `bot-precision: ${repo}#${pr} has 0 bot comment(s). ` +
        `Either the bots found nothing (${prediction.predictedCount} prediction(s) unrefuted) ` +
        `or they have not run yet - re-run score once they have.`,
    );
    process.exit(0);
  }

  const hitPredictions = prediction.predicted.filter(p => comments.some(c => matches(p, c)));
  const predictedComments = comments.filter(c => prediction.predicted.some(p => matches(p, c)));
  const missed = comments.filter(c => !prediction.predicted.some(p => matches(p, c)));

  const precision = prediction.predicted.length
    ? hitPredictions.length / prediction.predicted.length
    : null;
  const recall = comments.length ? predictedComments.length / comments.length : null;

  const record = {
    kind: 'score',
    repo,
    pr: Number(pr),
    at: new Date().toISOString(),
    predictedCount: prediction.predicted.length,
    botCommentCount: comments.length,
    preexistingExcluded: preexisting,
    predictedAndRaised: hitPredictions.length,
    botCommentsPredicted: predictedComments.length,
    precision,
    recall,
    matchRule: `same file within ${LINE_WINDOW} lines`,
    missedBotComments: missed.slice(0, 20),
  };
  append(record);

  console.log(
    `bot-precision ${repo}#${pr}: ` +
      `predicted ${record.predictedCount}, bots left ${record.botCommentCount}, ` +
      `precision ${pct(precision)} (${hitPredictions.length}/${record.predictedCount}), ` +
      `recall ${pct(recall)} (${predictedComments.length}/${record.botCommentCount}) ` +
      `[match: ${record.matchRule}]`,
  );
  if (missed.length) {
    console.log(`bot-precision: ${missed.length} bot comment(s) not predicted:`);
    for (const m of missed.slice(0, 5)) {
      console.log(`  - ${m.path}:${m.line ?? '?'} ${m.claim.slice(0, 110)}`);
    }
  }
  process.exit(0);
}

if (cmd === 'summary') {
  // A PR is scored again once more bot comments land; only its latest score
  // counts, or a re-scored PR would weigh double in the means.
  const latest = new Map();
  for (const r of readRecords()) {
    if (r.kind === 'score') latest.set(`${r.repo}#${r.pr}`, r);
  }
  const scores = [...latest.values()];
  if (!scores.length) {
    console.log('bot-precision: no scored reviews yet');
    process.exit(0);
  }
  const avg = key => {
    const vals = scores.map(s => s[key]).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  console.log(
    `bot-precision summary: ${scores.length} scored review(s), ` +
      `mean precision ${pct(avg('precision'))}, mean recall ${pct(avg('recall'))}`,
  );
  for (const s of scores.slice(-10)) {
    console.log(
      `  ${s.repo}#${s.pr} ${s.at.slice(0, 10)}: ` +
        `precision ${pct(s.precision)}, recall ${pct(s.recall)} ` +
        `(${s.predictedCount} predicted / ${s.botCommentCount} bot comments)`,
    );
  }
  process.exit(0);
}

die('usage: bot-precision.mjs <record|score|summary> [flags]');
