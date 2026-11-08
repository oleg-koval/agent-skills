#!/usr/bin/env node
// Score lekker findings against a manifest of PRs with known outcomes.
//
// Usage:
//   node eval-runner.mjs --manifest <manifest.json> (--results <results.json> | --archive <runs-dir>) [--json]
//
// manifest.json: { prs: [{ repo, pr, expect: "buggy"|"clean", knownBug?: "file:line + description", id?, sha? }] }
//                The case key is `id` when present, else "<repo>#<pr>@<sha>" when `sha` is
//                present, else "<repo>#<pr>". Use id or sha to list one PR at two commits.
// results.json:  { "<case key>": [ <finding>, ... ] }  the findings of one lekker run per case
//                (the `findings` array the workflow returns), or an array of such arrays for
//                repeated runs, which adds per-case hitRate and per-run counts to separate
//                model noise from a real difference. A case missing from results is
//                reported as unscored, never as zero findings.
//
// A buggy PR is HIT when some finding is on the knownBug file within LINE_WINDOW lines
// of the knownBug line. Known limitation: the match is by location only, so a
// same-file finding near the line counts even if it describes a different problem;
// judging "same bug" needs an LLM or a description match and is not attempted. Recall = hits /
// scored buggy runs (one run per case unless a case has repeated runs). On a clean PR every
// verdict-affecting finding (critical or important) is a false positive.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDefectCorpus } from './defect-scoring.mjs';

export const LINE_WINDOW = 10;
const BLOCKING = new Set(['critical', 'important']);

export function parseKnownBug(text) {
  // The file is everything before the last ":<digits>" that is followed by whitespace
  // or the end, so paths containing spaces parse.
  const m = /^(.+):(\d+)(?=\s|$)/.exec(String(text || '').trim());
  if (!m) return null;
  const line = Number(m[2]);
  return line >= 1 ? { file: m[1], line } : null;
}

export function isHit(findings, knownBug) {
  const spot = parseKnownBug(knownBug);
  if (!spot) return false;
  return findings.some((f) => f.file === spot.file
    && Number.isInteger(f.line) && f.line > 0
    && Math.abs(f.line - spot.line) <= LINE_WINDOW);
}

export function caseKey(e) {
  if (typeof e.id === 'string' && e.id) return e.id;
  return typeof e.sha === 'string' && e.sha ? `${e.repo}#${e.pr}@${e.sha}` : `${e.repo}#${e.pr}`;
}

const SHA = /^[0-9a-f]{7,40}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEVERITIES = new Set(['critical', 'important', 'observation', 'idiomatic']);

const isMultiRun = (v) => Array.isArray(v) && v.length > 0 && v.every(Array.isArray);

export function validateManifest(manifest) {
  const prs = manifest && Array.isArray(manifest.prs) ? manifest.prs : null;
  if (!prs) throw new Error('manifest needs a "prs" array');
  const seen = new Set();
  prs.forEach((e, i) => {
    if (!e.repo || !Number.isInteger(e.pr)) throw new Error(`prs[${i}]: repo and integer pr are required`);
    if (e.expect !== 'buggy' && e.expect !== 'clean') throw new Error(`prs[${i}]: expect must be "buggy" or "clean"`);
    if ('id' in e && (typeof e.id !== 'string' || !e.id)) throw new Error(`prs[${i}]: id must be a non-empty string`);
    if ('sha' in e && (typeof e.sha !== 'string' || !SHA.test(e.sha))) throw new Error(`prs[${i}]: sha must be 7 to 40 hex characters`);
    const key = caseKey(e);
    if (seen.has(key)) throw new Error(`prs[${i}]: duplicate entry ${key}`);
    seen.add(key);
    if (e.expect === 'buggy' && !parseKnownBug(e.knownBug)) {
      throw new Error(`prs[${i}]: a buggy entry needs knownBug starting with "file:line" (line >= 1)`);
    }
  });
  return prs;
}

/** Normalize archived review evidence, returning findings only when every identity check passes. */
export function normalizeArchivedEvidence(entry, run, worktree, document) {
  const key = caseKey(entry);
  const unscored = (reason) => ({ key, reason });
  if (typeof entry.runId !== 'string' || !RUN_ID.test(entry.runId)) return unscored('unsafe or missing runId');
  if (typeof entry.sha !== 'string' || !FULL_SHA.test(entry.sha)) return unscored('manifest needs a full 40-character sha');
  if (!run) return unscored('run.json missing or malformed');
  if (run.runId !== entry.runId) return unscored('runId mismatch');
  if (run.status !== 'ok') return unscored('run status is not ok');
  if (!['lgtm', 'lgtm-with-changes', 'needs-work'].includes(run.verdict)) return unscored('run verdict is missing or invalid');
  if (run.review?.name !== 'lekker-review-core' || run.review.status !== 'completed') return unscored('completed review record unavailable');
  if (run.repo !== entry.repo || run.target !== `pr-${entry.pr}`) return unscored('run repo or target mismatch');
  if (!worktree) return unscored('worktree.json missing or malformed');
  if (typeof worktree.headSha !== 'string' || !FULL_SHA.test(worktree.headSha)) return unscored('worktree headSha is not a full SHA');
  if (worktree.headSha.toLowerCase() !== entry.sha.toLowerCase()) return unscored('worktree headSha mismatch');
  const findings = Array.isArray(document) ? document : document?.findings;
  if (!Array.isArray(findings)) return unscored('findings.json missing or malformed');
  if (findings.some((f) => !f || typeof f.file !== 'string' || !f.file.trim() || !SEVERITIES.has(f.severity)
      || !(f.line === null || (Number.isInteger(f.line) && f.line > 0)))) {
    return unscored('findings.json contains a malformed finding');
  }
  return { key, findings, reason: null };
}

// Validate archive references before reading any run directories.
/** Reject duplicate archive run IDs before archive paths are read. */
export function validateArchiveRunIds(entries) {
  const duplicate = entries.find((entry, index) => entry.runId
    && entries.slice(0, index).some(previous => previous.runId === entry.runId));
  if (duplicate) throw new Error(`archive manifest reuses runId ${duplicate.runId}`);
  return entries;
}

function readArchiveJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Load valid archived findings and retain a reason for each rejected run. */
function archivedResults(entries, runsDir) {
  const results = {};
  const reasons = [];
  for (const entry of entries) {
    if (typeof entry.runId !== 'string' || !RUN_ID.test(entry.runId)) {
      reasons.push({ key: caseKey(entry), reason: 'unsafe or missing runId' });
      continue;
    }
    const dir = join(runsDir, entry.runId);
    const evidence = normalizeArchivedEvidence(entry,
      readArchiveJson(join(dir, 'run.json')),
      readArchiveJson(join(dir, 'worktree.json')),
      readArchiveJson(join(dir, 'findings.json')));
    if (evidence.reason) reasons.push({ key: evidence.key, reason: evidence.reason });
    else results[evidence.key] = evidence.findings;
  }
  return { results, reasons };
}

export function score(manifest, results) {
  const rows = validateManifest(manifest).map((e) => {
    const key = caseKey(e);
    const value = results[key];
    if (!Array.isArray(value)) return { key, expect: e.expect, scored: false };
    const runs = isMultiRun(value) ? value : null;
    if (e.expect === 'buggy') {
      if (!runs) return { key, expect: 'buggy', scored: true, hit: isHit(value, e.knownBug) };
      const hits = runs.filter((r) => isHit(r, e.knownBug)).length;
      return { key, expect: 'buggy', scored: true, hit: hits > 0, runs: runs.length, hits, hitRate: hits / runs.length };
    }
    const fp = (r) => r.filter((f) => BLOCKING.has(f.severity)).length;
    if (!runs) return { key, expect: 'clean', scored: true, falsePositives: fp(value) };
    const perRun = runs.map(fp);
    return {
      key, expect: 'clean', scored: true, falsePositives: perRun.reduce((n, x) => n + x, 0),
      runs: runs.length, falsePositivesPerRun: perRun,
    };
  });
  const buggy = rows.filter((r) => r.expect === 'buggy' && r.scored);
  const clean = rows.filter((r) => r.expect === 'clean' && r.scored);
  const buggyRuns = buggy.reduce((n, r) => n + (r.runs || 1), 0);
  const cleanRuns = clean.reduce((n, r) => n + (r.runs || 1), 0);
  const falsePositives = clean.reduce((n, r) => n + r.falsePositives, 0);
  const out = {
    recall: buggyRuns === 0 ? null : buggy.reduce((n, r) => n + (r.runs ? r.hits : Number(r.hit)), 0) / buggyRuns,
    buggyScored: buggy.length,
    falsePositives,
    cleanScored: clean.length,
    unscored: rows.filter((r) => !r.scored).map((r) => r.key),
    rows,
  };
  if (rows.some((r) => r.runs)) {
    Object.assign(out, {
      buggyRuns, cleanRuns, falsePositivesPerCleanRun: cleanRuns === 0 ? null : falsePositives / cleanRuns,
    });
  }
  return out;
}

function main(argv) {
  const flag = (n) => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };
  if (argv.includes('--defects')) {
    const manifestPath = flag('manifest'), resultsPath = flag('results'), adjudicationPath = flag('adjudication');
    if (!manifestPath || !resultsPath || !adjudicationPath || [manifestPath, resultsPath, adjudicationPath].some(value => value.startsWith('--'))) {
      console.error('usage: eval-runner.mjs --defects --manifest <manifest.json> --results <defect-runs.json> --adjudication <adjudication.json> [--json]');
      process.exitCode = 2; return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const adjudication = JSON.parse(readFileSync(adjudicationPath, 'utf8'));
    const evaluations = Array.isArray(results.runs) ? results.runs.map(run => {
      const matches = Array.isArray(adjudication.evaluations)
        ? adjudication.evaluations.filter(item => item?.runId === run?.runId) : [];
      const bytes = typeof run?.findingsBytes === 'string' ? Buffer.from(run.findingsBytes, 'utf8') : Buffer.alloc(0);
      let findings = null;
      try { findings = JSON.parse(bytes.toString('utf8')); } catch { /* scorer marks malformed evidence unavailable */ }
      return { run: { ...run, findings }, adjudication: matches.length === 1 ? matches[0] : null,
        findingsSha256: createHash('sha256').update(bytes).digest('hex') };
    }) : [];
    const out = scoreDefectCorpus(manifest, evaluations);
    if (argv.includes('--json')) console.log(JSON.stringify(out));
    else {
      const pct = value => value === null ? 'n/a' : `${Math.round(value * 100)}%`;
      console.log(`defect evaluation ${out.available ? 'complete' : 'unavailable'}: recall ${pct(out.recall)}, precision ${pct(out.precision)}, false alarms ${out.falseAlarms}, unresolved ${out.unresolved}, distinct cases ${out.distinctCases}`);
    }
    if (!out.coverageComplete || !out.available) process.exitCode = 1;
    return;
  }
  console.error('legacy heuristic mode: location-only scoring; use --defects for adjudicated scoring');
  const results = flag('results');
  const archiveIndex = argv.indexOf('--archive');
  const archive = archiveIndex === -1 ? null : argv[archiveIndex + 1];
  const resultsIndex = argv.indexOf('--results');
  if (!flag('manifest') || (archiveIndex !== -1 && (!archive || archive.startsWith('--')))
      || (resultsIndex !== -1 && (!results || results.startsWith('--')))
      || Boolean(results) === Boolean(archive)) {
    console.error('usage: eval-runner.mjs --manifest <manifest.json> (--results <results.json> | --archive <runs-dir>) [--json]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(flag('manifest'), 'utf8'));
  const source = archive
    ? archivedResults(validateArchiveRunIds(validateManifest(manifest)), archive)
    : { results: JSON.parse(readFileSync(results, 'utf8')), reasons: null };
  const out = score(manifest, source.results);
  if (source.reasons) out.unscoredReasons = source.reasons;
  if (argv.includes('--json')) { console.log(JSON.stringify(out)); return; }
  for (const { key, reason } of source.reasons || []) console.error(`unscored ${key}: ${reason}`);
  const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  if (out.buggyRuns === undefined) {
    console.log(`recall ${pct(out.recall)} (${out.buggyScored} buggy scored), false positives ${out.falsePositives} (${out.cleanScored} clean scored), unscored ${out.unscored.length}`);
    return;
  }
  const perRun = out.falsePositivesPerCleanRun === null ? 'n/a' : out.falsePositivesPerCleanRun.toFixed(2);
  console.log(`recall ${pct(out.recall)} per run (${out.buggyRuns} runs over ${out.buggyScored} buggy cases), false positives ${out.falsePositives} (${out.cleanRuns} runs over ${out.cleanScored} clean cases, ${perRun} per run), unscored ${out.unscored.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
