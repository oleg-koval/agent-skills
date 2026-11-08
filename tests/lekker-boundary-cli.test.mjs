import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('boundary probe CLI requires all fixed trusted inputs and explicit opt-in', () => {
  const script = fileURLToPath(new URL('../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /trusted-opt-in/)
})
