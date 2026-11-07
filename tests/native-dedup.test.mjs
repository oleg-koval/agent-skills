import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/native-dedup.mjs'
function fixture(t, documents) {
  const dir = mkdtempSync(join(tmpdir(), 'native-dedup-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dimensions = Object.entries(documents).map(([name, findings]) => {
    const path = `${name}.json`, bytes = JSON.stringify({ findings })
    writeFileSync(join(dir, path), bytes)
    return { name, path, bytes }
  })
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({ dimensions: dimensions.map(({ name, path }) => ({ name, path })) }))
  return { dir, manifestPath, dimensions }
}

test('uses manifest dimensions and preserves canonical merge fields and boundaries', t => {
  const f = fixture(t, {
    quality: [
      { file: 'src/auth.ts', line: 10, severity: 'observation', title: 'Missing tenant check before cache lookup', bugClass: 'tenant-cache', description: 'Short.', badCode: 'cache.get(key)', fix: 'Scope key', otherInstances: ['src/other.ts:3'], agreedBy: ['forged'], marker: 'kept' },
      { file: 'src/auth.ts', line: 10, severity: 'important', title: 'Missing tenant check before cache lookup', bugClass: 'different-class', description: 'Separate class' },
      ...[1, 17, 33].map(line => ({ file: 'src/span.ts', line, severity: 'important', title: 'Missing pagination in product query', bugClass: 'missing-pagination' })),
      { file: 'src/unique.ts', line: 2, severity: 'observation', title: 'Unique note', nested: { keep: true } },
    ],
    implementation: [
      { file: 'src/auth.ts', line: 14, severity: 'critical', title: 'Missing tenant check before cache lookup', bugClass: 'tenant-cache', description: 'A much longer description.', badCode: 'cache.get(tenant, key)', fix: 'Scope key by tenant', verificationStatus: 'verified', verifierReasoning: 'Observed runtime path.', otherInstances: ['src/second.ts:4'], agreedBy: ['also-forged'] },
    ],
  })
  const before = f.dimensions.map(item => readFileSync(join(f.dir, item.path), 'utf8'))
  const result = spawnSync('node', [cli, '--manifest', f.manifestPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const findings = JSON.parse(result.stdout).findings
  const merged = findings.find(item => item.file === 'src/auth.ts' && item.bugClass === 'tenant-cache')
  assert.deepEqual([merged.severity, merged.description, merged.badCode, merged.fix, merged.verificationStatus], ['critical', 'A much longer description.', 'cache.get(tenant, key)', 'Scope key by tenant', 'verified'])
  assert.deepEqual([merged._dimension, merged.marker, merged.agreedBy, merged.otherInstances], ['quality', 'kept', ['quality', 'implementation'], ['src/other.ts:3', 'src/second.ts:4']])
  assert.deepEqual(findings.filter(item => item.file === 'src/auth.ts').map(item => item.bugClass), ['tenant-cache', 'different-class'])
  assert.deepEqual(findings.filter(item => item.file === 'src/span.ts').map(item => item.line), [1, 33])
  assert.deepEqual(findings.find(item => item.file === 'src/unique.ts').nested, { keep: true })
  assert.deepEqual(f.dimensions.map(item => readFileSync(join(f.dir, item.path), 'utf8')), before)
})

test('CLI rejects missing, malformed, duplicate, or invalid findings instead of emitting empty success', t => {
  const dir = mkdtempSync(join(tmpdir(), 'native-dedup-invalid-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const invoke = value => {
    const path = join(dir, 'manifest.json')
    writeFileSync(path, JSON.stringify(value))
    return spawnSync('node', [cli, '--manifest', path], { encoding: 'utf8' })
  }
  assert.equal(spawnSync('node', [cli], { encoding: 'utf8' }).status, 2)
  for (const value of [
    { dimensions: [] },
    { dimensions: [{ name: 'quality', path: 'missing.json' }] },
    { dimensions: [{ name: 'quality', path: 'bad.json' }] },
    { dimensions: [{ name: 'quality', path: 'null.json' }] },
    { dimensions: [{ name: 'quality', path: 'good.json' }, { name: 'quality', path: 'good.json' }] },
  ]) {
    writeFileSync(join(dir, 'bad.json'), '{')
    writeFileSync(join(dir, 'null.json'), JSON.stringify({ findings: [null] }))
    writeFileSync(join(dir, 'good.json'), JSON.stringify({ findings: [] }))
    const result = invoke(value)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /native-dedup:/)
  }
})
