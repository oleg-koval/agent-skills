import assert from 'node:assert/strict'
import test from 'node:test'
import { runBoundaryProbe } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe-runner.mjs'

test('runner requires explicit opt-in before accessing worktree or artifacts', () => {
  const result = runBoundaryProbe({})
  assert.equal(result.status, 'unavailable')
  assert.match(result.reason, /opt-in/)
})
