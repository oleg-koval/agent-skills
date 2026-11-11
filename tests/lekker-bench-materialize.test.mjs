import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildContext, cloneSteps, parseChangedPaths } from '../plugins/olko-github-pr/skills/lekker-review/scripts/bench-materialize.mjs'

const bench = 'plugins/olko-github-pr/skills/lekker-review/evals/bench'
const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/bench-materialize.mjs'
const corpus = JSON.parse(readFileSync(join(bench, 'corpus.json'), 'utf8'))

function run(caseId) {
  const out = mkdtempSync(join(tmpdir(), 'bench-mat-'))
  const stdout = execFileSync('node', [cli, '--corpus', join(bench, 'corpus.json'), '--case', caseId, '--out', out], { encoding: 'utf8' })
  return { out, printed: JSON.parse(stdout) }
}

test('parseChangedPaths handles edits, deletions and renames', () => {
  const diff = [
    'diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1 +1 @@',
    'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null',
    'diff --git a/o.js b/n.js', 'rename from o.js', 'rename to n.js',
  ].join('\n')
  assert.deepEqual(parseChangedPaths(diff), ['x.js', 'gone.js', 'n.js'])
  assert.deepEqual(parseChangedPaths(''), [])
})

test('buildContext nulls optional keys and keeps the changed paths', () => {
  const ctx = buildContext(['a.js'], 'bench case x')
  assert.deepEqual(ctx.changedPaths, ['a.js'])
  assert.equal(ctx.projectRules, null)
  assert.equal(ctx.ciStatus, null)
  assert.equal(ctx.reviewTarget, 'bench case x')
})

test('cloneSteps detaches before removing the remote and applies last', () => {
  const steps = cloneSteps('/src', '/dst', 'abc', '/p.patch')
  assert.deepEqual(steps.map((s) => s.filter((a) => ['clone', 'checkout', 'remote', 'apply'].includes(a))[0]), ['clone', 'checkout', 'remote', 'apply'])
  assert.ok(steps[0].includes('--no-hardlinks'))
})

for (const [caseId, expectedPaths] of [
  ['cart-loop-control', ['src/cart.js']],
  ['discount-cap-units', ['src/checkout.js', 'src/discount.js']],
  ['page-offset', ['src/paginate.js']],
]) {
  test(`the CLI materializes ${caseId}`, () => {
    const c = corpus.cases.find((x) => x.id === caseId)
    const { out, printed } = run(caseId)
    try {
      const patchBytes = readFileSync(join(bench, c.patch))
      assert.ok(patchBytes.equals(readFileSync(join(out, 'pr.diff'))))
      assert.equal(execFileSync('git', ['-C', join(out, 'repo'), 'remote'], { encoding: 'utf8' }), '')
      assert.deepEqual(JSON.parse(readFileSync(join(out, 'context.json'), 'utf8')).changedPaths, expectedPaths)
      const worktree = JSON.parse(readFileSync(join(out, 'worktree.json'), 'utf8'))
      assert.match(worktree.headSha, /^[0-9a-f]{40}$/)
      assert.equal(worktree.path, join(out, 'repo'))
      assert.equal(worktree.baseRef, 'HEAD')
      assert.equal(printed.out, out)
      const status = execFileSync('git', ['-C', join(out, 'repo'), 'status', '--porcelain'], { encoding: 'utf8' })
      assert.equal(status.split('\n').filter(Boolean).length, expectedPaths.length)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
}

test('an unknown case id fails with a message and exit code 1', () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-mat-'))
  try {
    assert.throws(() => execFileSync('node', [cli, '--corpus', join(bench, 'corpus.json'), '--case', 'nope', '--out', out], { stdio: 'pipe' }), (e) => e.status === 1 && /no case nope/.test(String(e.stderr)))
    assert.deepEqual(readdirSync(out), [])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
