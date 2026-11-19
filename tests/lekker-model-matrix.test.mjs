import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

import {
  FAST_MODELS, GATE_ROLES, HOSTS, MATRIX, TIERS, isVisual, routingFor, tierFor,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/model-matrix.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/model-matrix.mjs'

test('tier follows the riskiest signal', () => {
  assert.equal(tierFor({ files: ['src/a.ts'], categories: ['auth', 'ci-workflow'] }).tier, 'critical')
  assert.equal(tierFor({ files: ['src/a.ts'], categories: ['billing'] }).tier, 'critical')
  assert.equal(tierFor({ files: ['.github/workflows/ci.yml'], categories: ['ci-workflow'] }).tier, 'elevated')
  assert.equal(tierFor({ files: ['db/migrations/001.ts'] }).tier, 'elevated')
  assert.equal(tierFor({ files: ['schema.sql'] }).tier, 'elevated')
  assert.equal(tierFor({ files: ['src/a.ts'], lines: 801 }).tier, 'elevated')
  assert.equal(tierFor({ files: Array.from({ length: 26 }, (_, i) => `src/f${i}.ts`) }).tier, 'elevated')
  assert.equal(tierFor({ files: ['src/a.ts'], lines: 40 }).tier, 'standard')
})

test('routine only when every file is documentation', () => {
  assert.equal(tierFor({ files: ['README.md', 'docs/setup.txt', 'LICENSE'] }).tier, 'routine')
  assert.equal(tierFor({ files: ['README.md', 'src/a.ts'] }).tier, 'standard')
  assert.equal(tierFor({ files: [] }).tier, 'standard')
})

test('an unknown risk category never sets a tier', () => {
  assert.equal(tierFor({ files: ['src/erp-sync.ts'], categories: ['custom'] }).tier, 'standard')
})

test('--risk overrides the detected tier and rejects unknown values', () => {
  const t = tierFor({ files: ['README.md'], categories: ['auth'], override: 'elevated' })
  assert.deepEqual([t.tier, t.tierSource], ['elevated', 'override'])
  assert.throws(() => tierFor({ override: 'extreme' }), /unknown risk tier/)
})

test('every host, tier and role resolves to a model and a valid effort', () => {
  for (const host of HOSTS) {
    for (const tier of TIERS) {
      for (const [role, cell] of Object.entries(routingFor(host, tier))) {
        assert.ok(typeof cell.model === 'string' && cell.model.length > 0, `${host} ${tier} ${role}`)
        assert.ok(['low', 'medium', 'high', 'xhigh', 'max'].includes(cell.effort), `${host} ${tier} ${role}`)
      }
    }
  }
})

test('both hosts carry the same roles', () => {
  assert.deepEqual(Object.keys(MATRIX.codex).sort(), Object.keys(MATRIX.claude).sort())
})

test('a fast model never acts as the gate', () => {
  for (const host of HOSTS) {
    for (const tier of TIERS) {
      const routing = routingFor(host, tier)
      for (const role of [...GATE_ROLES, 'specialist']) {
        assert.ok(!FAST_MODELS.includes(routing[role].model), `${host} ${tier} ${role}`)
      }
    }
  }
})

test('the gate is never weaker than the finders it checks', () => {
  const rank = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }
  for (const tier of TIERS) {
    const r = routingFor('claude', tier)
    assert.ok(rank[r.verifier.model] >= rank[r.specialist.model], tier)
  }
})

test('effort rises before model size', () => {
  const r = tier => routingFor('claude', tier).specialist
  assert.deepEqual([r('routine'), r('standard')], [{ model: 'sonnet', effort: 'medium' }, { model: 'sonnet', effort: 'high' }])
})

test('a UI-only diff routes Codex specialists to the visual model, Claude unchanged', () => {
  assert.equal(isVisual(['src/Button.tsx', 'src/button.css', 'src/Button.test.tsx']), true)
  assert.equal(isVisual(['src/Button.tsx', 'src/api.ts']), false)
  assert.equal(isVisual(['README.md']), false)
  assert.equal(routingFor('codex', 'standard', { visual: true }).specialist.model, 'gpt-6.1-terra')
  assert.equal(routingFor('claude', 'standard', { visual: true }).specialist.model, 'sonnet')
})

test('cli prints the tier and routing, and fails on a bad host', () => {
  const out = JSON.parse(execFileSync('node', [script, '--host', 'claude', '--lines', '30', '--categories', 'auth', '--', 'src/auth/session.ts'], { encoding: 'utf8' }))
  assert.equal(out.tier, 'critical')
  assert.equal(out.routing.verifier.model, 'fable')
  assert.throws(() => execFileSync('node', [script, '--host', 'gemini', '--', 'a.ts'], { stdio: 'pipe' }))
})

test('the README matrix matches the data', async () => {
  const { readFileSync } = await import('node:fs')
  const { matrixMarkdown } = await import('../plugins/olko-github-pr/skills/lekker-review/scripts/model-matrix.mjs')
  const readme = readFileSync('plugins/olko-github-pr/skills/lekker-review/README.md', 'utf8')
  assert.ok(readme.includes(matrixMarkdown()), 'README table is stale: paste matrixMarkdown() output into README.md')
})

test('--crossvendor moves only the gate roles to the other host, same tier, and keeps the host route', () => {
  for (const [host, other] of [['claude', 'codex'], ['codex', 'claude']]) {
    for (const tier of TIERS) {
      const plain = routingFor(host, tier)
      const crossed = routingFor(host, tier, { crossvendor: true })
      for (const role of Object.keys(plain)) {
        if (!GATE_ROLES.includes(role)) {
          assert.deepEqual(crossed[role], plain[role], `${host} ${tier} ${role}`)
          continue
        }
        const column = TIERS.indexOf(tier)
        assert.deepEqual(crossed[role], { ...MATRIX[other][role][column], vendor: other, hostRoute: plain[role] }, `${host} ${tier} ${role}`)
      }
    }
  }
  assert.equal(routingFor('claude', 'critical', { crossvendor: true }).verifier.model, 'gpt-6.2-astra')
  assert.equal(routingFor('codex', 'standard', { crossvendor: true }).critic.model, 'sonnet')
})

test('cli --crossvendor adds vendor to the gate roles; without the flag the output has none', () => {
  const run = flags => JSON.parse(execFileSync('node', [script, '--host', 'claude', ...flags, '--', 'src/a.ts'], { encoding: 'utf8' }))
  const crossed = run(['--crossvendor'])
  assert.equal(crossed.crossvendor, true)
  assert.deepEqual(Object.entries(crossed.routing).filter(([, c]) => c.vendor).map(([role]) => role), GATE_ROLES)
  const plain = run([])
  assert.equal('crossvendor' in plain, false)
  assert.ok(Object.values(plain.routing).every(c => c.vendor === undefined))
})
