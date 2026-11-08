import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { fitComponent, generateBoundaryCases } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-cases.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')

test('seeded boundary cases are repeatable, hashed, and cover both alphabets', () => {
  const options = { seed: 19, limit: 24, prefix: 'p:', suffix: ':s', count: 12 }
  const first = generateBoundaryCases(options), second = generateBoundaryCases(options)
  assert.deepEqual(first, second)
  assert.ok(first.some(row => row.kind === 'ascii'))
  assert.ok(first.some(row => row.kind === 'multibyte'))
  for (const row of first) {
    assert.equal(row.inputSha256, hash(row.input))
    assert.ok(Buffer.byteLength(row.component) <= options.limit)
  }
})

test('component fitting preserves affixes and rejects affixes that exceed the byte budget', () => {
  assert.deepEqual(fitComponent('pre', 'é界z', 'end', 10), { status: 'available', value: 'preéend', bytes: 8 })
  assert.deepEqual(fitComponent('éé', 'abc', '界界', 8), { status: 'rejected', value: null, bytes: 10 })
  const fitted = fitComponent('', '🙂🙂', '', 5)
  assert.equal(fitted.value, '🙂'); assert.equal(fitted.bytes, 4)
})

test('UTF-8 byte budget rejects character-count truncation that overflows', () => {
  const input = `${'x'.repeat(254)}é`
  const characterBounded = input.slice(0, 255)
  assert.ok(characterBounded.length <= 255 && Buffer.byteLength(characterBounded) > 255)
  const byteBounded = fitComponent('', input, '', 255)
  assert.equal(byteBounded.status, 'available')
  assert.ok(Buffer.byteLength(byteBounded.value) <= 255)
  assert.equal(hash(byteBounded.value), hash('x'.repeat(254)))
})
