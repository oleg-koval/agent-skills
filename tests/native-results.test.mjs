import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateNativeResult, normalizeNativeResult } from '../plugins/olko-github-pr/skills/lekker-review/scripts/native-results.mjs'

const finding = { file: 'src/a.ts', line: 4, severity: 'critical', title: 'Failure', description: 'Reachable failure',
  badCode: 'broken()', fix: 'working()', bugClass: 'missing-check', otherInstances: ['src/b.ts:9'],
  boundary: { entryPoint: 'route', consumer: 'response', transitions: ['read', 'write'],
    decisionPoint: 'authorize request', realizationPoint: 'write response', stateOwner: 'request handler', evidenceClass: 'runtime' } }
const check = (value, dimension = 'quality') => validateNativeResult(dimension, value).available
const one = value => ({ findings: [value] })

test('normalizes only unambiguous safe location objects and preserves raw findings', () => {
  const raw = one({ ...finding, otherInstances: [{ file: 'src/b.ts', line: 9 }] })
  const before = JSON.stringify(raw)
  const result = normalizeNativeResult('quality', raw)
  assert.equal(result.available, true)
  assert.deepEqual(result.document, one(finding))
  assert.equal(JSON.stringify(raw), before)
  for (const value of [{ file: '../a.ts', line: 1 }, { file: '/a.ts', line: 1 },
    { file: 'a.ts', line: '1' }, { file: 'a.ts', line: 0 }, { file: 'a.ts', line: 1, extra: true },
    { file: 'a.ts:2', line: 1 }, { file: 'a\nb.ts', line: 1 }, { file: 'a\0b.ts', line: 1 }]) {
    assert.equal(normalizeNativeResult('quality', one({ ...finding, otherInstances: [value] })).available, false)
  }
  assert.equal(normalizeNativeResult('quality', one({ ...finding, badCode: '' })).document, null)
})

test('CLI preserves bytes, materializes dedup input, and fails closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'normalize-native-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const input = join(dir, 'raw.json'), output = join(dir, 'normalized.json')
  const scripts = 'plugins/olko-github-pr/skills/lekker-review/scripts/'
  const invoke = () => spawnSync(process.execPath, [scripts + 'normalize-native-result.mjs', 'quality', input, output], { encoding: 'utf8' })
  const raw = JSON.stringify(one({ ...finding, otherInstances: [{ file: 'src/b.ts', line: 9 }] }), null, 2) + '\n'
  writeFileSync(input, raw)
  const result = invoke()
  assert.equal(result.status, 0, result.stdout)
  assert.equal(JSON.parse(result.stdout).rawSha256, createHash('sha256').update(raw).digest('hex'))
  assert.equal(readFileSync(input, 'utf8'), raw)
  const manifest = join(dir, 'manifest.json')
  writeFileSync(manifest, JSON.stringify({ dimensions: [{ name: 'quality', path: output }] }))
  const dedup = spawnSync(process.execPath, [scripts + 'native-dedup.mjs', '--manifest', manifest], { encoding: 'utf8' })
  assert.equal(dedup.status, 0, dedup.stderr)
  assert.deepEqual(JSON.parse(dedup.stdout).findings[0].otherInstances, ['src/b.ts:9'])
  assert.notEqual(invoke().status, 0) // Never overwrite an existing destination.
  for (const bytes of ['{', '{}', ' '.repeat(8 * 1024 * 1024 + 1)]) {
    writeFileSync(input, bytes)
    const rejected = invoke()
    assert.equal(rejected.status, 1)
    assert.equal(JSON.parse(rejected.stdout).available, false)
  }
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), one(finding))
})

test('valid empty and nonempty results are deterministic, open and unchanged', () => {
  for (const dimension of ['deps', 'triage-quality', 'triage-logic', 'quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules']) {
    for (const findings of [[], [finding]]) {
      const document = { findings, acCoverage: '', coverageVerdict: 'partial', mutationSlip: '', mockSmells: [], extra: 42 }
      const before = JSON.stringify(document)
      assert.deepEqual(validateNativeResult(dimension, document), { available: true, reason: null })
      assert.deepEqual(validateNativeResult(dimension, document), validateNativeResult(dimension, document))
      assert.equal(JSON.stringify(document), before)
    }
  }
  assert.equal(check(one({ ...finding, severity: 'observation', boundary: undefined })), false)
  const { boundary, ...withoutBoundary } = finding
  assert.equal(check(one({ ...withoutBoundary, severity: 'observation', badCode: '', fix: '' })), true)
  assert.equal(check(one({ ...withoutBoundary, severity: 'idiomatic', precedent: 'Existing convention' })), true)
})

test('malformed documents, findings and metadata stay unavailable', () => {
  for (const document of [null, [], 'json', {}, { findings: null }, { findings: {} }, { findings: Array(1) }, one(null), one([]), one({}),
    { findings: [], acCoverage: null }, { findings: [], mockSmells: [{}] }]) assert.equal(check(document), false)
  assert.equal(check({ findings: [] }, 'unknown'), false)
  for (const key of Object.keys(finding)) {
    const { [key]: removed, ...rest } = finding
    assert.equal(check(one(rest)), false, key)
  }
  for (const patch of [{ severity: 'major' }, { line: '4' }, { line: 1.5 }, { title: 4 }, { otherInstances: [4] },
    { otherInstances: ['../a.ts:3'] }, { otherInstances: ['C:/a.ts:3'] }, { otherInstances: ['/a.ts:3'] },
    { otherInstances: ['a\\b.ts:3'] }, { bugClass: 'Bad Class' }, { rule: '' }, { precedent: 4 },
    { badCode: '' }, { fix: ' ' }, { severity: 'idiomatic' }, { rule: 4 }, { otherInstances: Array(1) }, { boundary: null }, { boundary: {} },
    { boundary: { entryPoint: ' ', consumer: 'response' } }, { boundary: { entryPoint: 'route', consumer: 4 } },
    { boundary: { ...finding.boundary, transitions: [4] } }, { boundary: { ...finding.boundary, stateOwner: 4 } }]) {
    assert.equal(check(one({ ...finding, ...patch })), false, JSON.stringify(patch))
  }
  assert.equal(check({ findings: [] }, 'implementation'), false)
  assert.equal(check({ findings: [], acCoverage: 4 }, 'implementation'), false)
  for (const key of ['coverageVerdict', 'mutationSlip', 'mockSmells']) {
    const document = { findings: [], coverageVerdict: '', mutationSlip: '', mockSmells: [] }
    delete document[key]
    assert.equal(check(document, 'test-quality'), false, key)
  }
  assert.equal(check({ findings: [], mockSmells: [{ file: 'a.ts', line: 1, description: '', fix: '' }] }), true)
})

test('required fields track the trusted workflow schemas', () => {
  const source = readFileSync('plugins/olko-github-pr/skills/lekker-review/workflow.js', 'utf8')
  const schemas = new Function(source.slice(source.indexOf('const BOUNDARY_SCHEMA'), source.indexOf('const VERDICT_SCHEMA'))
    + '\nreturn { FINDINGS_SCHEMA, IMPLEMENTATION_SCHEMA, TEST_QUALITY_SCHEMA }')()
  for (const [dimension, schema] of [['quality', schemas.FINDINGS_SCHEMA], ['implementation', schemas.IMPLEMENTATION_SCHEMA], ['test-quality', schemas.TEST_QUALITY_SCHEMA]]) {
    const document = { findings: [finding], acCoverage: '', coverageVerdict: '', mutationSlip: '', mockSmells: [] }
    for (const key of schema.required) {
      const { [key]: removed, ...rest } = document
      assert.equal(check(rest, dimension), false, `${dimension}:${key}`)
    }
    for (const key of schema.properties.findings.items.required) {
      const { [key]: removed, ...rest } = finding
      assert.equal(check({ ...document, findings: [rest] }, dimension), false, key)
    }
  }
})

test('only schema rule exceptions bypass a blocking finding boundary', () => {
  const { boundary, ...withoutBoundary } = finding
  for (const severity of ['critical', 'important']) {
    for (const [rule, valid] of [['PROJECT:no-casts', true], ['weakens-project-rule', true], ['TS-1', false], ['PROJECT:', false]]) {
      assert.equal(check(one({ ...withoutBoundary, severity, rule })), valid)
    }
  }
})
