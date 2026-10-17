#!/usr/bin/env node
// Close the loop on bot-comment prediction: record what the review predicted,
// then score it against what the bots actually said.
//
// Without this, "we pre-empted the bot comments" is a claim nobody checks. The
// only honest way to know whether pre-emption works is to write the prediction
// down BEFORE the bots run and compare afterwards - so that is what this does.
//
// Usage:
//   node bot-precision.mjs record --repo <slug> --pr <n> --predicted <findings.json>
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

function ensureStore() {
  mkdirSync(dirname(JSONL), { recursive: true });
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
  appendFileSync(JSONL, JSON.stringify(record) + '\n');
}

// --- matching -------------------------------------------------------------
//
// A prediction counts as matched when a bot commented on the SAME FILE within
// LINE_WINDOW lines of it. Deliberately not semantic: an LLM judging its own
// prediction against the comment it was trying to predict would grade itself,
// and file+line is checkable by hand from the jsonl.
const LINE_WINDOW = 20;

function normFile(p) {
  return String(p || '').replace(/^\/+/, '').replace(/^.*?(?=web\/|extensions\/|src\/)/, '');
}

function matches(prediction, comment) {
  if (normFile(prediction.file) !== normFile(comment.path)) return false;
  const a = Number(prediction.line);
  const b = Number(comment.line ?? comment.original_line);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true; // same file, no usable line
  return Math.abs(a - b) <= LINE_WINDOW;
}

const BOT_RE = /gemini-code-assist|greptile|coderabbit/i;

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
  return flat
    .filter(c => BOT_RE.test(c?.user?.login || ''))
    .map(c => ({
      path: c.path,
      line: c.line ?? c.original_line,
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
  const predicted = findings.map(f => ({
    file: f.file,
    line: f.line,
    title: f.title,
    rule: f.rule || null,
    severity: f.severity || null,
    source: f.botPredicted ? 'lint-preflight' : 'review-agent',
  }));
  append({
    kind: 'prediction',
    repo,
    pr: Number(pr),
    at: new Date().toISOString(),
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

  const prediction = readRecords()
    .filter(r => r.kind === 'prediction' && r.repo === repo && r.pr === Number(pr))
    .pop();
  if (!prediction) {
    // No prediction is "unknown", not "0% precision" - scoring an unrecorded
    // review would manufacture a number out of a missing input.
    console.log(`bot-precision: no recorded prediction for ${repo}#${pr} - nothing to score`);
    process.exit(0);
  }

  let comments;
  try {
    comments = fetchBotComments(repo, pr);
  } catch (err) {
    die(`gh api failed: ${err.message}`, 1);
  }

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
    predictedAndRaised: hitPredictions.length,
    botCommentsPredicted: predictedComments.length,
    precision,
    recall,
    matchRule: `same file within ${LINE_WINDOW} lines`,
    missedBotComments: missed.slice(0, 20),
  };
  append(record);

  const pct = v => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
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
  const scores = readRecords().filter(r => r.kind === 'score');
  if (!scores.length) {
    console.log('bot-precision: no scored reviews yet');
    process.exit(0);
  }
  const avg = key => {
    const vals = scores.map(s => s[key]).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const pct = v => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
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
