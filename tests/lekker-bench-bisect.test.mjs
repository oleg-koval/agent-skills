import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { nextRef, orderedRefsFrom, parseVerdicts } from '../plugins/olko-github-pr/skills/lekker-review/scripts/bench-bisect.mjs'

const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/bench-bisect.mjs'
const refs = ['v1', 'v2', 'v3', 'v4', 'v5']

test('first step tests the midpoint of an odd-length range', () => {
  assert.deepEqual(nextRef(refs, {}), { next: 'v3' })
})

test('even-length range picks the lower middle', () => {
  assert.deepEqual(nextRef(['a', 'b', 'c', 'd'], {}), { next: 'b' })
})

test('converges on the first bad ref', () => {
  const bug = 'v4'
  const run = (verdicts) => {
    const step = nextRef(refs, verdicts)
    if (!step.next) return step
    return run({ ...verdicts, [step.next]: refs.indexOf(step.next) >= refs.indexOf(bug) ? 'bad' : 'good' })
  }
  assert.deepEqual(run({}), { culprit: 'v4' })
})

test('adjacent good and bad at the start is already the culprit', () => {
  assert.deepEqual(nextRef(['v1', 'v2'], {}), { culprit: 'v2' })
})

test('a bad before a good is inconsistent', () => {
  const result = nextRef(refs, { v2: 'bad', v3: 'good' })
  assert.match(result.error, /inconsistent/)
})

test('unknown refs and bad verdict values are errors', () => {
  assert.match(nextRef(refs, { v9: 'good' }).error, /not in the ordered refs/)
  assert.match(nextRef(refs, { v2: 'maybe' }).error, /must be "good" or "bad"/)
  assert.match(nextRef(['v1'], {}).error, /at least/)
})

test('nextRef does not mutate its inputs', () => {
  const verdicts = Object.freeze({ v2: 'good' })
  assert.deepEqual(nextRef(Object.freeze([...refs]), verdicts), { next: 'v3' })
})

test('verdict and ordered-ref parsing', () => {
  assert.deepEqual(parseVerdicts('v2=good, v3=bad'), { v2: 'good', v3: 'bad' })
  assert.deepEqual(parseVerdicts(undefined), {})
  assert.deepEqual(orderedRefsFrom(['v2', 'v3', 'v4'], 'v1', 'v4'), ['v1', 'v2', 'v3', 'v4'])
})

test('cli prints the next ref and exits 1 on inconsistent verdicts', () => {
  const ok = spawnSync('node', [cli, '--tags', 'v2,v3,v4', '--good', 'v1', '--bad', 'v4'], { encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.deepEqual(JSON.parse(ok.stdout), { next: 'v2' })
  const bad = spawnSync('node', [cli, '--tags', 'v2,v3,v4', '--good', 'v1', '--bad', 'v4', '--verdicts', 'v2=bad,v3=good'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /inconsistent/)
})
