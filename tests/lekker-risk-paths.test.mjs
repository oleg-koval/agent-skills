import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test('full-word and camel-case auth paths escalate without matching authors', () => {
  for (const path of ['src/authentication/index.ts', 'src/authorization.ts', 'src/authenticate.ts', 'src/authorize.ts', 'src/authService.ts', 'src/sessionStore.ts', 'src/permissionGuard.ts']) {
    assert.deepEqual(cats([path]), ['auth'], path)
  }
  assert.deepEqual(cats(['src/authors.ts']), [])
})

test('extensionless and Windows installers escalate', () => {
  for (const path of ['install', 'scripts/setup', 'scripts/install.bat', 'setup.cmd', 'scripts/bootstrap-linux']) {
    assert.deepEqual(cats([path]), ['installer'], path)
  }
  assert.deepEqual(cats(['docs/setup.md']), [])
})

const riskScript = 'plugins/olko-github-pr/skills/lekker-review/scripts/risk-paths.mjs'
const runCli = (args, input = '') => JSON.parse(execFileSync('node', [riskScript, ...args], { input, encoding: 'utf8' }))

test('separator keeps option-like and shell-special filenames literal', () => {
  const paths = ['--stdin', '--stdin0', '--diff', 'src/auth/$(echo injected);`id`.ts']
  const result = runCli(['--', ...paths])
  assert.equal(result.deep, true)
  assert.deepEqual(result.categories[0].files, [paths[3]])
})

test('NUL stdin preserves newline and whitespace in filenames', () => {
  const path = 'src/auth/ spaced\nname.ts '
  const result = runCli(['--stdin0'], ['--stdin', path, '--diff'].join('\0') + '\0')
  assert.deepEqual(result.categories[0].files, [path])
})

test('legacy newline stdin still works', () => {
  assert.equal(runCli(['--stdin'], 'src/auth/token.ts\n').deep, true)
})

test('invalid CLI options fail instead of reporting no risk', () => {
  for (const args of [['--unknown'], ['--diff'], ['--stdin', '--', 'src/auth/token.ts']]) {
    assert.throws(() => execFileSync('node', [riskScript, ...args], { input: '', stdio: 'pipe' }))
  }
})


test('CLI classifies P21 additions with a fetched diff and literal options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'risk-paths-'))
  try {
    const diff = join(dir, 'pr.diff')
    writeFileSync(diff, '+++ b/src/handler.ts\n+const payload = p21(order)\n')
    assert.deepEqual(runCli(['--diff', diff, '--', '--stdin', 'src/handler.ts']).categories.map(c => c.category), ['p21'])
    assert.deepEqual(runCli(['--stdin0', '--diff', diff], 'src/handler.ts\0').categories.map(c => c.category), ['p21'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
