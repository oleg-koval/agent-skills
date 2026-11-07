import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectEvidence } from '../plugins/olko-github-pr/skills/lekker-review/scripts/evidence-bundle.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
function fixture(t, report = []) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-bundle-')), worktreePath = join(dir, 'repo')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(worktreePath); git(worktreePath, 'init', '-q'); git(worktreePath, 'config', 'core.hooksPath', '/dev/null')
  git(worktreePath, 'config', 'user.name', 'Test'); git(worktreePath, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(worktreePath, 'README.md'), 'base\n'); git(worktreePath, 'add', '-A'); git(worktreePath, 'commit', '-qm', 'base')
  const mergeBase = git(worktreePath, 'rev-parse', 'HEAD')
  writeFileSync(join(worktreePath, 'src.js'), 'head\n'); git(worktreePath, 'add', '-A'); git(worktreePath, 'commit', '-qm', 'head')
  const headSha = git(worktreePath, 'rev-parse', 'HEAD'), eslintJson = join(dir, 'eslint.json'), eslintProvenance = join(dir, 'eslint.provenance.json')
  const reportBytes = Buffer.from(JSON.stringify(report))
  writeFileSync(eslintJson, reportBytes)
  const receipt = { schema: 1, status: 'available', baseSha: mergeBase, headShaBefore: headSha, headShaAfter: headSha,
    trackedCleanBefore: true, trackedCleanAfter: true, exitCode: 0, reportSha256: createHash('sha256').update(reportBytes).digest('hex') }
  writeFileSync(eslintProvenance, JSON.stringify(receipt))
  return { dir, worktreePath, mergeBase, headSha, eslintJson, eslintProvenance, receipt,
    metadata: { worktreePath, mergeBase, headSha, eslintJson, eslintProvenance } }
}

test('composes observed Git identity with validated empty lint capture', t => {
  const f = fixture(t), out = collectEvidence(f.metadata)
  assert.equal(out.schema, 1); assert.equal(out.git.status, 'available')
  assert.equal(out.lint.captureStatus, 'available'); assert.equal(out.lint.exitCode, 0)
  assert.deepEqual(out.lint.report, []); assert.equal('lintStatus' in out.lint, false); assert.equal('clean' in out.lint, false)
  const metadataFile = join(f.dir, 'worktree.json')
  writeFileSync(metadataFile, JSON.stringify(f.metadata))
  const cli = spawnSync('node', ['plugins/olko-github-pr/skills/lekker-review/scripts/evidence-bundle.mjs', '--worktree', metadataFile], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).lint.captureStatus, 'available')
  assert.equal(spawnSync('node', ['plugins/olko-github-pr/skills/lekker-review/scripts/evidence-bundle.mjs'], { encoding: 'utf8' }).status, 2)
  writeFileSync(f.eslintProvenance, JSON.stringify({ ...f.receipt, exitCode: 1 }))
  assert.equal(collectEvidence(f.metadata).lint.exitCode, 1)
})

test('stale identity, altered bytes, missing artifacts and malformed JSON stay unavailable', t => {
  const f = fixture(t)
  const save = receipt => writeFileSync(f.eslintProvenance, JSON.stringify(receipt))
  save({ ...f.receipt, baseSha: 'a'.repeat(40) })
  assert.equal(collectEvidence(f.metadata).lint.captureStatus, 'unavailable')
  save({ ...f.receipt, headShaAfter: 'b'.repeat(40) })
  assert.equal(collectEvidence(f.metadata).lint.captureStatus, 'unavailable')
  save(f.receipt); writeFileSync(f.eslintJson, '[] ')
  assert.match(collectEvidence(f.metadata).lint.reason, /hash mismatch/)
  writeFileSync(f.eslintJson, '[{}]')
  assert.match(collectEvidence(f.metadata).lint.reason, /hash mismatch/)
  const missing = collectEvidence({ ...f.metadata, eslintJson: join(f.dir, 'missing.json') })
  assert.equal(missing.lint.captureStatus, 'unavailable')
  const missingReceipt = collectEvidence({ ...f.metadata, eslintProvenance: join(f.dir, 'missing-receipt.json') })
  assert.equal(missingReceipt.lint.captureStatus, 'unavailable')
  writeFileSync(f.eslintJson, '{}'); save({ ...f.receipt, reportSha256: createHash('sha256').update('{}').digest('hex') })
  assert.match(collectEvidence(f.metadata).lint.reason, /not a JSON array/)
  writeFileSync(f.eslintJson, 'not-json'); save({ ...f.receipt, reportSha256: createHash('sha256').update('not-json').digest('hex') })
  assert.match(collectEvidence(f.metadata).lint.reason, /malformed JSON/)
  writeFileSync(f.eslintProvenance, '{')
  assert.match(collectEvidence(f.metadata).lint.reason, /provenance is missing or malformed/)
})

test('Git failure and malformed metadata never permit lint reuse', t => {
  const f = fixture(t)
  writeFileSync(join(f.worktreePath, 'src.js'), 'dirty\n')
  const dirty = collectEvidence(f.metadata)
  assert.equal(dirty.git.status, 'unavailable'); assert.equal(dirty.lint.captureStatus, 'unavailable')
  assert.equal(collectEvidence(null).git.status, 'unavailable')
  const noReport = collectEvidence({ ...f.metadata, eslintJson: null })
  assert.equal(noReport.lint.captureStatus, 'unavailable')
})
