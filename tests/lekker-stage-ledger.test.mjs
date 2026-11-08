import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildStageLedger, buildStageLedgerFromFiles } from '../plugins/olko-github-pr/skills/lekker-review/scripts/stage-ledger.mjs'

const session = (sessionId, stage, inputTokens = 10) => ({ sessionId, stage, status: 'available',
  usage: { inputTokens, cachedInputTokens: 3, outputTokens: 2 }, elapsedSeconds: 1.5 })

test('counts explicit stage usage once and separates discovery from verification', () => {
  const result = buildStageLedger({ schema: 1, sessions: [session('a', 'discovery'), session('b', 'verification')] },
    { schema: 1, claims: [
      { verdict: 'confirmed', defectId: 'D1', discoveryStage: 'discovery', verificationStage: 'verification' },
      { verdict: 'confirmed', defectId: 'D1', discoveryStage: 'discovery', verificationStage: 'verification' },
      { verdict: 'false-alarm' }, { verdict: 'duplicate' },
    ] })
  assert.equal(result.outcomes.confirmedDefects.length, 1)
  assert.equal(result.outcomes.falseAlarms, 1); assert.equal(result.outcomes.duplicates, 1)
  assert.deepEqual(result.stages.map(({ name, inputTokens, uncachedInputTokens, discoveredDefects, verifiedDefects }) =>
    ({ name, inputTokens, uncachedInputTokens, discoveredDefects, verifiedDefects })), [
    { name: 'discovery', inputTokens: 10, uncachedInputTokens: 7, discoveredDefects: ['D1'], verifiedDefects: [] },
    { name: 'verification', inputTokens: 10, uncachedInputTokens: 7, discoveredDefects: [], verifiedDefects: ['D1'] },
  ])
})

test('preserves empty stages, unavailable sessions and unknown attribution', () => {
  const result = buildStageLedger({ schema: 1, sessions: [session('a', 'empty') ,
    { sessionId: 'b', stage: 'failed', status: 'failed' }] }, { schema: 1, claims: [
    { verdict: 'confirmed', defectId: 'D1' },
  ] })
  assert.equal(result.stages[0].inputTokens, 10)
  assert.equal(result.stages[1].inputTokens, null); assert.equal(result.stages[1].unavailableSessions, 1)
  assert.equal(result.outcomes.unknownDiscovery, 1); assert.equal(result.outcomes.unknownVerification, 1)
  assert.equal(buildStageLedger({ schema: 1, sessions: [] }, null).outcomes.status, 'unavailable')
  const empty = buildStageLedger({ schema: 1, sessions: [session('empty', 'successful-empty')] }, { schema: 1, claims: [] })
  assert.deepEqual(empty.outcomes.confirmedDefects, []); assert.equal(empty.outcomes.falseAlarms, 0)
})

test('rejects duplicate session identity and malformed counters', () => {
  assert.match(buildStageLedger({ schema: 1, sessions: [session('a', 'one'), session('a', 'two')] }).reason, /duplicate/)
  assert.match(buildStageLedger({ schema: 1, sessions: [session('a', 'one', -1)] }).reason, /invalid/)
  assert.match(buildStageLedger({ schema: 1, sessions: [] }, { schema: 1, claims: [{ verdict: 'maybe' }] }).reason, /adjudication/)
})

test('consumes only explicit saved run manifests and adjudication files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-stage-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const usageFile = join(dir, 'host-usage.json')
  writeFileSync(usageFile, JSON.stringify({ available: true, sessions: [
    { sessionId: 'saved-1', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 5 }, wallSeconds: 12 },
  ] }))
  const manifest = { schema: 1, runs: [{ stage: 'review', usageFile }] }
  const adjudication = { evaluations: [{ decisions: [{ verdict: 'confirmed', defectId: 'D1' }] }] }
  const result = buildStageLedgerFromFiles(manifest, adjudication)
  assert.equal(result.stages[0].inputTokens, 100); assert.deepEqual(result.stages[0].elapsedSeconds, [12])
  assert.equal(result.outcomes.unknownDiscovery, 1); assert.deepEqual(result.outcomes.confirmedDefects, ['D1'])
  assert.equal(buildStageLedgerFromFiles(manifest, null).outcomes.status, 'unavailable')
  const missing = buildStageLedgerFromFiles({ schema: 1, runs: [{ stage: 'missing', usageFile: join(dir, 'absent') }] })
  assert.equal(missing.stages[0].inputTokens, null); assert.equal(missing.stages[0].status, 'partial')
})
