import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectUsage } from '../plugins/olko-github-pr/skills/lekker-review/scripts/codex-usage.mjs'

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']
const counts = n => Object.fromEntries(fields.map(k => [k, n]))
const meta = (parent = 'parent', path = 'root/a') => ({ type: 'session_meta', payload: { id: 'session-a', source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_path: path } } } } })
const event = (type, info = {}) => ({ type: 'event_msg', payload: { type, info } })
function fixture(t, rows) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-usage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'agent.jsonl')
  writeFileSync(file, rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n')
  return { dir, file, manifest: { parentThreadId: 'parent', agents: [{ agentPath: 'root/a', sessionFile: file }] } }
}

test('uses the last cumulative snapshot once and returns only usage metadata', async t => {
  const rows = [meta(), { type: 'turn_context', payload: { model: 'codex-a' } }, { type: 'turn_context', payload: { model: 'codex-a' } },
    event('token_count', { total_token_usage: counts(4) }), event('token_count', { total_token_usage: counts(4) }),
    event('token_count', { total_token_usage: counts(7) }), { type: 'event_msg', payload: { type: 'output_text', text: 'private prompt and transcript' } }, event('task_complete')]
  const { manifest } = fixture(t, rows)
  const out = await collectUsage(manifest)
  assert.equal(out.agents[0].sessionId, 'session-a')
  assert.deepEqual(out.agents[0].models, ['codex-a'])
  assert.deepEqual(out.agents[0].usage, counts(7))
  assert.deepEqual([out.available, out.totals], [true, counts(7)])
  assert.doesNotMatch(JSON.stringify(out), /private prompt|transcript|sessionFile/)
})

test('unbound, incomplete, malformed, and restarted sessions stay unavailable', async t => {
  const bad = [
    [[meta('wrong')], 'parent thread or agent path mismatch'], [[meta('parent', 'root/b')], 'parent thread or agent path mismatch'],
    [[meta(), event('token_count', { total_token_usage: counts(1) }), event('task_complete'), event('task_started')], 'task completion unavailable'],
    [[meta(), event('token_count', { total_token_usage: { ...counts(1), output_tokens: '1' } }), event('task_complete')], 'token counters are malformed'],
    [[meta(), event('token_count', { total_token_usage: counts(2) }), event('token_count', { total_token_usage: counts(0) }), event('task_complete')], 'token counters decreased'],
    [[meta(), event('token_count', { total_token_usage: counts(1) }), 'not-json', event('task_complete')], 'malformed JSONL'],
    [[meta(), event('task_complete')], 'token counters unavailable'],
  ]
  for (const [rows, reason] of bad) {
    const { manifest } = fixture(t, rows)
    const out = await collectUsage(manifest)
    assert.deepEqual([out.available, out.totals], [false, null])
    assert.equal(out.agents[0].status, 'unavailable')
    assert.equal(out.agents[0].reason, reason)
  }
  const partial = fixture(t, [meta(), event('token_count', { total_token_usage: counts(1) }), event('task_complete')])
  const failed = join(partial.dir, 'agent-b.jsonl')
  writeFileSync(failed, JSON.stringify(meta('wrong', 'root/b')))
  const out = await collectUsage({ ...partial.manifest, agents: [...partial.manifest.agents, { agentPath: 'root/b', sessionFile: failed }] })
  assert.equal(out.agents[0].status, 'available')
  assert.deepEqual([out.available, out.totals], [false, null])
  const huge = fixture(t, [meta(), event('token_count', { total_token_usage: counts(Number.MAX_SAFE_INTEGER) }), event('task_complete')])
  const fileB = join(huge.dir, 'agent-b.jsonl')
  writeFileSync(fileB, [meta('parent', 'root/b'), event('token_count', { total_token_usage: counts(1) }), event('task_complete')].map(row => JSON.stringify(row)).join('\n'))
  const overflow = await collectUsage({ ...huge.manifest, agents: [...huge.manifest.agents, { agentPath: 'root/b', sessionFile: fileB }] })
  assert.deepEqual([overflow.available, overflow.totals, overflow.reason], [false, null, 'aggregate token counters exceed safe integer range'])
})
