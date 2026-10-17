#!/usr/bin/env node
// eslint JSON report -> lekker-review findings, tagged botPredicted.
//
// Why this exists: the bot reviewers (Greptile, Gemini) spend most of their
// budget restating what the repo's own eslint config already says, and they are
// wrong about it more often than eslint is. On one observed PR three of four
// predicted bot comments were eslint rules, and eslint OVERRULED the model's
// guess (it had suggested `.forEach`, which that config bans). So the linter is
// the authority for this class of finding, not an LLM.
//
// Usage:
//   node lint-findings.mjs <eslint-json-file> <out-findings-json> [--max N] [--base <sha>]
//
// --base keeps only messages on lines the change added (git diff -U0 <sha> HEAD
// in LEKKER_WORKTREE_PATH). eslint lints whole files, but bots comment on diff
// lines, so standing debt elsewhere in a touched file is not a prediction and
// must not reach fix mode. The dropped count is reported as summary.outOfDiff.
//
// Reads an `eslint -f json` report. Writes {"findings":[...], "summary": {...}}
// where each finding matches the FINDINGS_SCHEMA shape used by workflow.js,
// plus `botPredicted: true` and `rule: "LINT:<ruleId>"`.
//
// Findings are grouped by ruleId and file so a rule that fires 40 times in a
// file produces one finding listing the other sites, not 40 findings that drown
// the review. Per file, because fix mode routes each finding to its one file.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const [, , inPath, outPath, ...rest] = process.argv;

if (!inPath || !outPath) {
  console.error('usage: lint-findings.mjs <eslint-json-file> <out-json> [--max N] [--base <sha>]');
  process.exit(2);
}

const maxIdx = rest.indexOf('--max');
const MAX_FINDINGS = maxIdx === -1 ? 25 : Number(rest[maxIdx + 1]) || 25;
const baseIdx = rest.indexOf('--base');
const BASE = baseIdx === -1 ? null : rest[baseIdx + 1];

// eslint severity 2 = error, 1 = warning.
//
// An error is something CI will reject and a bot will certainly comment on, so
// it is `important`. A warning is style the team has chosen not to enforce, so
// it lands in `idiomatic` where it cannot affect the verdict.
function severityFor(eslintSeverity) {
  return eslintSeverity === 2 ? 'important' : 'idiomatic';
}

// Write a zero-finding result whose status says why, then stop. A missing,
// empty or malformed report is "unknown", never "clean", so the review header
// cannot claim a green lint that never ran.
function bail(status, why) {
  writeFileSync(
    outPath,
    JSON.stringify({ findings: [], summary: { status, ruleCount: 0, messageCount: 0 } }, null, 2),
  );
  console.log(`lint-findings: ${why}, 0 findings`);
  process.exit(0);
}

let report;
try {
  const raw = readFileSync(inPath, 'utf8').trim();
  if (!raw) bail('empty-report', 'empty eslint report');
  report = JSON.parse(raw);
} catch (err) {
  bail('unreadable: ' + err.message, `could not read eslint report (${err.message})`);
}

if (!Array.isArray(report)) bail('not-an-eslint-json-report', 'report is not an eslint JSON array');
// eslint emits one entry per linted file, so [] means nothing was linted.
if (report.length === 0) bail('empty-report', 'eslint report lists no files');

// Resolve symlinks on both sides: on macOS /tmp is /private/tmp, so eslint's
// filePath and the worktree path given here can spell the same dir differently.
function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const repoRoot = process.env.LEKKER_WORKTREE_PATH ? real(process.env.LEKKER_WORKTREE_PATH) : '';

function relativize(p) {
  if (!repoRoot || !isAbsolute(p)) return p;
  const rel = relative(repoRoot, real(p));
  return rel.startsWith('..') ? p : rel;
}

// repo-relative path -> Set of line numbers the change added, or null when no
// --base was given or git could not answer (then nothing is filtered).
function addedLines() {
  if (!BASE || !repoRoot) return null;
  let out;
  try {
    // Explicit prefixes: diff.noprefix / diff.mnemonicPrefix would otherwise
    // change the "+++ b/" header the parser below slices.
    const args = ['-C', repoRoot, 'diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', BASE, 'HEAD'];
    out = execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const added = new Map();
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(6);
      if (file && !added.has(file)) added.set(file, new Set());
      continue;
    }
    const hunk = file && /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i++) added.get(file).add(start + i);
  }
  return added;
}

const added = addedLines();
let outOfDiff = 0;

// Group every message by ruleId. Parse errors arrive with ruleId null; they are
// real and worth surfacing, so they get their own bucket.
const byRule = new Map();
let messageCount = 0;

for (const file of report) {
  const filePath = String(file?.filePath ?? '');
  for (const m of file?.messages ?? []) {
    // A message with no ruleId is a parse error only when eslint marks it
    // fatal. The rest are notices such as "File ignored because of a matching
    // ignore pattern", which flag nothing wrong with the code.
    if (!m.ruleId && !m.fatal) continue;
    const ruleId = m.ruleId ?? 'parse-error';
    // A parse error breaks the whole file, so it counts wherever it lands.
    if (added && ruleId !== 'parse-error' && !added.get(relativize(filePath))?.has(m.line)) {
      outOfDiff++;
      continue;
    }
    messageCount++;
    const key = `${ruleId}\0${filePath}`;
    if (!byRule.has(key)) {
      byRule.set(key, { ruleId, severity: m.severity ?? 2, fixable: false, sites: [] });
    }
    const bucket = byRule.get(key);
    // A rule reported at both levels keeps the louder one.
    bucket.severity = Math.max(bucket.severity, m.severity ?? 2);
    if (m.fix) {
      bucket.fixable = true;
    }
    bucket.sites.push({
      file: filePath,
      line: m.line ?? 1,
      column: m.column ?? 1,
      message: String(m.message ?? '').trim(),
    });
  }
}

// Errors before warnings, then the rules that fire most - a rule hit 12 times
// is a pattern the author is repeating, and worth more than a one-off.
const ruleCount = new Set([...byRule.values()].map(b => b.ruleId)).size;
const buckets = [...byRule.values()].sort((a, b) => {
  if (b.severity !== a.severity) return b.severity - a.severity;
  return b.sites.length - a.sites.length;
});

// The offending source line, so badCode is code and not a location string.
function sourceLine(file, line) {
  try {
    const abs = isAbsolute(file) ? file : join(repoRoot, file);
    const text = readFileSync(abs, 'utf8').split('\n')[line - 1];
    if (text?.trim()) return text.trim();
  } catch {
    // unreadable file: fall back to the location
  }
  return null;
}

const findings = buckets.slice(0, MAX_FINDINGS).map(bucket => {
  const first = bucket.sites[0];
  const others = bucket.sites.slice(1);
  const extra = others.length
    ? ' Also at: ' + others.slice(0, 8).map(s => `${relativize(s.file)}:${s.line}`).join(', ') +
      (others.length > 8 ? ` (+${others.length - 8} more)` : '') + '.'
    : '';

  return {
    file: relativize(first.file),
    line: first.line,
    severity: severityFor(bucket.severity),
    title: `${bucket.ruleId} (${bucket.sites.length} site${bucket.sites.length === 1 ? '' : 's'})`,
    description:
      `The repo's own eslint config reports \`${bucket.ruleId}\` on the changed files: ` +
      `"${first.message}".${extra} ` +
      `This is the repo's configured rule, not a preference - it is the single most likely ` +
      `bot-reviewer comment on this diff, and CI enforces it.` +
      (bucket.fixable ? ' eslint can fix this automatically (`eslint --fix`).' : ''),
    badCode:
      sourceLine(first.file, first.line) ?? `${relativize(first.file)}:${first.line}:${first.column}`,
    fix: bucket.fixable
      ? `Apply eslint's autofix for \`${bucket.ruleId}\` to the cited lines only, then re-read the hunk. ` +
        `A file-wide \`eslint --fix\` also rewrites lines this change did not touch.`
      : `Resolve \`${bucket.ruleId}\` as the config intends. Check what the rule permits before ` +
        `substituting another form: a config that bans one idiom often bans its obvious replacement too.`,
    rule: `LINT:${bucket.ruleId}`,
    botPredicted: true,
    lintFixable: bucket.fixable,
    lintSiteCount: bucket.sites.length,
    // Every site, so bot-precision can match a bot comment on any of them.
    lintSites: bucket.sites.map(s => ({ file: relativize(s.file), line: s.line })),
  };
});

const result = {
  findings,
  summary: {
    status: messageCount === 0 ? 'clean' : 'issues',
    ruleCount: ruleCount,
    messageCount,
    truncated: Math.max(0, buckets.length - findings.length),
    outOfDiff,
  },
};

writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(
  `lint-findings: ${messageCount} message(s) across ${ruleCount} rule(s) -> ` +
    `${findings.length} finding(s)${result.summary.truncated ? ` (${result.summary.truncated} rule(s) truncated)` : ''}`,
);
