#!/usr/bin/env node
// Score lekker findings against a manifest of PRs with known outcomes.
//
// Usage:
//   node eval-runner.mjs --manifest evals/manifest.json --results <results.json> [--json]
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
import { fileURLToPath } from 'node:url';

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
  if (!flag('manifest') || !flag('results')) {
    console.error('usage: eval-runner.mjs --manifest <manifest.json> --results <results.json> [--json]');
    process.exit(2);
  }
  const out = score(JSON.parse(readFileSync(flag('manifest'), 'utf8')), JSON.parse(readFileSync(flag('results'), 'utf8')));
  if (argv.includes('--json')) { console.log(JSON.stringify(out)); return; }
  const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
  if (out.buggyRuns === undefined) {
    console.log(`recall ${pct(out.recall)} (${out.buggyScored} buggy scored), false positives ${out.falsePositives} (${out.cleanScored} clean scored), unscored ${out.unscored.length}`);
    return;
  }
  const perRun = out.falsePositivesPerCleanRun === null ? 'n/a' : out.falsePositivesPerCleanRun.toFixed(2);
  console.log(`recall ${pct(out.recall)} per run (${out.buggyRuns} runs over ${out.buggyScored} buggy cases), false positives ${out.falsePositives} (${out.cleanRuns} runs over ${out.cleanScored} clean cases, ${perRun} per run), unscored ${out.unscored.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
