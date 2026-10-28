import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isHit, parseKnownBug, score, validateManifest } from '../plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'

const manifestPath = 'plugins/olko-github-pr/skills/lekker-review/evals/manifest.json'
const manifest = {
  prs: [
    { repo: 'o/r', pr: 1, expect: 'buggy', knownBug: 'src/a.ts:42 drops last item' },
    { repo: 'o/r', pr: 2, expect: 'buggy', knownBug: 'src/b.ts:7 wrong key' },
    { repo: 'o/r', pr: 3, expect: 'clean' },
    { repo: 'o/r', pr: 4, expect: 'clean' },
  ],
}

test('the shipped manifest is valid and holds two placeholders', () => {
  const shipped = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(validateManifest(shipped).length, 2)
})

test('knownBug parsing and hit window', () => {
  assert.deepEqual(parseKnownBug('src/a.ts:42 desc'), { file: 'src/a.ts', line: 42 })
  assert.equal(parseKnownBug('no location'), null)
  assert.equal(isHit([{ file: 'src/a.ts', line: 50 }], 'src/a.ts:42 x'), true)
  assert.equal(isHit([{ file: 'src/a.ts', line: 60 }], 'src/a.ts:42 x'), false)
  assert.equal(isHit([{ file: 'src/other.ts', line: 42 }], 'src/a.ts:42 x'), false)
})

test('recall, false positives and unscored PRs', () => {
  const out = score(manifest, {
    'o/r#1': [{ file: 'src/a.ts', line: 41, severity: 'critical' }],
    'o/r#2': [{ file: 'src/c.ts', line: 1, severity: 'critical' }],
    'o/r#3': [{ severity: 'important' }, { severity: 'critical' }, { severity: 'observation' }],
  })
  assert.equal(out.recall, 0.5)
  assert.equal(out.falsePositives, 2)
  assert.equal(out.cleanScored, 1)
  assert.deepEqual(out.unscored, ['o/r#4'])
})

test('a malformed manifest is rejected', () => {
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'maybe' }] }), /expect/)
  assert.throws(() => validateManifest({}), /prs/)
})

test('spaced paths, line 0 and null lines', () => {
  assert.deepEqual(parseKnownBug('src/my dir/a b.ts:42 desc'), { file: 'src/my dir/a b.ts', line: 42 })
  assert.equal(parseKnownBug('src/a.ts:0 desc'), null)
  assert.equal(isHit([{ file: 'src/a.ts', line: null }], 'src/a.ts:5 x'), false)
  assert.equal(isHit([{ file: 'src/a.ts', line: 0 }], 'src/a.ts:5 x'), false)
})

test('duplicate keys, missing knownBug and line 0 are rejected', () => {
  const dup = { prs: [{ repo: 'o/r', pr: 1, expect: 'clean' }, { repo: 'o/r', pr: 1, expect: 'clean' }] }
  assert.throws(() => validateManifest(dup), /duplicate/)
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'buggy' }] }), /knownBug/)
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'buggy', knownBug: 'a.ts:0 x' }] }), /knownBug/)
})
