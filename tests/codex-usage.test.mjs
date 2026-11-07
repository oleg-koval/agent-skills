import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectCompletion, collectUsage } from '../plugins/olko-github-pr/skills/lekker-review/scripts/codex-usage.mjs'

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']
const counts = n => Object.fromEntries(fields.map(k => [k, n]))
const meta = (parent = 'parent', path = 'root/a') => ({ type: 'session_meta', payload: { id: 'session-a', source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_path: path } } } } })
const event = (type, info = {}) => ({ type: 'event_msg', payload: { type, info } })
const turn = (type, turnId = 'turn-a') => ({ type: 'event_msg', payload: { type, turn_id: turnId } })
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

test('completion needs no usage and preserves raw files and manifest', async t => {
  for (const tokens of [[], [event('token_count')], [event('token_count', { total_token_usage: counts(2) }), event('token_count', { total_token_usage: counts(1) })]]) {
    const { manifest, file } = fixture(t, [meta(), turn('task_started'), ...tokens, turn('task_complete')])
    const before = readFileSync(file), original = JSON.stringify(manifest)
    const result = await collectCompletion(manifest)
    assert.deepEqual(result, { available: true, agents: [{ agentPath: 'root/a', status: 'available', sessionId: 'session-a', models: [], turnId: 'turn-a' }] })
    assert.deepEqual(await collectCompletion(manifest), result)
    assert.deepEqual(readFileSync(file), before)
    assert.equal(JSON.stringify(manifest), original)
    assert.equal((await collectUsage(manifest)).available, false)
  }
})

test('completion rejects unbound, malformed, unfinished and aborted sessions with reasons', async t => {
  for (const [rows, reason] of [
    [[turn('task_started'), turn('task_complete')], 'session metadata unavailable'],
    [[{ type: 'session_meta' }], 'session metadata missing or duplicated'],
    [[meta(), meta()], 'session metadata missing or duplicated'],
    [[meta('wrong')], 'parent thread or agent path mismatch'], [[meta('parent', 'other')], 'parent thread or agent path mismatch'],
    [[meta(), 'not-json'], 'malformed JSONL'], [[meta(), null], 'malformed JSONL'],
    [[meta()], 'task completion unavailable'], [[meta(), turn('task_started'), turn('task_complete'), turn('task_started', 'turn-b')], 'task completion unavailable'],
    [[meta(), turn('task_complete')], 'task turn identity mismatch'],
    [[meta(), event('task_started')], 'task turn identity unavailable'],
    [[meta(), turn('task_started'), event('task_complete')], 'task turn identity mismatch'],
    [[meta(), turn('task_started'), turn('task_started', 'turn-b'), turn('task_complete')], 'task turn identity mismatch'],
    [[meta(), turn('task_started'), turn('turn_aborted')], 'task aborted'],
    [[meta(), turn('task_started'), turn('task_complete'), turn('turn_aborted')], 'task aborted'],
    [[meta(), turn('task_started'), turn('turn_aborted'), turn('task_complete')], 'task aborted'],
  ]) {
    const { manifest } = fixture(t, rows)
    assert.deepEqual(await collectCompletion(manifest), { available: false, agents: [{ agentPath: 'root/a', status: 'unavailable', reason }] })
  }
  const resumed = fixture(t, [meta(), turn('task_started'), turn('turn_aborted'), turn('task_started', 'turn-b'), turn('task_complete', 'turn-b')])
  assert.equal((await collectCompletion(resumed.manifest)).available, true)
  assert.equal((await collectCompletion(resumed.manifest)).agents[0].turnId, 'turn-b')
  const missing = { ...resumed.manifest, agents: [{ agentPath: 'root/a', sessionFile: join(resumed.dir, 'missing') }] }
  assert.equal((await collectCompletion(missing)).agents[0].reason, 'session file could not be read')
})

test('completion validates manifests and aggregates partial availability without usage', async t => {
  const { manifest, dir } = fixture(t, [meta(), turn('task_started'), turn('task_complete')])
  for (const value of [null, {}, { ...manifest, agents: [] }, { ...manifest, agents: Array(1) }]) {
    assert.deepEqual(await collectCompletion(value), { available: false, agents: [], reason: 'manifest needs parentThreadId and explicit agentPath/sessionFile entries' })
  }
  for (const entry of [{ ...manifest.agents[0], sessionFile: 'other' }, { ...manifest.agents[0], agentPath: 'root/b' }]) {
    assert.deepEqual(await collectCompletion({ ...manifest, agents: [...manifest.agents, entry] }),
      { available: false, agents: [], reason: 'manifest repeats an agent path or session file' })
  }
  const second = join(dir, 'b.jsonl')
  writeFileSync(second, JSON.stringify(meta('parent', 'root/b')))
  const result = await collectCompletion({ ...manifest, agents: [...manifest.agents, { agentPath: 'root/b', sessionFile: second }] })
  assert.equal(result.available, false)
  assert.equal(result.agents[0].status, 'available')
  assert.equal(result.agents[1].reason, 'task completion unavailable')
})

test('usage CLI keeps its output and error behavior', async t => {
  const { manifest, dir } = fixture(t, [meta(), event('token_count', { total_token_usage: counts(1) }), event('task_complete')])
  const path = join(dir, 'manifest.json'), script = 'plugins/olko-github-pr/skills/lekker-review/scripts/codex-usage.mjs'
  writeFileSync(path, JSON.stringify(manifest))
  const result = spawnSync(process.execPath, [script, '--manifest', path], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), await collectUsage(manifest))
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2)
  writeFileSync(path, 'not-json')
  const invalid = spawnSync(process.execPath, [script, '--manifest', path], { encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.equal(JSON.parse(invalid.stdout).reason, 'manifest could not be read')
})
