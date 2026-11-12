#!/usr/bin/env node
// Compare benchmark arms from a plan.json and the result files its rows point at.
//
// Usage: node bench-compare.mjs --plan <plan.json> [--window N] [--small-files] [--json]
//
// The first arm in plan.arms is the baseline; every other arm is compared with it.
// --window N         line window for a finding to hit the known bug (overrides the default)
// --small-files      default window 3 (corpus files under ~100 lines) instead of LINE_WINDOW (10)
// A missing or unparseable result is unscored, never zero, and makes the exit code 1.
// A result file is the object the Workflow returned; its `findings` array is scored.

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BLOCKING, LINE_WINDOW, score } from './eval-runner.mjs'
import { toLegacyManifest } from './bench-corpus.mjs'
import { sanitizeRef } from './bench-plan.mjs'

export const defaultWindow = (smallFiles) => (smallFiles ? 3 : LINE_WINDOW)

export function extractFindings(result) {
  if (Array.isArray(result)) return result
  return result && Array.isArray(result.findings) ? result.findings : null
}

/** One results map per arm (caseId -> runs in repeat order) plus every planned run with no usable result. */
export function loadMatrix(plan, readResult) {
  const names = plan.arms.map((a) => sanitizeRef(a.ref))
  const loaded = plan.rows
    .filter((row) => names.includes(row.arm))
    .map((row) => ({ row, findings: extractFindings(readResult(row.resultPath)) }))
  const missing = loaded
    .filter((l) => l.findings === null)
    .map(({ row }) => ({ arm: row.arm, caseId: row.caseId, repeat: row.repeat }))
  const byRepeat = loaded.filter((l) => l.findings !== null).toSorted((a, b) => a.row.repeat - b.row.repeat)
  const arms = names.map((name) => ({
    name,
    results: byRepeat.filter((l) => l.row.arm === name).reduce(
      (acc, { row, findings }) => ({ ...acc, [row.caseId]: [...(acc[row.caseId] || []), findings] }), {}),
  }))
  return { arms, missing }
}

const onlyBlocking = (results) => Object.fromEntries(Object.entries(results).map(
  ([key, runs]) => [key, runs.map((run) => run.filter((f) => BLOCKING.has(f.severity)))]))

export function armSummary(scored, manifest, results, window = LINE_WINDOW) {
  return {
    recall: scored.recall,
    blockingRecall: score(manifest, onlyBlocking(results), window).recall,
    blockingPerCleanRun: scored.falsePositivesPerCleanRun ?? null,
    buggyRuns: scored.buggyRuns ?? 0,
    cleanRuns: scored.cleanRuns ?? 0,
    unscored: scored.unscored,
  }
}

export function pairedTable(scoredA, scoredB) {
  const inB = new Map(scoredB.rows.map((r) => [r.key, r]))
  return scoredA.rows
    .filter((r) => r.expect === 'buggy' && r.scored && inB.get(r.key)?.scored)
    .map((r) => ({ key: r.key, hitsA: r.hits, hitsB: inB.get(r.key).hits, a: r.hitRate, b: inB.get(r.key).hitRate }))
}

export const flips = (table) => table.filter((r) => (r.a >= 0.5) !== (r.b >= 0.5) || (r.hitsA > 0) !== (r.hitsB > 0)).length

/** Hits gained and lost by B against A, per case, pairing runs to minimise discordance. */
export function winsLosses(table) {
  return table.reduce((acc, r) => ({
    wins: acc.wins + Math.max(0, r.hitsB - r.hitsA),
    losses: acc.losses + Math.max(0, r.hitsA - r.hitsB),
  }), { wins: 0, losses: 0 })
}

/** Exact two-sided binomial p-value under p = 0.5, ties already dropped. */
export function signTest(wins, losses) {
  const n = wins + losses
  if (n === 0) return 1
  const choose = (k) => Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1)
  const tail = Array.from({ length: Math.min(wins, losses) + 1 }, (_, k) => choose(k)).reduce((a, b) => a + b, 0)
  return Math.min(1, (2 * tail) / 2 ** n)
}

export const P_NOTE = 'p counts runs as independent, so it is optimistic; confirm on the flipped cases'

export function verdict(summaryA, summaryB, p, repeats = 1) {
  const [a, b] = [summaryA.recall, summaryB.recall]
  if (a === null || b === null || p >= 0.05 || a === b) return `not distinguishable at ${repeats} repeats`
  return b < a ? 'worse' : 'better'
}

export function warnings(summaryA) {
  const r = summaryA.recall
  if (r === null) return ['baseline has no scored buggy runs: corpus cannot show a change']
  return r > 0.9 || r < 0.2 ? [`baseline recall ${pct(r)}: corpus cannot show a change`] : []
}

export function compare({ plan, manifest, readResult, window = LINE_WINDOW }) {
  const { arms, missing } = loadMatrix(plan, readResult)
  const scored = arms.map((a) => score(manifest, a.results, window))
  const summaries = arms.map((a, i) => armSummary(scored[i], manifest, a.results, window))
  const comparisons = arms.slice(1).map((arm, i) => {
    const table = pairedTable(scored[0], scored[i + 1])
    const { wins, losses } = winsLosses(table)
    const p = signTest(wins, losses)
    return { arm: arm.name, table, flips: flips(table), wins, losses, p, pNote: P_NOTE, verdict: verdict(summaries[0], summaries[i + 1], p, plan.repeats) }
  })
  return {
    window, repeats: plan.repeats, missing, complete: missing.length === 0,
    arms: arms.map((a, i) => ({ name: a.name, ...summaries[i] })),
    comparisons, warnings: warnings(summaries[0]),
  }
}

const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`)
const num = (v) => (v === null ? 'n/a' : v.toFixed(2))

export function renderReport(r) {
  const armRows = r.arms.map((a) => `${a.name.padEnd(24)} ${pct(a.recall).padStart(8)} ${pct(a.blockingRecall).padStart(10)} ${num(a.blockingPerCleanRun).padStart(8)}`)
  const pairs = r.comparisons.flatMap((c) => [
    '', `${c.arm} vs ${r.arms[0].name}: hit rate per buggy case`,
    ...c.table.map((t) => `  ${t.key.padEnd(30)} ${pct(t.a).padStart(5)} ${pct(t.b).padStart(5)}`),
    `  flips ${c.flips}, wins ${c.wins}, losses ${c.losses}, sign test p = ${c.p.toPrecision(3)}`,
    `  note: ${c.pNote}`,
    `  verdict: ${c.verdict}`,
  ])
  return [
    `window ${r.window}, repeats ${r.repeats}`,
    `${'arm'.padEnd(24)} ${'recall'.padStart(8)} ${'blocking'.padStart(10)} ${'FP/clean'.padStart(8)}`,
    ...armRows, ...pairs,
    ...r.warnings.map((w) => `WARNING: ${w}`),
    ...(r.complete ? [] : ['', `INCOMPLETE: ${r.missing.length} planned results missing or unparseable (unscored, not zero)`,
      ...r.missing.map((m) => `  ${m.arm} ${m.caseId} repeat ${m.repeat}`)]),
  ].join('\n')
}

const flag = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function main(argv) {
  const planPath = flag(argv, '--plan')
  if (!planPath) throw new Error('--plan is required')
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const raw = flag(argv, '--window')
  const window = raw === undefined ? defaultWindow(argv.includes('--small-files')) : Number(raw)
  if (!Number.isInteger(window) || window < 0) throw new Error('--window must be a non-negative integer')
  const planned = new Set(plan.cases.map((c) => c.id))
  const all = toLegacyManifest(JSON.parse(readFileSync(plan.corpus, 'utf8')))
  const manifest = { prs: all.prs.filter((e) => planned.has(e.id)) }
  const report = compare({ plan, manifest, readResult: readJson, window })
  process.stdout.write(`${argv.includes('--json') ? JSON.stringify(report, null, 2) : renderReport(report)}\n`)
  process.exitCode = report.complete ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`bench-compare: ${error.message}\n`)
    process.exit(1)
  }
}
