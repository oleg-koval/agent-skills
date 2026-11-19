import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/lekker-progress.mjs'
const { frame, STAGES, width, MAX_WIDTH } = await import(`../${script}`)
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
const emoji = /\p{Extended_Pictographic}/u

test('non-TTY output is exactly one line with no escape codes', () => {
  const out = run('--stage', 'verify', '--message', 'verifying\n3 findings')
  assert.equal(out.status, 0)
  assert.equal(out.stdout.split('\n').length, 2)
  assert.ok(out.stdout.endsWith('\n'))
  assert.ok(!out.stdout.includes('\x1b') && !out.stdout.includes('\r'))
  assert.match(out.stdout, /verify: verifying 3 findings/)
})

test('every stage renders one line, and decision prints a compass line', () => {
  for (const stage of Object.keys(STAGES)) {
    const out = run('--stage', stage, '--message', 'x: y')
    assert.equal(out.status, 0, stage)
    assert.equal(out.stdout.trimEnd().split('\n').length, 1, stage)
  }
  assert.equal(run('--stage', 'decision', '--message', 'dropped a.ts:1: unreachable').stdout, '🧭 dropped a.ts:1: unreachable\n')
  assert.equal(run('--stage', 'decision', '--message', 'a: b', '--ascii').stdout, '> a: b\n')
  assert.ok(run('--stage', 'start', '--message', 'm').stdout.includes('⛵'))
  assert.ok(run('--stage', 'success', '--message', 'm').stdout.includes('😌'))
})

test('the boat moves forward through the stages and decision leaves it alone', () => {
  const slots = ['start', 'context', 'review', 'verify', 'critic', 'prove', 'fix', 'post', 'success'].map((s) => STAGES[s][0])
  assert.deepEqual(slots, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(STAGES.decision[0], null)
  assert.ok(!frame('decision', 5, { message: 'm' }).includes('⛵'))
})

test('frame is deterministic and truncates to the width budget', () => {
  assert.equal(frame('prove', 5, { message: 'm' }), frame('prove', 5, { message: 'm' }))
  assert.notEqual(frame('prove', 4, { message: 'm' }), frame('prove', 5, { message: 'm' }))
  const long = frame('start', 0, { message: '界'.repeat(100) })
  assert.ok(width(long) <= MAX_WIDTH && long.endsWith('…'))
  assert.ok(width(frame('decision', 0, { message: 'x'.repeat(300) })) <= MAX_WIDTH)
})

test('unknown or missing arguments still exit 0 with one plain line', () => {
  for (const args of [['--stage', 'bogus'], ['--stage', 'bogus', '--message', 'hi'], [], ['--stage']]) {
    const out = run(...args)
    assert.equal(out.status, 0)
    assert.equal(out.stdout.trimEnd().split('\n').length, 1)
    assert.ok(!out.stdout.includes('\x1b'))
  }
})

test('--ascii output has no emoji', () => {
  for (const stage of Object.keys(STAGES)) {
    const out = run('--stage', stage, '--message', 'm', '--ascii')
    assert.equal(out.status, 0)
    assert.ok(!emoji.test(out.stdout) && !/[^\x20-\x7e\n]/.test(out.stdout), stage)
  }
})
