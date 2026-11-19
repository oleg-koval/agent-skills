import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const skill = 'plugins/olko-github-pr/skills/lekker-review/scripts'
const runLog = `${skill}/run-log.mjs`

const withState = (fn) => {
  const state = mkdtempSync(join(tmpdir(), 'lekker-decisions-'))
  const env = { ...process.env, LEKKER_STATE_DIR: state }
  const cli = (...args) => spawnSync(process.execPath, [runLog, ...args], { encoding: 'utf8', env })
  try { return fn({ state, env, cli }) } finally { rmSync(state, { recursive: true, force: true }) }
}
const startRun = (cli) => JSON.parse(cli('start', '--repo', 'o/r', '--target', 'pr-1').stdout)
const timeline = (state, runId) => readFileSync(join(state, 'runs', runId, 'timeline.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('decide appends a valid row to the run timeline', () => withState(({ state, cli }) => {
  const { runId } = startRun(cli)
  const out = cli('decide', runId, '--kind', 'depth', '--what', 'deep', '--why', 'risk path touched')
  assert.equal(out.status, 0)
  const row = timeline(state, runId).at(-1)
  assert.deepEqual(Object.keys(row), ['at', 'kind', 'what', 'why'])
  assert.deepEqual([row.kind, row.what, row.why], ['depth', 'deep', 'risk path touched'])
  assert.ok(Number.isFinite(Date.parse(row.at)))
}))

test('decide rejects unknown kinds, empty text and unknown runs', () => withState(({ state, cli }) => {
  const { runId } = startRun(cli)
  const before = timeline(state, runId).length
  const unknown = cli('decide', runId, '--kind', 'mood', '--what', 'a', '--why', 'b')
  assert.notEqual(unknown.status, 0)
  assert.match(JSON.parse(unknown.stdout).error, /unknown kind "mood"/)
  const empty = cli('decide', runId, '--kind', 'fix', '--what', 'a', '--why', '  ')
  assert.notEqual(empty.status, 0)
  assert.match(JSON.parse(empty.stdout).error, /non-empty/)
  const missing = cli('decide', runId, '--kind', 'fix', '--what', 'a')
  assert.notEqual(missing.status, 0)
  assert.notEqual(cli('decide', 'no-such-run', '--kind', 'fix', '--what', 'a', '--why', 'b').status, 0)
  assert.equal(timeline(state, runId).length, before)
}))

test('decide --from-json writes the batch, or nothing when one entry is bad', () => withState(({ state, cli }) => {
  const { runId } = startRun(cli)
  const good = join(state, 'good.json')
  writeFileSync(good, JSON.stringify([
    { kind: 'route', what: 'verifier -> opus high', why: 'risk tier routing' },
    { kind: 'finding', what: 'a.ts:3 Null deref', why: 'kept: reachable on empty cart' },
  ]))
  const ok = cli('decide', runId, '--from-json', good)
  assert.equal(JSON.parse(ok.stdout).decisions, 2)
  assert.deepEqual(timeline(state, runId).slice(-2).map((r) => r.kind), ['route', 'finding'])

  const bad = join(state, 'bad.json')
  writeFileSync(bad, JSON.stringify([{ kind: 'fix', what: 'x', why: 'y' }, { kind: 'nope', what: 'x', why: 'y' }]))
  const before = timeline(state, runId).length
  assert.notEqual(cli('decide', runId, '--from-json', bad).status, 0)
  assert.equal(timeline(state, runId).length, before)
  writeFileSync(bad, '{"kind":"fix"}')
  assert.notEqual(cli('decide', runId, '--from-json', bad).status, 0)
}))

test('finish keeps decisions out of the phase timings and records them in run.json', () => withState(({ state, cli }) => {
  const { runId } = startRun(cli)
  cli('mark', runId, 'review')
  cli('decide', runId, '--kind', 'tier', '--what', 'elevated', '--why', 'migrations')
  const out = JSON.parse(cli('finish', runId, '--status', 'ok', '--verdict', 'lgtm').stdout)
  assert.equal(out.runId, runId)
  const run = JSON.parse(readFileSync(join(state, 'runs', runId, 'run.json'), 'utf8'))
  assert.deepEqual(Object.keys(run.phasesS).sort(), ['review', 'start'])
  assert.equal(run.decisions.length, 1)
}))
