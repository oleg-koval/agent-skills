import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateLintReceipt } from '../plugins/olko-github-pr/skills/lekker-review/scripts/validate-lint-receipt.mjs'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const bytes = Buffer.from('[{"filePath":"src/a.js","messages":[]}]')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const expected = Object.freeze({ baseSha, headSha, trackedClean: true })
const receipt = (changes = {}) => Object.freeze({
  schema: 1, status: 'available', baseSha, headShaBefore: headSha, headShaAfter: headSha,
  trackedCleanBefore: true, trackedCleanAfter: true, exitCode: 0, reportSha256: sha256, ...changes,
})

test('validates provenance and preserves exit evidence without inferring lint outcome', () => {
  const input = receipt()
  const originalBytes = Buffer.from(bytes)
  assert.deepEqual(validateLintReceipt(input, expected, bytes), {
    status: 'available', baseSha, headSha,
    exitCode: 0, reportSha256: sha256, trackedCleanBefore: true, trackedCleanAfter: true,
  })
  const issues = validateLintReceipt(receipt({ exitCode: 1 }), expected, bytes)
  assert.equal(issues.status, 'available')
  assert.equal(issues.exitCode, 1)
  assert.equal('lintStatus' in issues, false)
  assert.deepEqual(input, receipt())
  assert.deepEqual(bytes, originalBytes)
})

test('accepts 64-character Git object IDs', () => {
  const base = 'c'.repeat(64), head = 'd'.repeat(64)
  const result = validateLintReceipt(receipt({ baseSha: base, headShaBefore: head, headShaAfter: head }),
    { baseSha: base, headSha: head, trackedClean: true }, bytes)
  assert.equal(result.status, 'available')
})

test('fails closed on mismatched or malformed receipt evidence', () => {
  const rejects = changes => assert.equal(validateLintReceipt(receipt(changes), expected, bytes).status, 'unavailable')
  rejects({ baseSha: 'c'.repeat(40) })
  rejects({ baseSha: [baseSha] })
  rejects({ headShaBefore: 'c'.repeat(40) })
  rejects({ headShaBefore: [headSha] })
  rejects({ headShaAfter: 'c'.repeat(40) })
  rejects({ trackedCleanBefore: false })
  rejects({ trackedCleanAfter: false })
  rejects({ exitCode: 2 })
  rejects({ exitCode: [0] })
  rejects({ reportSha256: [sha256] })
  rejects({ reportSha256: '0'.repeat(64) })
  rejects({ schema: 2 })
  rejects({ status: 'unavailable', reason: 'capture failed' })
  assert.equal(validateLintReceipt(null, expected, bytes).status, 'unavailable')
  assert.equal(validateLintReceipt(receipt(), { ...expected, trackedClean: false }, bytes).status, 'unavailable')
  assert.equal(validateLintReceipt(receipt(), { ...expected, baseSha: [baseSha] }, bytes).status, 'unavailable')
  assert.equal(validateLintReceipt(receipt(), { ...expected, headSha: [headSha] }, bytes).status, 'unavailable')
  assert.equal(validateLintReceipt(receipt(), expected, null).status, 'unavailable')
})
