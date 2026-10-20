#!/usr/bin/env node
// First-run setup and dependency upkeep for lekker-review.
//
// Required tools are only checked, never installed: a review cannot run
// without them, and installing git or node behind someone's back is not this
// skill's call. Optional tools are offered once, on the first run, and the
// answer is remembered. A tool the user skipped is never offered again until
// `reset`.
//
// The upstream version check needs the network, so it runs on a cadence
// (default 7 days) and not on every review. The ledger records when it last
// ran and what it found.
//
// Usage:
//   node deps.mjs check [--force] [--unattended]   fast presence check; full version check when due
//   node deps.mjs init  [--install a,b] [--skip c] [--auto-update on|off] [--cadence-days N]
//   node deps.mjs install <tool>
//   node deps.mjs update  [tool]                   upgrade outdated opted-in tools, resync revmux prompts
//   node deps.mjs skip    <tool>
//   node deps.mjs reset                            forget every choice; the next check is a first run
//
// Ledger: ${LEKKER_STATE_DIR:-~/.local/state/lekker-review}/deps.json
// Every command prints one JSON object on stdout. Exit 0 unless the command
// itself failed; a missing required tool is reported as `state`, not an exit.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = process.env.LEKKER_STATE_DIR || join(homedir(), '.local', 'state', 'lekker-review');
const LEDGER = join(STATE_DIR, 'deps.json');
const DAY_MS = 86400000;
// A failed upstream lookup is retried, not recorded as "up to date". This keeps
// a flaky network from re-running the lookup on every single review.
const RETRY_AFTER_MS = 6 * 3600000;

const REQUIRED = ['git', 'gh', 'node', 'npx', 'jq', 'python3'];

// `usedBy` is shown in the first-run question, so the user knows what each
// tool buys before agreeing to install it.
const OPTIONAL = {
  revmux: {
    usedBy: '--engine revmux (alternative review engine)',
    versionCmd: ['revmux', ['--version']],
    repo: 'umputun/revmux',
    brew: ['install', '--cask', 'umputun/apps/revmux'],
    brewUpgrade: ['upgrade', '--cask', 'umputun/apps/revmux'],
    postInstall: ['bash', [join(SKILL_DIR, 'scripts', 'install-revmux-prompts.sh')]],
  },
  icm: {
    usedBy: 'pattern memory: Track B recall and Step 5 housekeeping',
    versionCmd: ['icm', ['--version']],
    repo: 'rtk-ai/icm',
    brew: ['install', 'rtk-ai/tap/icm'],
    brewUpgrade: ['upgrade', 'rtk-ai/tap/icm'],
  },
};

const argv = process.argv.slice(2);
const cmd = argv[0] || 'check';

function flag(name, fallback = null) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
}
const has = (name) => argv.includes('--' + name);

function run(bin, args, timeout = 15000) {
  try {
    return { ok: true, out: execFileSync(bin, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message).trim().split('\n').slice(-3).join(' ') };
  }
}

const onPath = (bin) => run('/bin/sh', ['-c', `command -v ${bin}`]).ok;
const semver = (text) => (String(text).match(/(\d+)\.(\d+)\.(\d+)/) || [])[0] || null;

function newer(latest, installed) {
  if (!latest || !installed) return false;
  const a = latest.split('.').map(Number);
  const b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// brew is looked up explicitly: the agent's shell PATH often lacks it, and MDM
// has deleted the /opt/homebrew/bin/brew symlink on this fleet before.
function findBrew() {
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew']) {
    if (existsSync(p)) return p;
  }
  return onPath('brew') ? 'brew' : null;
}

function loadLedger() {
  if (!existsSync(LEDGER)) return null;
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8'));
  } catch {
    return null;
  }
}

function saveLedger(ledger) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = LEDGER + '.tmp';
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(tmp, LEDGER);
}

function blankLedger() {
  return { schema: 1, initialisedAt: null, cadenceDays: 7, autoUpdate: false, checkedAt: null, lastAttemptAt: null, tools: {} };
}

function installedVersion(name) {
  const [bin, args] = OPTIONAL[name].versionCmd;
  if (!onPath(bin)) return null;
  const r = run(bin, args);
  return r.ok ? semver(r.out) : null;
}

function latestVersion(name) {
  const r = run('gh', ['release', 'view', '-R', OPTIONAL[name].repo, '--json', 'tagName', '-q', '.tagName']);
  return r.ok ? semver(r.out) : null;
}

function requiredMissing() {
  return REQUIRED.filter((bin) => !onPath(bin));
}

function presence(ledger) {
  const out = {};
  for (const [name, entry] of Object.entries(ledger.tools)) {
    if (entry.choice !== 'installed') continue;
    out[name] = onPath(OPTIONAL[name].versionCmd[0]) ? 'present' : 'missing';
  }
  return out;
}

// The network half of `check`. Updates the ledger in place.
function fullCheck(ledger, now) {
  ledger.lastAttemptAt = new Date(now).toISOString();
  let allResolved = true;
  for (const [name, entry] of Object.entries(ledger.tools)) {
    if (entry.choice !== 'installed') continue;
    entry.version = installedVersion(name);
    const latest = latestVersion(name);
    if (latest) entry.latest = latest;
    else allResolved = false;
    entry.outdated = newer(entry.latest, entry.version);
  }
  if (allResolved) ledger.checkedAt = ledger.lastAttemptAt;
  if (existsSync(join(SKILL_DIR, 'scripts', 'install-revmux-prompts.sh')) && ledger.tools.revmux?.choice === 'installed') {
    const r = run('bash', [join(SKILL_DIR, 'scripts', 'install-revmux-prompts.sh'), '--check']);
    ledger.tools.revmux.promptsInSync = r.ok;
  }
  return allResolved;
}

function isDue(ledger, now) {
  const age = (iso) => (iso ? now - Date.parse(iso) : Infinity);
  return age(ledger.checkedAt) > ledger.cadenceDays * DAY_MS && age(ledger.lastAttemptAt) > RETRY_AFTER_MS;
}

function brewRun(args) {
  const brew = findBrew();
  if (!brew) return { status: 'manual', reason: 'brew not found', command: `brew ${args.join(' ')}` };
  const r = run(brew, args, 300000);
  return r.ok ? { status: 'ok' } : { status: 'failed', command: `brew ${args.join(' ')}`, tail: r.out };
}

function postInstall(name) {
  const p = OPTIONAL[name].postInstall;
  if (!p) return null;
  const r = run(p[0], p[1], 60000);
  return r.ok ? 'ok' : `failed: ${r.out}`;
}

function install(ledger, name) {
  const res = brewRun(OPTIONAL[name].brew);
  const version = installedVersion(name);
  // brew can fail with "already installed": the binary on PATH is the truth.
  if (version) {
    ledger.tools[name] = { ...ledger.tools[name], choice: 'installed', version, decidedAt: new Date().toISOString() };
    return { tool: name, status: 'ok', version, postInstall: postInstall(name) };
  }
  ledger.tools[name] = { ...ledger.tools[name], choice: 'installed', version: null, decidedAt: new Date().toISOString() };
  return { tool: name, ...res };
}

function update(ledger, names) {
  const results = [];
  for (const name of names) {
    const entry = ledger.tools[name];
    if (!entry || entry.choice !== 'installed') continue;
    const before = installedVersion(name);
    const res = before ? brewRun(OPTIONAL[name].brewUpgrade) : brewRun(OPTIONAL[name].brew);
    const after = installedVersion(name);
    entry.version = after;
    entry.outdated = newer(entry.latest, after);
    // Resync even when brew could not run: the prompts follow the skill, not the binary.
    const post = after ? postInstall(name) : null;
    if (name === 'revmux' && post) entry.promptsInSync = post === 'ok';
    results.push({ tool: name, before, after, ...res, postInstall: post });
  }
  return results;
}

function unknownTool(name) {
  if (OPTIONAL[name]) return false;
  console.log(JSON.stringify({ error: `unknown tool "${name}"`, known: Object.keys(OPTIONAL) }));
  process.exitCode = 2;
  return true;
}

const now = Date.now();
let ledger = loadLedger();

if (cmd === 'check') {
  const missing = requiredMissing();
  if (missing.length) {
    console.log(JSON.stringify({ state: 'missing-required', missing }));
  } else if (!ledger?.initialisedAt) {
    const offer = Object.entries(OPTIONAL).map(([name, t]) => ({ tool: name, usedBy: t.usedBy, present: onPath(t.versionCmd[0]) }));
    console.log(JSON.stringify({ state: 'first-run', offer }));
  } else {
    const due = has('force') || isDue(ledger, now);
    if (due) fullCheck(ledger, now);
    const outdated = Object.entries(ledger.tools).filter(([, e]) => e.choice === 'installed' && e.outdated).map(([n, e]) => ({ tool: n, version: e.version, latest: e.latest }));
    let updated = null;
    // Unattended runs only report: upgrading a binary is a machine change.
    if (due && outdated.length && ledger.autoUpdate && !has('unattended')) {
      updated = update(ledger, outdated.map((o) => o.tool));
    }
    if (due) saveLedger(ledger);
    console.log(JSON.stringify({
      state: due ? 'checked' : 'fresh',
      checkedAt: ledger.checkedAt,
      nextCheckAfter: ledger.checkedAt ? new Date(Date.parse(ledger.checkedAt) + ledger.cadenceDays * DAY_MS).toISOString() : null,
      presence: presence(ledger),
      outdated,
      updated,
      revmuxPromptsInSync: ledger.tools.revmux?.promptsInSync ?? null,
      skipped: Object.entries(ledger.tools).filter(([, e]) => e.choice === 'skipped').map(([n]) => n),
      // Tools added to the registry after the first run: offer these once.
      undecided: Object.keys(OPTIONAL).filter((n) => !ledger.tools[n]).map((n) => ({ tool: n, usedBy: OPTIONAL[n].usedBy })),
    }));
  }
} else if (cmd === 'init') {
  ledger = ledger || blankLedger();
  const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
  const auto = flag('auto-update');
  if (auto) ledger.autoUpdate = auto === 'on';
  const cadence = Number(flag('cadence-days'));
  if (cadence > 0) ledger.cadenceDays = cadence;
  const results = [];
  for (const name of list(flag('skip'))) {
    if (unknownTool(name)) break;
    ledger.tools[name] = { choice: 'skipped', decidedAt: new Date().toISOString() };
    results.push({ tool: name, status: 'skipped' });
  }
  for (const name of list(flag('install'))) {
    if (unknownTool(name)) break;
    results.push(install(ledger, name));
  }
  // Answering the offer covers every tool in it: one not picked counts as
  // skipped, so the question is never asked twice.
  for (const name of Object.keys(OPTIONAL)) {
    if (!ledger.tools[name]) ledger.tools[name] = { choice: 'skipped', decidedAt: new Date().toISOString() };
  }
  ledger.initialisedAt = ledger.initialisedAt || new Date(now).toISOString();
  fullCheck(ledger, now);
  saveLedger(ledger);
  console.log(JSON.stringify({ state: 'initialised', ledger: LEDGER, autoUpdate: ledger.autoUpdate, cadenceDays: ledger.cadenceDays, results }));
} else if (cmd === 'install' || cmd === 'skip') {
  const name = argv[1];
  if (!unknownTool(name)) {
    ledger = ledger || blankLedger();
    const result = cmd === 'install'
      ? install(ledger, name)
      : ((ledger.tools[name] = { choice: 'skipped', decidedAt: new Date().toISOString() }), { tool: name, status: 'skipped' });
    saveLedger(ledger);
    console.log(JSON.stringify(result));
  }
} else if (cmd === 'update') {
  if (!ledger) {
    console.log(JSON.stringify({ state: 'first-run', hint: 'run init first' }));
  } else {
    fullCheck(ledger, now);
    const names = argv[1] ? [argv[1]] : Object.entries(ledger.tools).filter(([, e]) => e.choice === 'installed' && e.outdated).map(([n]) => n);
    const results = update(ledger, names);
    saveLedger(ledger);
    console.log(JSON.stringify({ state: 'updated', results }));
  }
} else if (cmd === 'reset') {
  saveLedger(blankLedger());
  console.log(JSON.stringify({ state: 'reset', ledger: LEDGER }));
} else {
  console.log(JSON.stringify({ error: `unknown command "${cmd}"` }));
  process.exitCode = 2;
}
