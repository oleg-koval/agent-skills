#!/usr/bin/env node
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const unavailable = (agentPath, reason) => ({ agentPath, status: 'unavailable', reason });

async function inspectSession(sessionFile, parentThreadId, agentPath) {
  let sessionId = null, usage = null, complete = false, models = [];
  try {
    const input = createReadStream(sessionFile);
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { return unavailable(agentPath, 'malformed JSONL'); }
      if (row.type === 'session_meta') {
        const spawn = row.payload?.source?.subagent?.thread_spawn;
        if (sessionId || typeof row.payload?.id !== 'string' || !row.payload.id) return unavailable(agentPath, 'session metadata missing or duplicated');
        if (spawn?.parent_thread_id !== parentThreadId || spawn?.agent_path !== agentPath) return unavailable(agentPath, 'parent thread or agent path mismatch');
        sessionId = row.payload.id;
      } else if (row.type === 'turn_context' && typeof row.payload?.model === 'string' && row.payload.model && !models.includes(row.payload.model)) {
        models = [...models, row.payload.model];
      } else if (row.type === 'event_msg' && row.payload?.type === 'task_started') complete = false;
      else if (row.type === 'event_msg' && row.payload?.type === 'task_complete') complete = true;
      else if (row.type === 'event_msg' && row.payload?.type === 'token_count') {
        const raw = row.payload.info?.total_token_usage;
        if (!record(raw) || FIELDS.some(k => !Number.isSafeInteger(raw[k]) || raw[k] < 0)) return unavailable(agentPath, 'token counters are malformed');
        const next = Object.fromEntries(FIELDS.map(k => [k, raw[k]]));
        if (usage && FIELDS.some(k => next[k] < usage[k])) return unavailable(agentPath, 'token counters decreased');
        usage = next;
      }
    }
  } catch { return unavailable(agentPath, 'session file could not be read'); }
  if (!sessionId) return unavailable(agentPath, 'session metadata unavailable');
  if (!complete) return unavailable(agentPath, 'task completion unavailable');
  if (!usage) return unavailable(agentPath, 'token counters unavailable');
  return { agentPath, status: 'available', sessionId, models, usage };
}

export async function collectUsage(manifest) {
  if (!record(manifest) || typeof manifest.parentThreadId !== 'string' || !manifest.parentThreadId
      || !Array.isArray(manifest.agents) || !manifest.agents.length
      || manifest.agents.some(a => !record(a) || typeof a.agentPath !== 'string' || !a.agentPath || typeof a.sessionFile !== 'string' || !a.sessionFile)) {
    return { available: false, agents: [], totals: null, reason: 'manifest needs parentThreadId and explicit agentPath/sessionFile entries' };
  }
  const paths = manifest.agents.map(a => a.agentPath), files = manifest.agents.map(a => a.sessionFile);
  if (paths.some((p, i) => paths.indexOf(p) !== i) || files.some((p, i) => files.indexOf(p) !== i)) {
    return { available: false, agents: [], totals: null, reason: 'manifest repeats an agent path or session file' };
  }
  let agents = [];
  for (const agent of manifest.agents) agents = [...agents, await inspectSession(agent.sessionFile, manifest.parentThreadId, agent.agentPath)];
  const available = agents.every(a => a.status !== 'unavailable');
  const totals = available ? Object.fromEntries(FIELDS.map(k => [k, agents.reduce((n, a) => n + a.usage[k], 0)])) : null;
  const safe = totals && FIELDS.every(k => Number.isSafeInteger(totals[k]));
  return { available: Boolean(safe), agents, totals: safe ? totals : null, ...(available && !safe ? { reason: 'aggregate token counters exceed safe integer range' } : {}) };
}

async function main(argv) {
  const i = argv.indexOf('--manifest'), path = i < 0 ? null : argv[i + 1];
  if (!path || path.startsWith('--')) { console.error('usage: codex-usage.mjs --manifest <explicit-sessions.json>'); process.exitCode = 2; return; }
  let result;
  try { result = await collectUsage(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { result = { available: false, agents: [], totals: null, reason: 'manifest could not be read' }; process.exitCode = 2; }
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
