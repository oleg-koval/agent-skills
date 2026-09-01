#!/usr/bin/env node
// mine-transcripts: extract operator-axis metrics from local Claude Code transcripts.
//
// Ships beside agent-ops-retro because a rule without its runnable half gets re-derived.
// Every filter here exists because a previous run got it wrong:
//   - records are selected by their own .timestamp, never by file mtime (a resumed session
//     rewrites old files and drags pre-window turns into the window)
//   - a `user` record is not a human turn; tool_results, system-reminders, command preambles,
//     task notifications and bash echoes are stripped, and they were 45% of the raw count
//   - sidechain and subagent records are counted separately, never folded into session counts
//
//   node mine-transcripts.mjs --since 2026-08-18 --until 2026-09-02 --out ./mine.json
//
// Writes <out> and <out minus .json>-turns.json. Prints a summary to stdout.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const ROOT = arg('root', path.join(process.env.HOME, '.claude', 'projects'));
const OUT = arg('out', './mine.json');
const SINCE = Date.parse(`${arg('since', '')}T00:00:00Z`);
const UNTIL = Date.parse(`${arg('until', '')}T00:00:00Z`);

if (!Number.isFinite(SINCE) || !Number.isFinite(UNTIL)) {
  console.error('usage: mine-transcripts.mjs --since YYYY-MM-DD --until YYYY-MM-DD [--out path] [--root dir]');
  process.exit(2);
}
if (!fs.existsSync(ROOT)) {
  console.error(`transcript root not found: ${ROOT}. This is a state, not a success: stop here.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// A user-role text record that is really harness output, not something a person typed.
const HARNESS = /^(<system-reminder|<command-name|<command-message|<local-command|<bash-input|<bash-stdout|<user-prompt-submit-hook|<task-notification|Caveat: The messages below|\[Request interrupted)/;

const textOf = (msg) => {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return '';
};

const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

const S = {
  sessions: new Map(),
  tools: new Map(),
  agents: new Map(),
  skills: new Map(),
  models: new Map(),
  errorsByTool: new Map(),
  errorKinds: new Map(),
  limits: [],
  humanTurns: [],
  echoTurns: 0,
  interrupts: 0,
  compacts: 0,
  usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
};

function classifyError(text) {
  const t = text.slice(0, 400);
  if (/haven't granted it yet|Permission to use|requires approval/i.test(t)) return 'permission-not-granted';
  if (/auto mode classifier/i.test(t)) return 'auto-mode-classifier';
  if (/isolated in the worktree|stays inside worktree/i.test(t)) return 'worktree-isolation';
  if (/Delegation rule/i.test(t)) return 'delegation-rule';
  if (/does not match required schema/i.test(t)) return 'agent-schema-miss';
  if (/File does not exist|no such file/i.test(t)) return 'file-not-found';
  if (/has not been read yet/i.test(t)) return 'read-before-write';
  if (/String to replace not found|not found in file/i.test(t)) return 'edit-string-not-found';
  if (/timed out|timeout/i.test(t)) return 'timeout';
  if (/\b(40[0-9]|41[0-9]|429)\b.*error|HTTP 4\d\d/i.test(t)) return 'api-4xx';
  if (/\b(50[0-9]|529)\b.*error|HTTP 5\d\d/i.test(t)) return 'api-5xx';
  if (/command not found/i.test(t)) return 'command-not-found';
  if (/Exit code [1-9]/i.test(t)) return 'non-zero-exit';
  return 'other';
}

const files = walk(ROOT);
let inWindow = 0;

for (const f of files) {
  const isSub = f.includes(`${path.sep}subagents${path.sep}`);
  const project = path.relative(ROOT, f).split(path.sep)[0];
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.startsWith('{')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }

    const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < SINCE || ts >= UNTIL) continue;
    inWindow++;

    const main = !isSub && !r.isSidechain;
    const sid = r.sessionId || path.basename(f, '.jsonl');
    let sess = null;
    if (main) {
      if (!S.sessions.has(sid)) {
        S.sessions.set(sid, { project, first: ts, last: ts, human: 0, assistant: 0, tools: 0, agents: 0, errors: 0, interrupts: 0, peakContext: 0 });
      }
      sess = S.sessions.get(sid);
      sess.first = Math.min(sess.first, ts);
      sess.last = Math.max(sess.last, ts);
    }

    if (r.isCompactSummary || r.subtype === 'compact_boundary') S.compacts++;

    // Capacity and API-failure notices are synthetic records and are NOT always type "assistant",
    // so this check sits outside the assistant branch. Gating it on the type reported zero for a
    // window that really held five weekly-limit hits.
    if (r.message?.model === '<synthetic>') {
      const t = textOf(r.message);
      if (/weekly limit|spend limit|rate limit|usage limit/i.test(t)) {
        S.limits.push({ ts: r.timestamp, text: t.slice(0, 90) });
      }
    }

    if (r.type === 'assistant') {
      const model = r.message?.model;
      if (model) bump(S.models, model);
      const u = r.message?.usage;
      if (u) {
        S.usage.in += u.input_tokens || 0;
        S.usage.out += u.output_tokens || 0;
        S.usage.cacheRead += u.cache_read_input_tokens || 0;
        S.usage.cacheWrite += u.cache_creation_input_tokens || 0;
        if (sess) {
          const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          sess.peakContext = Math.max(sess.peakContext, ctx);
        }
      }
      if (sess) sess.assistant++;
      for (const b of Array.isArray(r.message?.content) ? r.message.content : []) {
        if (b.type !== 'tool_use') continue;
        bump(S.tools, b.name);
        if (sess) sess.tools++;
        if (b.name === 'Agent') {
          bump(S.agents, `${b.input?.subagent_type || '(none)'} | ${b.input?.model || '(inherit)'}`);
          if (sess) sess.agents++;
        }
        if (b.name === 'Skill') bump(S.skills, b.input?.skill || '(unnamed)');
      }
    }

    if (r.type !== 'user') continue;

    const blocks = Array.isArray(r.message?.content) ? r.message.content : [];
    let sawToolResult = false;
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue;
      sawToolResult = true;
      if (!b.is_error) continue;
      const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
      bump(S.errorKinds, classifyError(body));
      bump(S.errorsByTool, b.tool_use_id ? 'attributed' : 'unattributed');
      if (sess) sess.errors++;
    }

    const raw = textOf(r.message);
    if (raw.includes('[Request interrupted')) {
      S.interrupts++;
      if (sess) sess.interrupts++;
    }
    if (!main || r.userType !== 'external' || !raw || sawToolResult) continue;

    const clean = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!clean) continue;
    if (HARNESS.test(clean)) { S.echoTurns++; continue; }

    if (sess) sess.human++;
    S.humanTurns.push({ ts: r.timestamp, session: sid, project, text: clean.slice(0, 600) });
  }
}

const sessions = [...S.sessions].map(([id, v]) => ({
  id: id.slice(0, 8), ...v, minutes: Math.round((v.last - v.first) / 60000),
})).sort((a, b) => b.human - a.human);

const humanCounts = sessions.map((s) => s.human).filter((n) => n > 0).sort((a, b) => a - b);
const pct = (p) => humanCounts[Math.floor((humanCounts.length - 1) * p)] ?? 0;
const byDay = {};
for (const t of S.humanTurns) {
  const d = t.ts.slice(0, 10);
  byDay[d] = (byDay[d] || 0) + 1;
}

const report = {
  window: { since: new Date(SINCE).toISOString(), until: new Date(UNTIL).toISOString() },
  filesScanned: files.length,
  recordsInWindow: inWindow,
  mainSessions: S.sessions.size,
  humanTurnsOrganic: S.humanTurns.length,
  humanTurnsEchoesExcluded: S.echoTurns,
  humanTurnsPerDay: byDay,
  turnsPerSession: { median: pct(0.5), p90: pct(0.9), max: humanCounts.at(-1) ?? 0 },
  shortTurnsUnder40Chars: S.humanTurns.filter((t) => t.text.trim().length < 40).length,
  interrupts: S.interrupts,
  compactEvents: S.compacts,
  capacityLimitEvents: S.limits.length,
  capacityLimitSamples: S.limits.slice(0, 10),
  usage: S.usage,
  cacheReadToOutputRatio: S.usage.out ? +(S.usage.cacheRead / S.usage.out).toFixed(1) : null,
  models: [...S.models].sort((a, b) => b[1] - a[1]),
  topTools: [...S.tools].sort((a, b) => b[1] - a[1]).slice(0, 40),
  agentSpawns: [...S.agents].sort((a, b) => b[1] - a[1]),
  skillInvocations: [...S.skills].sort((a, b) => b[1] - a[1]),
  errorKinds: [...S.errorKinds].sort((a, b) => b[1] - a[1]),
  sessions,
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
fs.writeFileSync(OUT.replace(/\.json$/, '') + '-turns.json', JSON.stringify(S.humanTurns, null, 1));

console.log(JSON.stringify({
  ...report,
  capacityLimitSamples: report.capacityLimitSamples.length,
  sessions: report.sessions.length,
}, null, 1));
console.error(`\nwrote ${OUT} and ${OUT.replace(/\.json$/, '')}-turns.json`);
console.error(`organic human turns ${report.humanTurnsOrganic}, harness echoes excluded ${report.humanTurnsEchoesExcluded}`);
