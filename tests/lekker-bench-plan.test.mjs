import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { buildRows, mulberry32, parseArgs, sanitizeRef, shuffle } from '../plugins/olko-github-pr/skills/lekker-review/scripts/bench-plan.mjs'

const skill = 'plugins/olko-github-pr/skills/lekker-review'
const cli = `${skill}/scripts/bench-plan.mjs`
const corpusFile = `${skill}/evals/bench/corpus.json`
const arms = [{ ref: 'v1.63.0', sha: 'a', scriptPath: '/a/workflow.js', promptDir: '/a/agents' }, { ref: 'feat/x', sha: 'b', scriptPath: '/b/workflow.js', promptDir: '/b/agents' }]
const cases = [{ id: 'one' }, { id: 'two', depths: ['scan'] }, { id: 'three', depths: ['scan', 'medium'] }]

test('parseArgs reads flags, applies defaults and rejects bad input', () => {
  const parsed = parseArgs(['--arms', 'a, b', '--corpus', 'c.json', '--out', 'o', '--repeats', '3', '--seed', '7'])
  assert.deepEqual(parsed, { arms: ['a', 'b'], corpus: 'c.json', out: 'o', depth: 'medium', seed: 7, repeats: 3 })
  assert.throws(() => parseArgs(['--arms', 'a']), /required/)
  assert.throws(() => parseArgs(['--arms', 'a', '--corpus', 'c', '--out', 'o', '--repeats', '0']), /positive/)
  assert.throws(() => parseArgs(['--arms', 'a', '--corpus', 'c', '--out', 'o', '--depth', 'huge']), /depth/)
})

test('mulberry32 is deterministic and in [0, 1)', () => {
  assert.equal(mulberry32(5).at(3), mulberry32(5).at(3))
  assert.notEqual(mulberry32(5).at(3), mulberry32(6).at(3))
  assert.ok([1, 2, 3, 4].every((n) => mulberry32(9).at(n) >= 0 && mulberry32(9).at(n) < 1))
})

test('shuffle is seeded, differs across seeds and never mutates its input', () => {
  const input = Array.from({ length: 20 }, (_, i) => i)
  const copy = [...input]
  assert.deepEqual(shuffle(input, 1), shuffle(input, 1))
  assert.notDeepEqual(shuffle(input, 1), shuffle(input, 2))
  assert.deepEqual(input, copy)
  assert.deepEqual([...shuffle(input, 1)].sort((a, b) => a - b), input)
})

test('buildRows makes arm x case x repeat rows and honours the depth filter', () => {
  const rows = buildRows(arms, cases, 3, 'medium', 1, '/out')
  assert.equal(rows.length, 2 * 2 * 3)
  assert.ok(rows.every((r) => r.caseId !== 'two'))
  assert.equal(buildRows(arms, cases, 2, 'scan', 1, '/out').length, 2 * 2 * 2)
  assert.deepEqual(rows, buildRows(arms, cases, 3, 'medium', 1, '/out'))
  const row = rows.find((r) => r.arm === 'feat_x' && r.caseId === 'one' && r.repeat === 2)
  assert.equal(row.resultPath, '/out/results/feat_x/one/2.json')
  assert.equal(row.sha, 'b')
  assert.equal(row.scriptPath, '/b/workflow.js')
  assert.deepEqual(row.args, {
    diffFile: '/out/cases/one/pr.diff', contextFile: '/out/cases/one/context.json', promptDir: '/b/agents',
    worktreePath: '/out/cases/one/repo', depth: 'medium', repoSlug: 'bench/bench', targetLabel: 'bench case one',
  })
})

test('sanitizeRef and colliding arm names', () => {
  assert.equal(sanitizeRef('origin/feat x'), 'origin_feat_x')
  assert.throws(() => buildRows([{ ref: 'a/b' }, { ref: 'a_b' }], cases, 1, 'medium', 1, '/o'), /collide/)
})

const tmp = mkdtempSync(join(tmpdir(), 'bench-plan-'))
const state = join(tmp, 'state')
const worktrees = []
after(() => {
  worktrees.forEach((dir) => execFileSync('git', ['worktree', 'remove', '--force', dir]))
  rmSync(tmp, { recursive: true, force: true })
})

test('CLI records each arm workflow.js hash from a real tag', () => {
  const out = join(tmp, 'out')
  const stdout = execFileSync('node', [cli, '--arms', 'v1.83.0,v1.84.0', '--corpus', corpusFile, '--repeats', '2', '--seed', '3', '--out', out], {
    encoding: 'utf8', env: { ...process.env, LEKKER_STATE_DIR: state },
  })
  const plan = JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'))
  plan.arms.forEach((arm) => worktrees.push(join(state, 'bench', 'arms', arm.sha)))
  assert.match(stdout, /^plan\.json: \d+ runs \(2 arms x \d+ cases x 2 repeats\)\n$/)
  assert.equal(plan.rows.length, plan.arms.length * plan.cases.length * 2)
  assert.ok(plan.cases.every((c) => c.materialize.includes(c.id)))
  plan.arms.forEach((arm) => {
    const bytes = execFileSync('git', ['show', `${arm.ref}:${skill}/workflow.js`], { maxBuffer: 1 << 26 })
    assert.equal(arm.workflowSha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(arm.sha, execFileSync('git', ['rev-parse', `${arm.ref}^{commit}`], { encoding: 'utf8' }).trim())
  })
  assert.ok(plan.rows.every((r) => r.scriptPath.startsWith(join(state, 'bench', 'arms', r.sha))))
})
