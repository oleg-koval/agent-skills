#!/usr/bin/env node
// Plan a benchmark run: one row per arm x case x repeat, in seeded shuffled order.
//
// Usage: node bench-plan.mjs --arms v1.63.0,v1.67.0 --corpus <corpus.json> --repeats 3
//          --depth medium --seed 1 --out <dir>
//
// Checks each arm out as a detached worktree under ${LEKKER_STATE_DIR}/bench/arms/<sha>
// and records its workflow.js hash. Inputs are not materialized here: plan.json lists the
// `materialize` argv per case and the executor runs it.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { caseDepths, validateCorpus } from './bench-corpus.mjs'

const SKILL = 'plugins/olko-github-pr/skills/lekker-review'
const flag = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const posInt = (v, name) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`)
  return n
}

export function parseArgs(argv) {
  const arms = (flag(argv, '--arms') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const [corpus, out] = [flag(argv, '--corpus'), flag(argv, '--out')]
  if (arms.length === 0 || !corpus || !out) throw new Error('--arms, --corpus and --out are required')
  const depth = flag(argv, '--depth') || 'medium'
  if (!['scan', 'medium', 'deep'].includes(depth)) throw new Error('--depth must be scan, medium or deep')
  const seed = Number(flag(argv, '--seed') ?? 1)
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer')
  return { arms, corpus, out, depth, seed, repeats: posInt(flag(argv, '--repeats') ?? 1, '--repeats') }
}

export function mulberry32(seed) {
  const step = (state) => (state + 0x6d2b79f5) | 0
  const mix = (s) => {
    const a = Math.imul(s ^ (s >>> 15), s | 1)
    const b = a ^ (a + Math.imul(a ^ (a >>> 7), a | 61))
    return ((b ^ (b >>> 14)) >>> 0) / 4294967296
  }
  return { at: (n) => mix(step(seed + (n - 1) * 0x6d2b79f5)) }
}

export function shuffle(items, seed) {
  const rng = mulberry32(seed)
  const keyed = items.map((item, i) => ({ item, key: rng.at(i + 1) }))
  return keyed.toSorted((a, b) => a.key - b.key).map((k) => k.item)
}

export const sanitizeRef = (ref) => ref.replace(/[^A-Za-z0-9._-]+/g, '_')

function rowsFor(arm, c, repeats, depth, outDir) {
  const caseDir = join(outDir, 'cases', c.id)
  const name = sanitizeRef(arm.ref)
  return Array.from({ length: repeats }, (_, i) => ({
    arm: name,
    sha: arm.sha,
    caseId: c.id,
    repeat: i + 1,
    depth,
    scriptPath: arm.scriptPath,
    // repoSlug and targetLabel are required by the workflow's own arg check
    args: {
      diffFile: join(caseDir, 'pr.diff'),
      contextFile: join(caseDir, 'context.json'),
      promptDir: arm.promptDir,
      worktreePath: join(caseDir, 'repo'),
      depth,
      repoSlug: 'bench/bench',
      targetLabel: `bench case ${c.id}`,
    },
    resultPath: join(outDir, 'results', name, c.id, `${i + 1}.json`),
  }))
}

export function buildRows(arms, cases, repeats, depth, seed, outDir) {
  const names = arms.map((a) => sanitizeRef(a.ref))
  if (new Set(names).size !== names.length) throw new Error('arm names collide after sanitizing')
  const eligible = cases.filter((c) => caseDepths(c).includes(depth))
  const rows = arms.flatMap((arm) => eligible.flatMap((c) => rowsFor(arm, c, repeats, depth, outDir)))
  return shuffle(rows, seed)
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function resolveArm(ref, repoRoot, stateDir) {
  const sha = git(repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`)
  const dir = join(stateDir, 'bench', 'arms', sha)
  if (!existsSync(dir)) {
    mkdirSync(dirname(dir), { recursive: true })
    git(repoRoot, 'worktree', 'add', '--detach', dir, sha)
  }
  const scriptPath = join(dir, SKILL, 'workflow.js')
  const workflowSha256 = createHash('sha256').update(readFileSync(scriptPath)).digest('hex')
  return { ref, sha, workflowSha256, scriptPath, promptDir: join(dir, SKILL, 'references', 'agents') }
}

function main(argv) {
  const opts = parseArgs(argv)
  const corpusFile = resolve(opts.corpus)
  const out = resolve(opts.out)
  const cases = validateCorpus(JSON.parse(readFileSync(corpusFile, 'utf8')))
  const repoRoot = git(process.cwd(), 'rev-parse', '--show-toplevel')
  const stateDir = process.env.LEKKER_STATE_DIR || join(homedir(), '.local', 'state', 'lekker-review')
  const arms = opts.arms.map((ref) => resolveArm(ref, repoRoot, stateDir))
  const materializer = join(dirname(fileURLToPath(import.meta.url)), 'bench-materialize.mjs')
  const rows = buildRows(arms, cases, opts.repeats, opts.depth, opts.seed, out)
  const planned = cases.filter((c) => caseDepths(c).includes(opts.depth))
  const plan = {
    schema: 1,
    createdAt: new Date().toISOString(),
    seed: opts.seed,
    repeats: opts.repeats,
    depth: opts.depth,
    corpus: corpusFile,
    arms: arms.map(({ ref, sha, workflowSha256 }) => ({ ref, sha, workflowSha256 })),
    cases: planned.map((c) => ({
      id: c.id,
      materialize: ['node', materializer, '--corpus', corpusFile, '--case', c.id, '--out', join(out, 'cases', c.id)],
    })),
    rows,
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  process.stdout.write(`plan.json: ${rows.length} runs (${arms.length} arms x ${planned.length} cases x ${opts.repeats} repeats)\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`bench-plan: ${error.message}\n`)
    process.exit(1)
  }
}
