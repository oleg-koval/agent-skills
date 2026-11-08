import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateBoundaryReport } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-validation.mjs'

test('validator requires observed nonempty coverage and the fixed helper hash map', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-boundary-validation-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sha = 'a'.repeat(64), baseSha = 'b'.repeat(40), headSha = 'c'.repeat(40)
  const names = ['boundary-cases.mjs', 'boundary-filesystem.mjs', 'boundary-invocation.mjs', 'boundary-probe-contract.mjs',
    'boundary-probe-runner.mjs', 'boundary-report.mjs', 'boundary-source.mjs', 'boundary-validation.mjs', 'git-evidence.mjs']
  const run = { status: 'observed', exitClass: 'success', exitCode: 0, stdoutSha256: sha, stderrSha256: sha, stdoutFile: 'raw/out', stderrFile: 'raw/err' }
  const report = { schema: 1, status: 'available', source: 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs', seed: 1,
    contract: { count: 1, maxComponentBytes: 255, validInput: 'ASCII slug' }, candidates: [], results: [{ id: '1', input: 'a', inputBytes: 1,
      inputSha256: createHash('sha256').update('a').digest('hex'), status: 'available', runs: { original: run, defective: run } }],
    provenance: { baseSha, headSha, trustedRoot: '/trusted', repoSlug: 'r', sources: { original: { commit: baseSha, sha256: sha },
      defective: { commit: headSha, sha256: sha } }, adapterSha256: sha, generatorSha256: sha, runtime: 'v22',
      moduleSha256: Object.fromEntries(names.map(name => [name, sha])) } }
  const git = { status: 'available', changedPaths: [report.source], provenance: { baseSha, headSha } }
  const path = join(dir, 'report.json')
  const check = value => { const bytes = Buffer.from(JSON.stringify(value)); writeFileSync(path, bytes); return validateBoundaryReport({
    status: 'available', reportFile: path, reportSha256: createHash('sha256').update(bytes).digest('hex') }, git) }
  assert.equal(check(report).captureStatus, 'available')
  assert.equal(check({ ...report, results: [], contract: { ...report.contract, count: 0 } }).captureStatus, 'unavailable')
  const { 'git-evidence.mjs': ignored, ...incompleteModules } = report.provenance.moduleSha256
  assert.equal(check({ ...report, provenance: { ...report.provenance, moduleSha256: incompleteModules } }).captureStatus, 'unavailable')
})
