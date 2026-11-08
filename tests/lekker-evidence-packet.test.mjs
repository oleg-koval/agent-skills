import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { projectEvidencePacket } from '../plugins/olko-github-pr/skills/lekker-review/scripts/evidence-packet.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture(candidate = true) {
  const diff = 'diff --git a/src/a.mjs b/src/a.mjs\nindex 1..2 100644\n--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1 +1 @@\n-old\n+new\n'
    + `diff --git a/src/b.mjs b/src/b.mjs\nindex 1..2 100644\n--- a/src/b.mjs\n+++ b/src/b.mjs\n@@ -1 +1 @@\n-old\n+${'unrelated'.repeat(400)}\n`
  const report = { schema: 1, source: 'src/a.mjs', contract: { validInput: 'ASCII' }, provenance: { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) },
    candidates: candidate ? [{ id: 'case-1', input: 'witness', inputSha256: 'c'.repeat(64), outcomes: { original: 0, defective: 1 } }] : [],
    reducedCounterexample: candidate ? { id: 'case-1', scope: 'reduced witness only' } : null }
  const reportSha256 = hash(Buffer.from(JSON.stringify(report, null, 2) + '\n'))
  const bundle = { schema: 1, git: { status: 'available', provenance: { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) },
    changedPaths: ['src/a.mjs', 'src/b.mjs'], diff: { text: diff, sha256: hash(Buffer.from(diff)) } },
  lint: { captureStatus: 'available', report: [{ filePath: 'src/a.mjs', ruleId: 'x' }, { filePath: 'src/b.mjs', ruleId: 'y', message: 'noise'.repeat(200) }] },
  boundary: { captureStatus: 'available', report, reportSha256, summary: { reducedFailure: { failureCode: 'ENAMETOOLONG', stderrSha256: 'd'.repeat(64) } } } }
  const bytes = Buffer.from(JSON.stringify(bundle))
  return { bundle, bytes, digest: hash(bytes) }
}

test('projects selected source and boundary witness while preserving exact full-bundle provenance', () => {
  const f = fixture(), before = Buffer.from(f.bytes)
  const packet = projectEvidencePacket(f.bytes, f.digest, { dimension: 'filename-boundary', paths: ['src/a.mjs'] })
  assert.equal(packet.boundary.status, 'candidate'); assert.equal(packet.sourceRanges.length, 1)
  assert.equal(packet.boundary.witness.input, 'witness'); assert.equal(packet.boundary.witness.failure.failureCode, 'ENAMETOOLONG')
  assert.deepEqual(packet.lint.diagnostics.map(row => row.ruleId), ['x'])
  assert.deepEqual(packet.scope.omittedPaths, ['src/b.mjs'])
  assert.equal(packet.scope.omittedContextReviewed, false); assert.equal(packet.coverageGaps.broadDiffReviewRequired, true)
  assert.ok(packet.packetBytes < f.bytes.length); assert.equal(packet.provenance.fullBundleSha256, f.digest)
  assert.equal(packet.packetBytes, Buffer.byteLength(JSON.stringify(packet)))
  assert.deepEqual(f.bytes, before)
})

test('returns explicit no-candidate and unavailable states; rejects stale hashes and over-budget packets', () => {
  const safe = fixture(false), packet = projectEvidencePacket(safe.bytes, safe.digest, { dimension: 'quality', paths: ['src/a.mjs'] })
  assert.equal(packet.boundary.status, 'no-candidate'); assert.equal(packet.boundary.witness, null)
  assert.match(projectEvidencePacket(safe.bytes, '0'.repeat(64), { dimension: 'quality', paths: ['src/a.mjs'] }).reason, /hash/)
  assert.match(projectEvidencePacket(safe.bytes, safe.digest, { dimension: 'quality', paths: ['src/a.mjs'], maxBytes: 256 }).reason, /budget/)
  assert.match(projectEvidencePacket(safe.bytes, safe.digest, { dimension: 'quality', paths: ['src/a.mjs'], maxBytes: 262145 }).reason, /budget/)
  const unavailableBundle = { ...safe.bundle, boundary: { captureStatus: 'unavailable', reason: 'probe unsupported' } }
  const unavailableBytes = Buffer.from(JSON.stringify(unavailableBundle))
  assert.equal(projectEvidencePacket(unavailableBytes, hash(unavailableBytes), { dimension: 'quality', paths: ['src/a.mjs'] }).boundary.status, 'unavailable')
  const bad = fixture(); bad.bundle.boundary.report.contract.validInput = 'tampered'
  const bytes = Buffer.from(JSON.stringify(bad.bundle))
  assert.match(projectEvidencePacket(bytes, hash(bytes), { dimension: 'quality', paths: ['src/a.mjs'] }).reason, /boundary report hash/)
  bad.bundle.boundary.report.provenance.headSha = 'e'.repeat(40)
  bad.bundle.boundary.reportSha256 = hash(Buffer.from(JSON.stringify(bad.bundle.boundary.report, null, 2) + '\n'))
  const staleBytes = Buffer.from(JSON.stringify(bad.bundle))
  assert.match(projectEvidencePacket(staleBytes, hash(staleBytes), { dimension: 'quality', paths: ['src/a.mjs'] }).reason, /boundary provenance/)
  assert.equal(projectEvidencePacket(safe.bytes, safe.digest, { dimension: 'quality', paths: ['missing'] }).status, 'unavailable')
})
