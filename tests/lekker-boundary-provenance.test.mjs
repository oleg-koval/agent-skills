import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { hashBoundaryHelpers, validProbeConfig } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe-contract.mjs'

test('boundary report provenance hashes the fixed helper modules', () => {
  const adapterDir = dirname(fileURLToPath(new URL('../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe-contract.mjs', import.meta.url)))
  const hashes = hashBoundaryHelpers(new URL('../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe-contract.mjs', import.meta.url))
  assert.deepEqual(Object.keys(hashes).sort(), ['boundary-cases.mjs', 'boundary-filesystem.mjs',
    'boundary-invocation.mjs', 'boundary-probe-contract.mjs', 'boundary-probe-runner.mjs', 'boundary-report.mjs', 'boundary-source.mjs', 'boundary-validation.mjs', 'git-evidence.mjs'].sort())
  for (const [name, hash] of Object.entries(hashes)) {
    assert.equal(hash, createHash('sha256').update(readFileSync(join(adapterDir, name))).digest('hex'))
  }
})

test('trusted probe config rejects arbitrary and out-of-budget values', () => {
  const valid = { schema: 1, trustedRoot: '/tmp/trusted', repoSlug: 'review-run', seed: 1 }
  assert.equal(validProbeConfig(valid), true)
  assert.equal(validProbeConfig({ ...valid, maxInputs: 1 }), false)
  assert.equal(validProbeConfig({ ...valid, repoSlug: '../arbitrary' }), false)
  assert.equal(validProbeConfig({ ...valid, repoSlug: 1 }), false)
  assert.equal(validProbeConfig({ ...valid, repoSlug: ['r'] }), false)
  assert.equal(validProbeConfig({ ...valid, suffix: ['x'] }), false)
  assert.equal(validProbeConfig({ ...valid, sourcePath: '../instructions.md', operation: 'node-fs.mkdtempSync.filename' }), false)
  assert.equal(validProbeConfig({ ...valid, sourcePath: 'src/name.mjs', operation: 'arbitrary-shell-command' }), false)
  assert.equal(validProbeConfig({ ...valid, sourcePath: 'src/name.mjs', operation: 'node-fs.mkdtempSync.filename',
    expectedProperty: 'valid ASCII targets produce a component within the observed byte limit', inputKind: 'multibyte' }), false)
  assert.equal(validProbeConfig({ ...valid, sourcePath: 'src/name.mjs', operation: 'node-fs.mkdtempSync.filename',
    expectedProperty: 'valid ASCII targets produce a component within the observed byte limit' }), true)
})
