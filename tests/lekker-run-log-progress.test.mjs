import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const runLog = 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs'

const withState = (extraEnv, fn) => {
  const state = mkdtempSync(join(tmpdir(), 'lekker-run-progress-'))
  const env = { ...process.env, LEKKER_STATE_DIR: state, ...extraEnv }
  const cli = (...args) => spawnSync(process.execPath, [runLog, ...args], { encoding: 'utf8', env })
  try { return fn(cli) } finally { rmSync(state, { recursive: true, force: true }) }
}

test('every milestone prints one progress line on stderr and keeps stdout JSON', () => withState({}, (cli) => {
  const start = cli('start', '--repo', 'o/r', '--target', 'pr-1', '--depth', 'medium')
  const { runId } = JSON.parse(start.stdout)
  assert.match(start.stderr, /start: o\/r pr-1, medium\n$/)

  const marks = [['context', /context: context ready/], ['review', /review: review agents started/],
    ['synthesis', /post: review synthesized/], ['fix', /fix: applying fixes/]]
  for (const [phase, expected] of marks) {
    const out = cli('mark', runId, phase)
    assert.doesNotThrow(() => JSON.parse(out.stdout), phase)
    assert.match(out.stderr, expected, phase)
    assert.equal(out.stderr.trimEnd().split('\n').length, 1, phase)
  }

  const decide = cli('decide', runId, '--kind', 'tier', '--what', 'standard', '--why', 'auto: default')
  assert.equal(decide.stderr, '🧭 standard: auto: default\n')

  const finish = cli('finish', runId, '--status', 'ok', '--verdict', 'lgtm-with-changes')
  assert.match(finish.stderr, /success: lgtm-with-changes/)
  assert.ok(finish.stderr.includes('😌'))
}))

test('a failed run prints the failure line, an unknown phase prints nothing', () => withState({}, (cli) => {
  const { runId } = JSON.parse(cli('start', '--repo', 'o/r', '--target', 'pr-2').stdout)
  assert.equal(cli('mark', runId, 'housekeeping').stderr, '')
  const finish = cli('finish', runId, '--status', 'failed', '--note', 'worktree setup failed')
  assert.match(finish.stderr, /failure: worktree setup failed/)
}))

test('LEKKER_PROGRESS=off silences stderr and --ascii has no emoji', () => {
  withState({ LEKKER_PROGRESS: 'off' }, (cli) => {
    assert.equal(cli('start', '--repo', 'o/r', '--target', 'pr-3').stderr, '')
  })
  withState({}, (cli) => {
    const { stderr } = cli('start', '--repo', 'o/r', '--target', 'pr-4', '--ascii')
    assert.ok(!/\p{Extended_Pictographic}/u.test(stderr) && stderr.includes('start:'))
  })
})
