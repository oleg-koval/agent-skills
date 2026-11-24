// Benchmark corpus format shared by the bench scripts.
//
// corpus.json: { cases: [ { id, expect: "buggy"|"clean", knownBug?: "file:line text",
//                           repo, baseRef, patch, depths?: ["scan","medium","deep"] } ] }
// `repo` and `patch` are paths relative to the corpus file's directory (or absolute).
// `id` becomes a directory and result file name, so it is restricted to a safe charset.

import { basename } from 'node:path'
import { parseKnownBug } from './eval-runner.mjs'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEPTHS = new Set(['scan', 'medium', 'deep'])
const isText = (v) => typeof v === 'string' && v.trim() !== ''

function caseProblem(c, seen) {
  if (!c || typeof c !== 'object') return 'must be an object'
  if (typeof c.id !== 'string' || !ID.test(c.id)) return 'id must match [A-Za-z0-9][A-Za-z0-9._-]*'
  if (seen.has(c.id)) return `duplicate id ${c.id}`
  if (c.expect !== 'buggy' && c.expect !== 'clean') return 'expect must be "buggy" or "clean"'
  if (c.expect === 'buggy' && !parseKnownBug(c.knownBug)) return 'a buggy case needs knownBug starting with "file:line" (line >= 1)'
  const missing = ['repo', 'baseRef', 'patch'].find((key) => !isText(c[key]))
  if (missing) return `${missing} must be a non-empty string`
  const depths = c.depths
  if ('depths' in c && !(Array.isArray(depths) && depths.length > 0 && depths.every((d) => DEPTHS.has(d)))) {
    return 'depths must be a non-empty array of scan, medium or deep'
  }
  return null
}

export function validateCorpus(corpus) {
  const cases = corpus && Array.isArray(corpus.cases) ? corpus.cases : null
  if (!cases) throw new Error('corpus needs a "cases" array')
  cases.reduce((seen, c, i) => {
    const problem = caseProblem(c, seen)
    if (problem) throw new Error(`cases[${i}]: ${problem}`)
    return new Set([...seen, c.id])
  }, new Set())
  return cases
}

export const caseDepths = (c) => (Array.isArray(c.depths) ? c.depths : ['medium'])

/** The manifest shape eval-runner's validateManifest accepts; `id` is the case key. */
export function toLegacyManifest(corpus) {
  const prs = validateCorpus(corpus).map((c, i) => ({
    id: c.id,
    repo: basename(c.repo) || c.repo,
    pr: i + 1,
    expect: c.expect,
    ...(c.knownBug ? { knownBug: c.knownBug } : {}),
  }))
  return { prs }
}
