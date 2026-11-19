import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  stateRoot,
  projectSlug,
  runId,
  newRun,
  latestRun,
  history,
  summarizeRun,
  historyMarkdown,
} from '../plugins/olko-reflection/skills/self-critique/scripts/run-store.mjs'

const script = fileURLToPath(new URL('../plugins/olko-reflection/skills/self-critique/scripts/run-store.mjs', import.meta.url))

const claim = (id, lb, status) => ({
  id, text: `claim ${id}`, load_bearing: lb, origin: 'both', status,
  checked_by: status === 'inferred' ? 'inferred' : 'read', receipt: 'file:1',
})
const ledger = (...claims) => ({ version: 1, claims, missed: [] })
const root = () => mkdtempSync(join(tmpdir(), 'run-store-'))
const at = (iso) => new Date(`${iso}Z`)
const writeLedger = (dir, n, value) => writeFileSync(join(dir, `ledger-v${n}.json`), JSON.stringify(value))

test('stateRoot prefers SELF_CRITIQUE_STATE_DIR, then XDG_STATE_HOME, then ~/.local/state', () => {
  assert.equal(stateRoot({ SELF_CRITIQUE_STATE_DIR: '/a', XDG_STATE_HOME: '/b' }), '/a')
  assert.equal(stateRoot({ XDG_STATE_HOME: '/b' }), '/b/self-critique')
  assert.equal(stateRoot({}), join(homedir(), '.local', 'state', 'self-critique'))
})

test('projectSlug and runId are filesystem-safe', () => {
  assert.match(projectSlug('/Users/me/code/agent skills'), /^Users-me-code-agent-skills-[0-9a-f]{8}$/)
  assert.match(projectSlug('/'), /^root-[0-9a-f]{8}$/)
  assert.equal(projectSlug('/work/foo'), projectSlug('/work/foo'))
  assert.notEqual(projectSlug('/work/foo-bar'), projectSlug('/work/foo/bar'))
  assert.equal(runId(at('2026-11-19T21:09:27.123')), '2026-11-19T21-09-27')
})

test('newRun creates a private dated folder with run.json outside the repo', () => {
  const r = root()
  const dir = newRun({ root: r, cwd: '/work/proj', now: at('2026-11-19T21:09:27') })
  assert.equal(dir, join(r, projectSlug('/work/proj'), '2026-11-19T21-09-27'))
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), { project: '/work/proj', started: '2026-11-19T21:09:27.000Z' })
})

test('newRun never reuses a folder within the same second', () => {
  const r = root()
  const now = at('2026-11-19T21:09:27')
  const names = [1, 2, 3].map(() => basename(newRun({ root: r, cwd: '/p', now })))
  assert.deepEqual(names, ['2026-11-19T21-09-27', '2026-11-19T21-09-27-1', '2026-11-19T21-09-27-2'])
})

test('latestRun returns the newest run, null when there are none, and ignores strays', () => {
  const r = root()
  assert.equal(latestRun({ root: r, cwd: '/p' }), null)
  newRun({ root: r, cwd: '/p', now: at('2026-11-19T21:09:27') })
  const second = newRun({ root: r, cwd: '/p', now: at('2026-11-20T08:00:00') })
  mkdirSync(join(r, projectSlug('/p'), 'not-a-run'))
  assert.equal(latestRun({ root: r, cwd: '/p' }), second)
  assert.equal(latestRun({ root: r, cwd: '/other' }), null)
})

test('summarizeRun computes first-answer score, final score and open load-bearing from the ledgers', () => {
  const dir = newRun({ root: root(), cwd: '/p', now: at('2026-11-19T21:09:27') })
  assert.deepEqual(summarizeRun(dir), { rounds: 0 })
  writeLedger(dir, 1, ledger(claim('c1', true, 'refuted'), claim('c2', false, 'verified')))
  assert.deepEqual(summarizeRun(dir), { rounds: 1, first_score: 75, final_score: 75, open_load_bearing: 1 })
  writeLedger(dir, 2, ledger(claim('c1', true, 'verified'), claim('c2', false, 'verified')))
  assert.deepEqual(summarizeRun(dir), { rounds: 2, first_score: 75, final_score: 100, open_load_bearing: 0 })
})

test('summarizeRun orders ledgers numerically, so v10 follows v9 (lexically v10 would come first)', () => {
  const dir = newRun({ root: root(), cwd: '/p', now: at('2026-11-19T21:09:27') })
  writeLedger(dir, 10, ledger(claim('c1', true, 'verified')))
  writeLedger(dir, 9, ledger(claim('c1', true, 'refuted')))
  assert.deepEqual(summarizeRun(dir), { rounds: 2, first_score: 75, final_score: 100, open_load_bearing: 0 })
})

test('summarizeRun flags an unreadable or invalid ledger instead of throwing', () => {
  const dir = newRun({ root: root(), cwd: '/p', now: at('2026-11-19T21:09:27') })
  writeFileSync(join(dir, 'ledger-v1.json'), '{not json')
  assert.deepEqual(summarizeRun(dir), { rounds: 1, invalid: true })
})

test('history lists the newest runs in order and renders a markdown table', () => {
  const r = root()
  const first = newRun({ root: r, cwd: '/p', now: at('2026-11-19T21:09:27') })
  writeLedger(first, 1, ledger(claim('c1', true, 'refuted')))
  const second = newRun({ root: r, cwd: '/p', now: at('2026-11-20T08:00:00') })
  writeLedger(second, 1, ledger(claim('c1', true, 'verified')))
  newRun({ root: r, cwd: '/p', now: at('2026-11-21T08:00:00') })
  assert.deepEqual(history({ root: r, cwd: '/p', limit: 2 }).map((h) => h.run), ['2026-11-20T08-00-00', '2026-11-21T08-00-00'])
  const table = historyMarkdown(history({ root: r, cwd: '/p' }))
  assert.match(table, /\| 2026-11-19T21-09-27 \| 1 \| 75 \| 75 \| 1 \|/)
  assert.match(table, /\| 2026-11-21T08-00-00 \| 0 \| - \| - \| - \|/)
})

test('cli new, latest and history work against SELF_CRITIQUE_STATE_DIR', () => {
  const r = root()
  const env = { ...process.env, SELF_CRITIQUE_STATE_DIR: r }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
  const none = run('latest', '--cwd', '/p')
  assert.equal(none.status, 2)
  const created = run('new', '--cwd', '/p')
  assert.equal(created.status, 0, created.stderr)
  const dir = created.stdout.trim()
  assert.ok(dir.startsWith(r) && existsSync(join(dir, 'run.json')))
  assert.equal(run('latest', '--cwd', '/p').stdout.trim(), dir)
  assert.match(run('history', '--cwd', '/p').stdout, /\| run \| rounds \| first-answer score/)
  assert.equal(run('new').status, 2)
  assert.equal(run('bogus', '--cwd', '/p').status, 2)
})

test('runs with the same timestamp sort by numeric suffix, so -2 comes before -10', () => {
  const r = root()
  const project = join(r, projectSlug('/p'))
  const names = ['2026-11-19T21-09-27-10', '2026-11-19T21-09-27-2', '2026-11-19T21-09-27', '2026-11-19T21-09-26-3']
  for (const n of names) mkdirSync(join(project, n), { recursive: true })
  assert.deepEqual(history({ root: r, cwd: '/p' }).map((h) => h.run), [
    '2026-11-19T21-09-26-3', '2026-11-19T21-09-27', '2026-11-19T21-09-27-2', '2026-11-19T21-09-27-10',
  ])
  assert.equal(latestRun({ root: r, cwd: '/p' }), join(project, '2026-11-19T21-09-27-10'))
})
