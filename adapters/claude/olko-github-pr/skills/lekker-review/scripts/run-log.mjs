#!/usr/bin/env node
// Run ledger for lekker-review: one row per review run, plus a small archive of
// the run's own files, so past runs can be measured and compared.
//
// Before this, the evidence of a run was split across four places that nothing
// joined: the review markdown, the scratchpad (deleted with the session), the
// Workflow tool's own record under ~/.claude/projects (owned by Claude Code and
// cleaned with old sessions), and the revmux task archive.
//
// Usage:
//   node run-log.mjs start  --repo <slug> --target <pr-N|branch-x> --mode pr|branch \
//                           --depth <d> --engine workflow|revmux [--fix] [--host claude]
//   node run-log.mjs mark   <runId> <phase> [--note <text>]
//   node run-log.mjs attach <runId> <file>...
//   node run-log.mjs finish <runId> --status ok|failed|aborted [--verdict lgtm|lgtm-with-changes|needs-work]
//                           [--review-file <path>] [--artifact-url <url>] [--wf <wf_id>]... [--note <text>]
//   node run-log.mjs report [--days 30] [--json]
//   node run-log.mjs backfill        import past Workflow-tool records and revmux rounds
//   node run-log.mjs prune [--keep-days 90]
//
// Layout under ${LEKKER_STATE_DIR:-~/.local/state/lekker-review}:
//   runs.jsonl                one row per finish; `report` keeps the LAST row per runId
//   runs/<runId>/run.json     the same row, with the timeline
//   runs/<runId>/timeline.jsonl
//   runs/<runId>/<attached files>
//
// `finish` may be called more than once for one run (after the review, again
// after fix mode); every call appends a fresh row and the newest one wins.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const STATE_DIR = process.env.LEKKER_STATE_DIR || join(homedir(), '.local', 'state', 'lekker-review');
const RUNS_DIR = join(STATE_DIR, 'runs');
const LEDGER = join(STATE_DIR, 'runs.jsonl');
const PROJECTS_DIR = process.env.LEKKER_CLAUDE_PROJECTS || join(homedir(), '.claude', 'projects');
const REVMUX_TASKS = process.env.LEKKER_REVMUX_TASKS_DIR || join(homedir(), 'code-reviews', 'revmux-tasks');

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, fallback = null) {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
}
function flags(name) {
  const out = [];
  argv.forEach((a, i) => { if (a === '--' + name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}
const has = (name) => argv.includes('--' + name);

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean) : []);

function runDir(runId) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId || '')) fail(`bad runId "${runId}"`);
  return join(RUNS_DIR, runId);
}

function fail(msg) {
  console.log(JSON.stringify({ error: msg }));
  process.exit(2);
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The Workflow tool keeps its own record of every run (duration, total tokens,
// agent count, the returned result). Copying the numbers out at finish time is
// what keeps them once Claude Code cleans up the session directory.
function findWorkflowRecord(wfId) {
  if (!existsSync(PROJECTS_DIR)) return null;
  for (const project of readdirSync(PROJECTS_DIR)) {
    const projectDir = join(PROJECTS_DIR, project);
    let sessions;
    try { sessions = readdirSync(projectDir); } catch { continue; }
    for (const session of sessions) {
      const p = join(projectDir, session, 'workflows', `${wfId}.json`);
      if (existsSync(p)) return readJson(p);
    }
  }
  return null;
}

function summariseWorkflow(rec) {
  const result = rec?.result && typeof rec.result === 'object' ? rec.result : {};
  return {
    wfId: rec?.runId ?? null,
    name: rec?.workflowName ?? null,
    status: rec?.status ?? null,
    durationS: rec?.durationMs != null ? Math.round(rec.durationMs / 1000) : null,
    totalTokens: rec?.totalTokens ?? null,
    agentCount: rec?.agentCount ?? null,
    toolCalls: rec?.totalToolCalls ?? null,
    outputTokens: result.outputTokens ?? null,
    found: Array.isArray(result.findings) ? result.findings.length : null,
    dropped: result.droppedCount ?? null,
    downgraded: result.downgradedCount ?? null,
    hardRule: result.hardRuleCount ?? null,
    proveAttempts: result.proveAttemptCount ?? null,
    proven: result.provenCount ?? null,
    sessionModel: rec?.defaultModel ?? null,
  };
}

function severityCounts(findings) {
  const list = Array.isArray(findings) ? findings : findings?.findings;
  if (!Array.isArray(list)) return null;
  const counts = { total: list.length };
  for (const f of list) counts[f.severity || 'unknown'] = (counts[f.severity || 'unknown'] || 0) + 1;
  return counts;
}

function phaseDurations(timeline) {
  const out = {};
  for (let i = 0; i < timeline.length - 1; i++) {
    const ms = Date.parse(timeline[i + 1].at) - Date.parse(timeline[i].at);
    out[timeline[i].phase] = (out[timeline[i].phase] || 0) + Math.round(ms / 1000);
  }
  return out;
}

function append(row) {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(row) + '\n');
}

function latestRows(days) {
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const byId = new Map();
  for (const row of readJsonl(LEDGER)) byId.set(row.runId, row);
  return [...byId.values()].filter((r) => Date.parse(r.startedAt || r.finishedAt) >= cutoff);
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const p90 = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(0.9 * (s.length - 1))] : null;
};
const sum = (xs) => xs.reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0);

if (cmd === 'start') {
  const repo = flag('repo');
  const target = flag('target');
  if (!repo || !target) fail('start needs --repo and --target');
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[-:]/g, '').slice(0, 15)}-${slug(repo.split('/').pop())}-${slug(target)}`;
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  const meta = {
    schema: 1, runId, startedAt, repo, target,
    mode: flag('mode', 'pr'), depth: flag('depth'), engine: flag('engine', 'workflow'),
    fix: has('fix'), host: flag('host', 'claude'),
  };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
  appendFileSync(join(dir, 'timeline.jsonl'), JSON.stringify({ phase: 'start', at: startedAt }) + '\n');
  console.log(JSON.stringify({ runId, dir }));
} else if (cmd === 'mark') {
  const [runId, phase] = [argv[1], argv[2]];
  if (!phase) fail('mark needs <runId> <phase>');
  const dir = runDir(runId);
  if (!existsSync(dir)) fail(`no run ${runId}`);
  appendFileSync(join(dir, 'timeline.jsonl'), JSON.stringify({ phase, at: new Date().toISOString(), note: flag('note') ?? undefined }) + '\n');
  console.log(JSON.stringify({ runId, phase }));
} else if (cmd === 'attach') {
  const runId = argv[1];
  const dir = runDir(runId);
  if (!existsSync(dir)) fail(`no run ${runId}`);
  const copied = [];
  const missing = [];
  for (const file of argv.slice(2)) {
    if (existsSync(file)) { copyFileSync(file, join(dir, basename(file))); copied.push(basename(file)); }
    else missing.push(file);
  }
  console.log(JSON.stringify({ runId, copied, missing }));
} else if (cmd === 'finish') {
  const runId = argv[1];
  const dir = runDir(runId);
  const meta = readJson(join(dir, 'run.json'));
  if (!meta) fail(`no run ${runId}`);
  const finishedAt = new Date().toISOString();
  const timeline = [...readJsonl(join(dir, 'timeline.jsonl')), { phase: 'finish', at: finishedAt }];
  const workflows = flags('wf').map((id) => summariseWorkflow(findWorkflowRecord(id) || { runId: id }));
  const reviewWf = workflows.find((w) => w.name === 'lekker-review-core') || null;
  const row = {
    ...meta,
    finishedAt,
    status: flag('status', 'ok'),
    verdict: flag('verdict', meta.verdict ?? null),
    wallS: Math.round((Date.parse(finishedAt) - Date.parse(meta.startedAt)) / 1000),
    phasesS: phaseDurations(timeline),
    findings: severityCounts(readJson(join(dir, 'findings.json'))),
    review: reviewWf,
    workflows,
    tokensTotal: sum(workflows.map((w) => w.totalTokens)) || null,
    reviewFile: flag('review-file', meta.reviewFile ?? null),
    artifactUrl: flag('artifact-url'),
    note: flag('note', meta.note ?? null),
  };
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...row, timeline }, null, 2) + '\n');
  append(row);
  const unresolved = workflows.filter((w) => w.durationS == null).map((w) => w.wfId);
  console.log(JSON.stringify({ runId, ledger: LEDGER, wallS: row.wallS, tokensTotal: row.tokensTotal, unresolvedWorkflows: unresolved }));
} else if (cmd === 'report') {
  const days = Number(flag('days', '30'));
  const rows = latestRows(days);
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.engine || 'workflow'}/${r.depth || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const table = [...groups.entries()].sort().map(([key, rs]) => {
    const found = sum(rs.map((r) => r.review?.found));
    const dropped = sum(rs.map((r) => r.review?.dropped));
    return {
      group: key,
      runs: rs.length,
      failed: rs.filter((r) => r.status !== 'ok').length,
      reviewMedianS: median(rs.map((r) => r.review?.durationS)),
      reviewP90S: p90(rs.map((r) => r.review?.durationS)),
      wallMedianS: median(rs.map((r) => r.wallS)),
      tokensMedianK: median(rs.map((r) => (r.tokensTotal ? Math.round(r.tokensTotal / 1000) : null))),
      agentsMedian: median(rs.map((r) => r.review?.agentCount)),
      findingsMedian: median(rs.map((r) => r.review?.found ?? r.findings?.total)),
      verifierDropRate: found + dropped ? +(dropped / (found + dropped)).toFixed(3) : null,
      proven: `${sum(rs.map((r) => r.review?.proven))}/${sum(rs.map((r) => r.review?.proveAttempts))}`,
    };
  });
  const verdicts = {};
  for (const r of rows) if (r.verdict) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
  const revmux = rows.filter((r) => r.source === 'revmux-backfill');
  // Cost medians over rounds that produced a result: a fully degraded round costs ~$0 and drags them down.
  const revmuxOk = revmux.filter((r) => r.status === 'ok');
  const out = {
    window: `${days}d`, runs: rows.length, ledger: LEDGER, table, verdicts,
    revmuxRounds: revmux.length ? {
      rounds: revmux.length,
      fullyDegraded: revmux.filter((r) => r.revmux.degraded >= r.revmux.agents && r.revmux.agents > 0).length,
      medianUsd: median(revmuxOk.map((r) => r.revmux.usd)),
      medianTokensK: median(revmuxOk.map((r) => (r.tokensTotal ? Math.round(r.tokensTotal / 1000) : null))),
      medianWallS: median(revmuxOk.map((r) => r.wallS)),
    } : null,
  };
  if (has('json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`lekker-review runs, last ${out.window}: ${out.runs} (ledger ${LEDGER})`);
    const cols = ['group', 'runs', 'failed', 'reviewMedianS', 'reviewP90S', 'tokensMedianK', 'agentsMedian', 'findingsMedian', 'verifierDropRate', 'proven'];
    console.log(cols.join('\t'));
    for (const t of table) console.log(cols.map((c) => t[c] ?? '-').join('\t'));
    if (Object.keys(verdicts).length) console.log('verdicts:', JSON.stringify(verdicts));
    if (out.revmuxRounds) console.log('revmux rounds:', JSON.stringify(out.revmuxRounds));
  }
} else if (cmd === 'backfill') {
  const known = new Set(latestRows(0).flatMap((r) => [r.runId, ...(r.workflows || []).map((w) => w.wfId)]));
  let added = 0;
  if (existsSync(PROJECTS_DIR)) {
    for (const project of readdirSync(PROJECTS_DIR)) {
      let sessions;
      try { sessions = readdirSync(join(PROJECTS_DIR, project)); } catch { continue; }
      for (const session of sessions) {
        const wfDir = join(PROJECTS_DIR, project, session, 'workflows');
        if (!existsSync(wfDir)) continue;
        for (const f of readdirSync(wfDir)) {
          if (!f.endsWith('.json')) continue;
          const rec = readJson(join(wfDir, f));
          if (!rec?.workflowName?.startsWith('lekker-review') || known.has(rec.runId)) continue;
          const args = rec.args && typeof rec.args === 'object' ? rec.args : {};
          const w = summariseWorkflow(rec);
          append({
            schema: 1, source: 'harness-backfill', runId: rec.runId, startedAt: rec.timestamp,
            repo: args.repoSlug ?? null, target: args.prNumber ? `pr-${args.prNumber}` : args.targetLabel ?? null,
            depth: rec.workflowName === 'lekker-review-fix' ? 'fix' : args.depth ?? null,
            engine: args.engine || 'workflow', status: rec.status === 'completed' ? 'ok' : 'failed',
            review: rec.workflowName === 'lekker-review-core' ? w : null, workflows: [w], tokensTotal: w.totalTokens,
          });
          known.add(rec.runId);
          added++;
        }
      }
    }
  }
  if (existsSync(REVMUX_TASKS)) {
    for (const task of readdirSync(REVMUX_TASKS)) {
      let rounds;
      try { rounds = readdirSync(join(REVMUX_TASKS, task)); } catch { continue; }
      for (const round of rounds) {
        const roundDir = join(REVMUX_TASKS, task, round);
        const events = readJsonl(join(roundDir, 'events.jsonl'));
        const runId = `revmux-${task}-${round}`;
        if (!events.length || known.has(runId)) continue;
        const started = new Set(events.filter((e) => e.kind === 'agent_started').map((e) => e.agent));
        const degraded = new Set(events.filter((e) => e.kind === 'agent_degraded').map((e) => e.agent));
        let usd = 0;
        let tokens = 0;
        const agentsDir = join(roundDir, 'agents');
        if (existsSync(agentsDir)) {
          for (const a of readdirSync(agentsDir)) {
            for (const line of readJsonl(join(agentsDir, a))) {
              if (line.type !== 'result') continue;
              usd += line.total_cost_usd || 0;
              const u = line.usage || {};
              tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
            }
          }
        }
        const times = events.map((e) => Date.parse(e.at)).filter(Number.isFinite);
        append({
          schema: 1, source: 'revmux-backfill', runId, startedAt: new Date(Math.min(...times)).toISOString(),
          target: task, engine: 'revmux', depth: 'round', status: degraded.size >= started.size && started.size ? 'failed' : 'ok',
          wallS: Math.round((Math.max(...times) - Math.min(...times)) / 1000), tokensTotal: tokens || null,
          revmux: { agents: started.size, degraded: degraded.size, usd: +usd.toFixed(2) },
        });
        known.add(runId);
        added++;
      }
    }
  }
  console.log(JSON.stringify({ added, ledger: LEDGER }));
} else if (cmd === 'prune') {
  const keepDays = Number(flag('keep-days', '90'));
  const cutoff = Date.now() - keepDays * 86400000;
  const removed = [];
  if (existsSync(RUNS_DIR)) {
    for (const id of readdirSync(RUNS_DIR)) {
      const dir = join(RUNS_DIR, id);
      // Only directories this script created: they all hold a run.json.
      if (!existsSync(join(dir, 'run.json'))) continue;
      if (statSync(dir).mtimeMs < cutoff) { rmSync(dir, { recursive: true, force: true }); removed.push(id); }
    }
  }
  console.log(JSON.stringify({ removed: removed.length, keptLedger: LEDGER }));
} else {
  fail(`unknown command "${cmd}"`);
}
