import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

import { riskPaths } from '../plugins/olko-github-pr/skills/lekker-review/scripts/risk-paths.mjs'

const cats = (files, diff) => riskPaths(files, diff).categories.map((c) => c.category)

test('risky paths escalate to deep with a human-review marker', () => {
  assert.deepEqual(cats(['.github/workflows/ci.yml']), ['ci-workflow'])
  assert.deepEqual(cats(['src/auth/token.ts']), ['auth'])
  assert.deepEqual(cats(['src/session-store.ts']), ['auth'])
  assert.deepEqual(cats(['web/billing/invoice.ts']), ['billing'])
  assert.deepEqual(cats(['scripts/install.sh']), ['installer'])
  assert.deepEqual(cats(['src/p21/mapping.ts']), ['p21'])
  const r = riskPaths(['src/auth/token.ts'])
  assert.equal(r.deep, true)
  assert.equal(r.needsHumanReview, true)
})

test('ordinary paths stay on size-based depth', () => {
  const r = riskPaths(['src/components/Button.tsx', 'README.md', 'src/authors.ts'])
  assert.equal(r.deep, false)
  assert.deepEqual(r.categories, [])
})

test('p21 identifier in added lines counts, in removed or context lines it does not', () => {
  assert.deepEqual(cats(['src/orders.ts'], '+++ b/src/orders.ts\n+const payload = buildP21Payload(o)'), ['p21'])
  assert.deepEqual(cats(['src/orders.ts'], '-const p21 = 1\n const p21 = 2'), [])
})

test('cli reads file arguments', () => {
  const out = JSON.parse(execFileSync('node',
    ['plugins/olko-github-pr/skills/lekker-review/scripts/risk-paths.mjs', '.github/workflows/x.yml'], { encoding: 'utf8' }))
  assert.equal(out.deep, true)
})
