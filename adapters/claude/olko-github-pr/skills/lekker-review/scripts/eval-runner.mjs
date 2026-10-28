#!/usr/bin/env node
// Score lekker findings against a manifest of PRs with known outcomes.
//
// Usage:
//   node eval-runner.mjs --manifest evals/manifest.json --results <results.json> [--json]
//
// manifest.json: { prs: [{ repo, pr, expect: "buggy"|"clean", knownBug?: "file:line + description" }] }
// results.json:  { "<repo>#<pr>": [ <finding>, ... ] }  the findings of one lekker run per PR
//                (the `findings` array the workflow returns). A PR missing from results is
//                reported as unscored, never as zero findings.
//
// A buggy PR is HIT when some finding is on the knownBug file within LINE_WINDOW lines
// of the knownBug line. Known limitation: the match is by location only, so a
// same-file finding near the line counts even if it describes a different problem;
// judging "same bug" needs an LLM or a description match and is not attempted. Recall = hits / scored buggy PRs. On a clean PR every
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

export function validateManifest(manifest) {
  const prs = manifest && Array.isArray(manifest.prs) ? manifest.prs : null;
  if (!prs) throw new Error('manifest needs a "prs" array');
  const seen = new Set();
  prs.forEach((e, i) => {
    if (!e.repo || !Number.isInteger(e.pr)) throw new Error(`prs[${i}]: repo and integer pr are required`);
    if (e.expect !== 'buggy' && e.expect !== 'clean') throw new Error(`prs[${i}]: expect must be "buggy" or "clean"`);
    const key = `${e.repo}#${e.pr}`;
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
    const key = `${e.repo}#${e.pr}`;
    const findings = results[key];
    if (!Array.isArray(findings)) return { key, expect: e.expect, scored: false };
    if (e.expect === 'buggy') return { key, expect: 'buggy', scored: true, hit: isHit(findings, e.knownBug) };
    return {
      key, expect: 'clean', scored: true,
      falsePositives: findings.filter((f) => BLOCKING.has(f.severity)).length,
    };
  });
  const buggy = rows.filter((r) => r.expect === 'buggy' && r.scored);
  const clean = rows.filter((r) => r.expect === 'clean' && r.scored);
  return {
    recall: buggy.length === 0 ? null : buggy.filter((r) => r.hit).length / buggy.length,
    buggyScored: buggy.length,
    falsePositives: clean.reduce((n, r) => n + r.falsePositives, 0),
    cleanScored: clean.length,
    unscored: rows.filter((r) => !r.scored).map((r) => r.key),
    rows,
  };
}

function main(argv) {
  const flag = (n) => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };
  if (!flag('manifest') || !flag('results')) {
    console.error('usage: eval-runner.mjs --manifest <manifest.json> --results <results.json> [--json]');
    process.exit(2);
  }
  const out = score(JSON.parse(readFileSync(flag('manifest'), 'utf8')), JSON.parse(readFileSync(flag('results'), 'utf8')));
  if (argv.includes('--json')) { console.log(JSON.stringify(out)); return; }
  const pct = out.recall === null ? 'n/a' : `${Math.round(out.recall * 100)}%`;
  console.log(`recall ${pct} (${out.buggyScored} buggy scored), false positives ${out.falsePositives} (${out.cleanScored} clean scored), unscored ${out.unscored.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
