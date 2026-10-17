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
//   node lint-findings.mjs <eslint-json-file> <out-findings-json> [--max N]
//
// Reads an `eslint -f json` report. Writes {"findings":[...], "summary": {...}}
// where each finding matches the FINDINGS_SCHEMA shape used by workflow.js,
// plus `botPredicted: true` and `rule: "LINT:<ruleId>"`.
//
// Findings are grouped by ruleId so a rule that fires 40 times produces one
// finding listing the other sites, not 40 findings that drown the review.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const [, , inPath, outPath, ...rest] = process.argv;

if (!inPath || !outPath) {
  console.error('usage: lint-findings.mjs <eslint-json-file> <out-json> [--max N]');
  process.exit(2);
}

const maxIdx = rest.indexOf('--max');
const MAX_FINDINGS = maxIdx === -1 ? 25 : Number(rest[maxIdx + 1]) || 25;

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

// Group every message by ruleId. Parse errors arrive with ruleId null; they are
// real and worth surfacing, so they get their own bucket.
const byRule = new Map();
let messageCount = 0;

for (const file of report) {
  const filePath = String(file?.filePath ?? '');
  for (const m of file?.messages ?? []) {
    const ruleId = m.ruleId ?? 'parse-error';
    messageCount++;
    if (!byRule.has(ruleId)) {
      byRule.set(ruleId, { ruleId, severity: m.severity ?? 2, fixable: false, sites: [] });
    }
    const bucket = byRule.get(ruleId);
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
const buckets = [...byRule.values()].sort((a, b) => {
  if (b.severity !== a.severity) return b.severity - a.severity;
  return b.sites.length - a.sites.length;
});

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
      ? `Run \`npx eslint --fix\` on the changed files, then re-read the hunk - the autofix is authoritative here.`
      : `Resolve \`${bucket.ruleId}\` as the config intends. Check what the rule permits before ` +
        `substituting another form: a config that bans one idiom often bans its obvious replacement too.`,
    rule: `LINT:${bucket.ruleId}`,
    botPredicted: true,
    lintFixable: bucket.fixable,
    lintSiteCount: bucket.sites.length,
  };
});

const result = {
  findings,
  summary: {
    status: messageCount === 0 ? 'clean' : 'issues',
    ruleCount: byRule.size,
    messageCount,
    truncated: Math.max(0, buckets.length - findings.length),
  },
};

writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(
  `lint-findings: ${messageCount} message(s) across ${byRule.size} rule(s) -> ` +
    `${findings.length} finding(s)${result.summary.truncated ? ` (${result.summary.truncated} rule(s) truncated)` : ''}`,
);
