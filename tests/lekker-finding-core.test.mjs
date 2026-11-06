import assert from 'node:assert/strict'
import test from 'node:test'

import { anchor } from '../plugins/olko-github-pr/skills/lekker-review/scripts/finding-core.mjs'

test('anchor leaves findings unchecked when bad code or line is unusable', () => {
  const finding = { line: 2, badCode: '' }
  assert.deepEqual(anchor(finding, ['one', 'two']), { finding, outcome: 'unchecked' })
  assert.deepEqual(anchor({ ...finding, badCode: 'one', line: null }, ['one']), {
    finding: { ...finding, badCode: 'one', line: null }, outcome: 'unchecked',
  })
})

test('anchor keeps nearby code and uniquely remaps code elsewhere', () => {
  const lines = ['first', 'second', 'target statement', 'last']
  const nearby = { line: 1, badCode: 'target statement' }
  assert.deepEqual(anchor(nearby, lines), { finding: nearby, outcome: 'kept' })

  const distant = { line: 12, badCode: 'target statement' }
  assert.deepEqual(anchor(distant, lines), {
    finding: { ...distant, line: 3, originalLine: 12, lineRemapped: true }, outcome: 'remapped',
  })
})

test('anchor nulls missing code and flags multiple distant matches as ambiguous', () => {
  const missing = { line: 12, badCode: 'absent statement' }
  assert.deepEqual(anchor(missing, ['first', 'second']), {
    finding: { ...missing, line: null, originalLine: 12 }, outcome: 'nulled',
  })

  const ambiguous = { line: 12, badCode: 'target statement' }
  assert.deepEqual(anchor(ambiguous, ['target statement', 'other', 'target statement']), {
    finding: { ...ambiguous, lineAmbiguous: true }, outcome: 'ambiguous',
  })
})

test('anchor accepts diff markers and long substrings without mutating findings', () => {
  const finding = Object.freeze({ line: 1, badCode: '+ target statement' })
  assert.deepEqual(anchor(finding, ['prefix target statement suffix']), {
    finding, outcome: 'kept',
  })
})
