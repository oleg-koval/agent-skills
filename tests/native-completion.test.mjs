import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateNativeCompletion } from '../plugins/olko-github-pr/skills/lekker-review/scripts/native-completion.mjs'

const bytes = Buffer.from('{"engine":"codex","findings":[]}')
const sha = 'a'.repeat(40)
const dims = { deps: ['deps'], scan: ['triage-quality', 'triage-logic', 'project-rules'],
  medium: ['quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules'],
  deep: ['quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules'] }
const inputs = (depth = 'medium', worktreeAvailable = true, eligible = { verify: 2, prove: 1 }) => ({
  runId: 'run-1', headSha: sha, depth, worktreeAvailable, eligible,
})
const receipt = (e, more = {}) => {
  const verify = e.depth === 'deps' ? 0 : e.eligible.verify
  const prove = ['medium', 'deep'].includes(e.depth) && e.worktreeAvailable ? Math.min(5, e.eligible.prove) : 0
  const stage = scheduled => ({ scheduled, completed: scheduled, failed: 0 })
  return { schema: 1, engine: 'codex', status: 'complete', runId: e.runId, headSha: e.headSha,
    depth: e.depth, findingsSha256: createHash('sha256').update(bytes).digest('hex'),
    dimensions: dims[e.depth].map(name => ({ name, status: 'completed' })),
    stages: { verify: stage(verify), critic: e.depth === 'deep' ? 'completed' : 'not_required', prove: stage(prove) }, ...more }
}
const check = (r, e = inputs(), data = bytes) => validateNativeCompletion(r, e, data)

test('validates medium and depth-specific completion policy', () => {
  assert.deepEqual(check(receipt(inputs())), { available: true, reason: null })
  for (const [depth, worktree, eligible] of [
    ['deps', false, { verify: 0, prove: 0 }], ['scan', false, { verify: 2, prove: 1 }],
    ['deep', true, { verify: 2, prove: 1 }], ['medium', false, { verify: 2, prove: 3 }],
  ]) assert.equal(check(receipt(inputs(depth, worktree, eligible)), inputs(depth, worktree, eligible)).available, true)
  const sha256Inputs = { ...inputs(), headSha: 'b'.repeat(64) }
  assert.equal(check(receipt(sha256Inputs), sha256Inputs).available, true)
})

test('rejects missing, duplicate, unknown, or degraded dimension evidence', () => {
  const e = inputs(), good = receipt(e)
  assert.equal(check(receipt(inputs('deps'), { dimensions: Array(1) }), inputs('deps')).available, false)
  assert.equal(check(receipt(e, { dimensions: good.dimensions.slice(1) })).available, false)
  assert.equal(check(receipt(e, { dimensions: good.dimensions.map((d, i) => i === 1 ? good.dimensions[0] : d) })).available, false)
  assert.equal(check(receipt(e, { dimensions: good.dimensions.map((d, i) => i === 0 ? { ...d, name: 'other' } : d) })).available, false)
  assert.equal(check(receipt(e, { dimensions: good.dimensions.map((d, i) => i === 0 ? { ...d, status: 'unavailable' } : d) })).available, false)
  assert.equal(check(receipt(e, { status: 'degraded' })).available, false)
})

test('binds the receipt to expected run, full head and exact findings bytes', () => {
  const good = receipt(inputs())
  assert.equal(check(good, { ...inputs(), headSha: 'b'.repeat(40) }).reason, 'head SHA mismatch')
  assert.equal(check({ ...good, runId: 'other' }).reason, 'run identity or depth mismatch')
  assert.equal(check({ ...good, depth: 'deep' }).reason, 'run identity or depth mismatch')
  assert.equal(check(good, inputs(), Buffer.from('changed')).reason, 'findings hash mismatch')
  assert.equal(check({ ...good, findingsSha256: [] }).reason, 'findings hash mismatch')
})

test('rejects invalid stage counts and depth or worktree policy violations', /** Covers stage accounting and depth-specific policy rejection. */ () => {
  const e = inputs(), good = receipt(e)
  for (const stage of ['verify', 'prove']) {
    for (const counts of [{ completed: good.stages[stage].scheduled - 1 }, { failed: 1 }]) {
      assert.deepEqual(check(receipt(e, { stages: { ...good.stages, [stage]: { ...good.stages[stage], ...counts } } })),
        { available: false, reason: 'verification or proof stage accounting is incomplete' })
    }
  }
  assert.equal(check(receipt(e, { stages: { ...good.stages, verify: { ...good.stages.verify, scheduled: 3 } } })).available, false)
  assert.equal(check(receipt(e, { stages: { ...good.stages, critic: 'completed' } })).available, false)
  const deep = inputs('deep')
  assert.equal(check(receipt(deep, { stages: { ...receipt(deep).stages, critic: 'not_required' } }), deep).available, false)
  const noWorktree = inputs('medium', false, { verify: 2, prove: 1 })
  assert.equal(check(receipt(noWorktree, { stages: { ...receipt(noWorktree).stages, prove: { scheduled: 1, completed: 1, failed: 0 } } }), noWorktree).available, false)
  const capped = inputs('deep', true, { verify: 3, prove: 7 })
  assert.equal(check(receipt(capped), capped).available, true)
  assert.equal(check(receipt(capped, { stages: { ...receipt(capped).stages, prove: { scheduled: 6, completed: 6, failed: 0 } } }), capped).available, false)
})
