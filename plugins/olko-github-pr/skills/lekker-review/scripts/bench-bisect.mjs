#!/usr/bin/env node
// Pick the next ref to benchmark when bisecting which release made detection worse.
//
// Usage: node bench-bisect.mjs --tags v1.64.0,v1.65.0,v1.66.0,v1.67.0 --good v1.63.0 --bad v1.67.0
//          [--verdicts v1.65.0=good,v1.66.0=bad]
//        node bench-bisect.mjs --list     (tags that touch the skill path, oldest first)
//
// Prints { next } (test this ref), { culprit } (first bad ref) or { error }. Exit 1 on error.

import { realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SKILL = 'plugins/olko-github-pr/skills/lekker-review'
const flag = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const indexesOf = (refs, verdicts, wanted) =>
  refs.flatMap((ref, i) => (verdicts[ref] === wanted ? [i] : []))

/** The first and last ref are good and bad unless a verdict says otherwise. */
export function nextRef(orderedRefs, verdicts) {
  const last = orderedRefs.length - 1
  if (last < 1) return { error: 'need at least a known good and a known bad ref' }
  const merged = { [orderedRefs[0]]: 'good', [orderedRefs[last]]: 'bad', ...verdicts }
  const unknown = Object.keys(verdicts).find((ref) => !orderedRefs.includes(ref))
  if (unknown) return { error: `verdict for ${unknown}, which is not in the ordered refs` }
  const invalid = Object.entries(merged).find(([, v]) => v !== 'good' && v !== 'bad')
  if (invalid) return { error: `verdict for ${invalid[0]} must be "good" or "bad"` }
  const lo = Math.max(...indexesOf(orderedRefs, merged, 'good'), -1)
  const hi = Math.min(...indexesOf(orderedRefs, merged, 'bad'), Infinity)
  if (lo < 0 || hi === Infinity || hi < lo) {
    return { error: `inconsistent verdicts: ${orderedRefs[hi]} is bad but ${orderedRefs[lo]} is good and later` }
  }
  return hi - lo === 1 ? { culprit: orderedRefs[hi] } : { next: orderedRefs[lo + Math.floor((hi - lo) / 2)] }
}

export function parseVerdicts(text) {
  const pairs = (text || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split('='))
  return Object.fromEntries(pairs)
}

export function orderedRefsFrom(tags, good, bad) {
  return [good, ...tags.filter((t) => t !== good && t !== bad), bad]
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function listTouchingTags() {
  const tags = git('tag', '--list', 'v*', '--sort=version:refname').split('\n').filter(Boolean)
  return tags.filter((tag, i) => i > 0 && git('log', '--oneline', `${tags[i - 1]}..${tag}`, '--', SKILL) !== '')
}

function main(argv) {
  if (argv.includes('--list')) return listTouchingTags().join('\n')
  const [tags, good, bad] = [flag(argv, '--tags'), flag(argv, '--good'), flag(argv, '--bad')]
  if (!tags || !good || !bad) throw new Error('--tags, --good and --bad are required')
  const ordered = orderedRefsFrom(tags.split(',').map((s) => s.trim()).filter(Boolean), good, bad)
  const result = nextRef(ordered, parseVerdicts(flag(argv, '--verdicts')))
  if (result.error) throw new Error(result.error)
  return JSON.stringify(result)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    process.stdout.write(`${main(process.argv.slice(2))}\n`)
  } catch (error) {
    process.stderr.write(`bench-bisect: ${error.message}\n`)
    process.exit(1)
  }
}
