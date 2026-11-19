#!/usr/bin/env node
// Per-run state for self-critique: one dated folder per run under a state dir, outside any repo.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { statusOf, validateLedger } from './claim-ledger.mjs'

const RUN_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?$/
const LEDGER_FILE = /^ledger-v(\d+)\.json$/

export const stateRoot = (env = process.env) =>
  env.SELF_CRITIQUE_STATE_DIR || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'self-critique')

// The digest keeps /work/foo-bar and /work/foo/bar apart; the readable part is only for humans.
export const projectSlug = (cwd) => {
  const readable = cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
  return `${readable}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`
}

export const runId = (date) => date.toISOString().slice(0, 19).replaceAll(':', '-')

const projectDir = (root, cwd) => join(root, projectSlug(cwd))

const tryMkdir = (dir) => {
  try {
    mkdirSync(dir, { mode: 0o700 })
    return true
  } catch (e) {
    if (e.code === 'EEXIST') return false
    throw e
  }
}

export const newRun = ({ root, cwd, now = new Date() }) => {
  const project = projectDir(root, cwd)
  mkdirSync(project, { recursive: true, mode: 0o700 })
  const base = runId(now)
  const dir = [base, ...Array.from({ length: 99 }, (_, i) => `${base}-${i + 1}`)]
    .map((name) => join(project, name))
    .find(tryMkdir)
  if (!dir) throw new Error(`no free run folder for ${base}`)
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ project: cwd, started: now.toISOString() }, null, 2)}\n`)
  return dir
}

// Timestamp first, then the collision suffix as a number, so -2 sorts before -10.
const SUFFIX = /^(.{19})(?:-(\d+))?$/
const runOrder = (a, b) => {
  const [, ta, sa = '0'] = SUFFIX.exec(a)
  const [, tb, sb = '0'] = SUFFIX.exec(b)
  return ta === tb ? Number(sa) - Number(sb) : ta < tb ? -1 : 1
}

const runNames = (project) => {
  try {
    return readdirSync(project).filter((n) => RUN_NAME.test(n)).sort(runOrder)
  } catch (e) {
    if (e.code === 'ENOENT') return []
    throw e
  }
}

export const latestRun = ({ root, cwd }) => {
  const project = projectDir(root, cwd)
  const last = runNames(project).at(-1)
  return last === undefined ? null : join(project, last)
}

const ledgerFiles = (dir) =>
  readdirSync(dir)
    .flatMap((f) => (LEDGER_FILE.test(f) ? [[Number(LEDGER_FILE.exec(f)[1]), f]] : []))
    .sort((a, b) => a[0] - b[0])
    .map(([, f]) => f)

const readLedger = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export const summarizeRun = (dir) => {
  const ledgers = ledgerFiles(dir).map((f) => readLedger(join(dir, f)))
  if (ledgers.length === 0) return { rounds: 0 }
  if (ledgers.some((l) => l === null || validateLedger(l).length > 0)) return { rounds: ledgers.length, invalid: true }
  const { first_score, final_score, open } = statusOf(ledgers)
  return { rounds: ledgers.length, first_score, final_score, open_load_bearing: open.load_bearing }
}

export const history = ({ root, cwd, limit = 10 }) => {
  const project = projectDir(root, cwd)
  return runNames(project)
    .slice(-limit)
    .map((name) => ({ run: name, ...summarizeRun(join(project, name)) }))
}

const cellOf = (v) => (v === undefined ? '-' : String(v))

const rowOf = (r) =>
  `| ${[r.run, r.rounds, r.first_score, r.final_score, r.invalid ? 'invalid ledger' : r.open_load_bearing].map(cellOf).join(' | ')} |`

export const historyMarkdown = (rows) =>
  [
    '| run | rounds | first-answer score | final score | open load-bearing |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(rowOf),
  ].join('\n')

const fail = (message) => {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`)
  process.exit(2)
}

const COMMANDS = {
  new: ({ cwd }) => newRun({ root: stateRoot(), cwd }),
  latest: ({ cwd }) => latestRun({ root: stateRoot(), cwd }) ?? fail(`no runs yet for ${cwd}`),
  history: ({ cwd, limit }) => historyMarkdown(history({ root: stateRoot(), cwd, limit: Number(limit ?? 10) })),
}

const main = (argv) => {
  const [cmd, ...rest] = argv
  const run = COMMANDS[cmd]
  if (!run) return fail(`usage: run-store.mjs ${Object.keys(COMMANDS).join('|')} --cwd <dir>`)
  const { values } = parseArgs({ args: rest, options: { cwd: { type: 'string' }, limit: { type: 'string' } } })
  if (values.cwd === undefined) return fail('--cwd is required')
  process.stdout.write(`${run(values)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
