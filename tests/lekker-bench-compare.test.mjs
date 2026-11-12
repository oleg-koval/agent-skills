import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'

import { armSummary, compare, defaultWindow, extractFindings, flips, loadMatrix, pairedTable, renderReport, signTest, verdict, warnings } from '../plugins/olko-github-pr/skills/lekker-review/scripts/bench-compare.mjs'
import { score } from '../plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'

const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/bench-compare.mjs'
const tmp = mkdtempSync(join(tmpdir(), 'bench-compare-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const buggy = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
const caseIds = [...buggy, 'c1', 'c2']
const manifest = { prs: caseIds.map((id, i) => ({ id, repo: 'bench', pr: i + 1, expect: id.startsWith('b') ? 'buggy' : 'clean', ...(id.startsWith('b') ? { knownBug: `src/${id}.ts:10 bug` } : {}) })) }
const hit = (id, severity = 'critical') => ({ file: `src/${id}.ts`, line: 11, severity })
const planFor = (repeats, dir = tmp) => ({
  repeats,
  arms: [{ ref: 'base' }, { ref: 'next' }],
  cases: caseIds.map((id) => ({ id })),
  rows: ['base', 'next'].flatMap((arm) => caseIds.flatMap((caseId) => Array.from({ length: repeats }, (_, i) => (
    { arm, caseId, repeat: i + 1, resultPath: join(dir, 'results', arm, caseId, `${i + 1}.json`) })))),
})
// result for a run: findings are `hit` on buggy cases unless the arm misses them
const resultsFor = (misses) => (row) => {
  if (row.arm === 'next' && misses.includes(row.caseId)) return { findings: [] }
  return { findings: row.caseId.startsWith('b') ? [hit(row.caseId)] : [] }
}
const reader = (plan, produce) => {
  const byPath = new Map(plan.rows.map((row) => [row.resultPath, produce(row)]))
  return (path) => byPath.get(path) ?? null
}

test('extractFindings takes the findings key, a bare array, and rejects the rest', () => {
  assert.deepEqual(extractFindings({ findings: [{ file: 'a' }], agentCount: 3 }), [{ file: 'a' }])
  assert.deepEqual(extractFindings([{ file: 'a' }]), [{ file: 'a' }])
  assert.equal(extractFindings({ agentCount: 3 }), null)
  assert.equal(extractFindings(null), null)
})

test('defaultWindow is 3 for small files and LINE_WINDOW otherwise', () => {
  assert.equal(defaultWindow(true), 3)
  assert.equal(defaultWindow(false), 10)
})

test('signTest matches exact binomial values', () => {
  assert.equal(signTest(0, 4), 0.125)
  assert.equal(signTest(0, 6), 0.03125)
  assert.equal(signTest(3, 3), 1)
  assert.equal(signTest(0, 0), 1)
  assert.equal(signTest(5, 0), 0.0625)
})

test('loadMatrix groups runs per arm and case and lists missing runs, never zero', () => {
  const plan = planFor(2)
  const read = reader(plan, resultsFor([]))
  const gap = (path) => (path.endsWith('/next/b2/2.json') ? null : read(path))
  const { arms, missing } = loadMatrix(plan, gap)
  assert.deepEqual(missing, [{ arm: 'next', caseId: 'b2', repeat: 2 }])
  assert.equal(arms[1].results.b2.length, 1)
  assert.equal(arms[0].results.b2.length, 2)
  const scored = score(manifest, { ...arms[1].results, b2: undefined })
  assert.ok(scored.unscored.includes('b2'))
})

test('armSummary separates any-severity recall from critical/important recall', () => {
  const results = { ...Object.fromEntries(buggy.map((id) => [id, [[hit(id, 'minor')]]])), c1: [[{ file: 'x', line: 1, severity: 'important' }]], c2: [[]] }
  const summary = armSummary(score(manifest, results), manifest, results)
  assert.equal(summary.recall, 1)
  assert.equal(summary.blockingRecall, 0)
  assert.equal(summary.blockingPerCleanRun, 0.5)
})

test('pairedTable and flips compare hit rates per case', () => {
  const a = { 'b1': [[hit('b1')], [hit('b1')]], b2: [[hit('b2')], []], b3: [[], []] }
  const b = { 'b1': [[], []], b2: [[hit('b2')], []], b3: [[hit('b3')], []] }
  const m = { prs: manifest.prs.filter((e) => ['b1', 'b2', 'b3'].includes(e.id)) }
  const table = pairedTable(score(m, a), score(m, b))
  assert.deepEqual(table.map((r) => [r.key, r.a, r.b]), [['b1', 1, 0], ['b2', 0.5, 0.5], ['b3', 0, 0.5]])
  assert.equal(flips(table), 2)
})

test('arm B missing 4 of 6 buggy cases at 3 repeats is worse', () => {
  const plan = planFor(3)
  const report = compare({ plan, manifest, readResult: reader(plan, resultsFor(['b1', 'b2', 'b3', 'b4'])) })
  const [c] = report.comparisons
  assert.equal(c.verdict, 'worse')
  assert.deepEqual([c.wins, c.losses], [0, 12])
  assert.ok(report.complete)
  assert.match(renderReport(report), /verdict: worse/)
  assert.match(renderReport(report), /note: p counts runs as independent, so it is optimistic; confirm on the flipped cases/)
  assert.match(c.pNote, /optimistic/)
})

test('the same 4 of 6 at one repeat is not distinguishable (p = 0.125)', () => {
  const plan = planFor(1)
  const [c] = compare({ plan, manifest, readResult: reader(plan, resultsFor(['b1', 'b2', 'b3', 'b4'])) }).comparisons
  assert.equal(c.p, 0.125)
  assert.equal(c.verdict, 'not distinguishable at 1 repeats')
})

test('identical arms are not distinguishable and flip nothing', () => {
  const plan = planFor(3)
  const report = compare({ plan, manifest, readResult: reader(plan, resultsFor([])) })
  assert.equal(report.comparisons[0].verdict, 'not distinguishable at 3 repeats')
  assert.equal(report.comparisons[0].flips, 0)
})

test('verdict reports better only when recall rose and p is small', () => {
  assert.equal(verdict({ recall: 0.2 }, { recall: 0.9 }, 0.01), 'better')
  assert.equal(verdict({ recall: 0.9 }, { recall: 0.2 }, 0.2, 3), 'not distinguishable at 3 repeats')
  assert.equal(verdict({ recall: null }, { recall: 0.2 }, 0.01), 'not distinguishable at 1 repeats')
})

test('warnings fire when baseline recall is above 90% or below 20%', () => {
  assert.equal(warnings({ recall: 0.95 }).length, 1)
  assert.equal(warnings({ recall: 0.1 }).length, 1)
  assert.equal(warnings({ recall: 0.5 }).length, 0)
  const plan = planFor(1)
  assert.match(compare({ plan, manifest, readResult: reader(plan, resultsFor([])) }).warnings[0], /corpus cannot show a change/)
})

function writePlan(dir, drop) {
  const plan = planFor(1, dir)
  const corpus = { cases: manifest.prs.map((e) => ({ id: e.id, expect: e.expect, ...(e.knownBug ? { knownBug: e.knownBug } : {}), repo: 'r', baseRef: 'main', patch: 'p.diff' })) }
  const corpusPath = join(dir, 'corpus.json')
  writeFileSync(corpusPath, JSON.stringify(corpus))
  plan.rows.filter((row) => row.resultPath !== drop).forEach((row) => {
    mkdirSync(dirname(row.resultPath), { recursive: true })
    writeFileSync(row.resultPath, JSON.stringify(resultsFor([])(row)))
  })
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ ...plan, corpus: corpusPath }))
  return join(dir, 'plan.json')
}

test('CLI exits 0 on full coverage and prints json with --json', () => {
  const dir = mkdtempSync(join(tmp, 'ok-'))
  const run = spawnSync('node', [cli, '--plan', writePlan(dir), '--json', '--window', '3'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).complete, true)
})

test('CLI exits 1 and names the missing result when coverage is incomplete', () => {
  const dir = mkdtempSync(join(tmp, 'gap-'))
  const run = spawnSync('node', [cli, '--plan', writePlan(dir, join(dir, 'results', 'next', 'b3', '1.json'))], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stdout, /INCOMPLETE: 1 planned results missing/)
  assert.match(run.stdout, /next b3 repeat 1/)
})

test('CLI exits 1 with a message when --plan is missing', () => {
  const run = spawnSync('node', [cli], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /--plan is required/)
})
