#!/usr/bin/env node
// Decide whether a worktree can run a single test file, before any prover
// agent is paid to find out.
//
// The prove phase attempted 7 proofs between 2026-08 and 2026-10 and proved
// none; 5 of the 7 provers reported the same thing: vitest is declared in
// package.json but node_modules is absent from the worktree. A prover agent is
// an expensive way to run `ls node_modules/.bin`.
//
// Usage: node test-runner.mjs <worktreePath>
// Prints {runner, dirs, reason}. `runner` is the first usable runner found
// (vitest|jest|mocha|node-test) or null; `dirs` lists every package dir with a
// usable one as {dir, runner}, relative to the worktree ("." for the root).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) {
  console.log(JSON.stringify({ runner: null, dirs: [], reason: 'no worktree' }));
  process.exit(0);
}

const RUNNERS = ['vitest', 'jest', 'mocha'];

function packageDirs(dir, depth) {
  const out = existsSync(join(dir, 'package.json')) ? [dir] : [];
  if (depth === 0) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    try { if (statSync(p).isDirectory()) out.push(...packageDirs(p, depth - 1)); } catch { /* unreadable */ }
  }
  return out;
}

function usableRunner(dir) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return { reason: 'unreadable package.json' }; }
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const testScript = String(pkg.scripts?.test ?? '');
  for (const r of RUNNERS) {
    if (!declared[r] && !testScript.includes(r)) continue;
    // existsSync follows the symlinked node_modules setup-worktree.sh creates.
    for (let binDir = resolve(dir); ; binDir = dirname(binDir)) {
      if (existsSync(join(binDir, 'node_modules', '.bin', r))) return { runner: r };
      if (binDir === resolve(root) || dirname(binDir) === binDir) break;
    }
    return { reason: `${r} declared but node_modules/.bin/${r} missing` };
  }
  if (/\bnode\b[^&|;]*--test\b/.test(testScript)) return { runner: 'node-test' };
  return { reason: 'no test runner declared' };
}

const dirs = [];
const reasons = [];
let runner = null;
for (const dir of packageDirs(root, 3)) {
  const rel = relative(root, dir) || '.';
  const r = usableRunner(dir);
  if (r.runner) {
    dirs.push({ dir: rel, runner: r.runner });
    runner ??= r.runner;
  } else {
    reasons.push(`${rel}: ${r.reason}`);
  }
}

console.log(JSON.stringify({
  runner,
  dirs,
  reason: runner ? null : (reasons.length ? reasons.join('; ') : 'no package.json'),
}));
