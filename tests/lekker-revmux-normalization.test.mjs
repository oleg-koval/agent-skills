import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'
import { bugClassOf, extractBadCode, mapSeverity } from '../plugins/olko-github-pr/skills/lekker-review/scripts/revmux-normalization.mjs'

test('revmux severity mapping preserves the existing lens rules', () => {
  assert.equal(mapSeverity({ severity: 'critical' }), 'critical')
  assert.equal(mapSeverity({ severity: 'major' }), 'important')
  assert.equal(mapSeverity({ severity: 'minor', lenses: ['lekker-conventions'] }), 'idiomatic')
  assert.equal(mapSeverity({ severity: 'minor', lenses: ['lekker-quality'] }), 'observation')
  assert.equal(mapSeverity({ severity: 'unknown' }), 'observation')
})

test('bug class uses the rule or title fallback and at most six words', () => {
  assert.equal(bugClassOf('TS-1', 'Ignored title'), 'ts-1')
  assert.equal(bugClassOf('', 'Title fallback works'), 'title-fallback-works')
  assert.equal(bugClassOf('', 'One two three four five six seven'), 'one-two-three-four-five-six')
  assert.equal(bugClassOf('', ''), 'unclassified')
})

test('bad code extraction preserves inline, dash, and empty cases', () => {
  assert.equal(extractBadCode('Use `unsafeCast(x)` here'), 'unsafeCast(x)')
  assert.equal(extractBadCode('Avoid this -- unsafeCast(x)\nMore text'), 'unsafeCast(x)')
  assert.equal(extractBadCode('Inline `first` before -- second'), 'first')
  assert.equal(extractBadCode('No code snippet'), '')
  assert.equal(extractBadCode(''), '')
})

test('fixture adapter output matches the pre-extraction baseline exactly', () => {
  const skill = join(process.cwd(), 'plugins/olko-github-pr/skills/lekker-review')
  const output = execFileSync('node', [
    join(skill, 'scripts/revmux-adapter.mjs'),
    join(skill, 'scripts/fixtures/revmux-report.json'),
    '--pricing', join(skill, 'references/pricing.json'),
    '--context', join(skill, 'scripts/fixtures/context.json'),
  ])
  assert.equal(createHash('sha256').update(output).digest('hex'), 'e8474938633f7c3733a283612e801792c30ad62e4f7a4fa060320929e710851b')
})
