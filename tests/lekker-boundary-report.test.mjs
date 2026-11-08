import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleBoundaryReport } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-report.mjs'

const run = (exitClass, exitCode) => ({ status: 'observed', exitClass, exitCode })
const row = (id, defective = run('success', 0)) => ({ id, input: 'target', inputSha256: 'a'.repeat(64),
  status: 'available', runs: { original: run('success', 0), defective, repaired: run('success', 0) } })

test('summarizes only observed original-defect-repair behavior as candidates', () => {
  const hit = row('candidate', run('component-limit', 1)), safe = row('safe')
  const report = assembleBoundaryReport({ source: 'run-log.mjs', provenance: {}, seed: 1, componentLimit: 255,
    prefixSha256: 'b'.repeat(64), suffixSha256: 'c'.repeat(64), cases: [hit, safe], results: [hit, safe],
    shrinkResults: [], outputDir: '/artifact', reduced: null })
  assert.equal(report.status, 'available'); assert.equal(report.candidates.length, 1)
  assert.equal(report.candidates[0].id, 'candidate'); assert.equal(report.contract.count, 2)
})

test('marks missing or unexpected invocation coverage unavailable', () => {
  const hit = row('incomplete', run('unexpected', 2))
  const report = assembleBoundaryReport({ source: 'run-log.mjs', provenance: {}, seed: 1, componentLimit: 255,
    prefixSha256: 'b'.repeat(64), suffixSha256: 'c'.repeat(64), cases: [hit], results: [],
    shrinkResults: [hit], outputDir: '/artifact', reduced: null })
  assert.equal(report.status, 'unavailable')
})
