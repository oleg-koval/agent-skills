#!/usr/bin/env node
// Picks the review's closing xkcd strip or GIF from references/fun.json,
// matched to the verdict. The pool is curated and URL-verified, so the model
// never invents a link at review time.
//
//   node pick-closer.mjs --verdict lgtm|lgtm-with-changes|needs-work
//   node pick-closer.mjs --check
//
// Fails soft: a missing or broken pool prints nothing and exits 0, because a
// joke must never break a review. Only --check exits 1.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const VERDICTS = ['lgtm', 'lgtm-with-changes', 'needs-work']
const POOL_PATH = process.env.LEKKER_FUN_FILE ||
  join(dirname(dirname(fileURLToPath(import.meta.url))), 'references', 'fun.json')

/**
 * Loads and flattens the curated fun pool from fun.json.
 * @returns {Array<object>} xkcd and gif entries tagged with a `kind`.
 */
export function loadPool() {
  const pool = JSON.parse(readFileSync(POOL_PATH, 'utf8'))
  return [
    ...(pool.xkcd || []).map(x => ({ kind: 'xkcd', ...x })),
    ...(pool.gifs || []).map(g => ({ kind: 'gif', ...g })),
  ]
}

/**
 * Builds terminal and GitHub markdown renderings for a pool item.
 * @param {object} item - A pool entry (xkcd or gif), as returned by loadPool.
 * @returns {object} The item plus `md_terminal` and `md_github` strings.
 */
export function render(item) {
  if (item.kind === 'xkcd') {
    const label = `xkcd #${item.num} "${item.title}"`
    return {
      ...item,
      md_terminal: `🎲 ${label} - ${item.url}`,
      md_github: `![${label}](${item.img})\n[${label}](${item.url})`,
    }
  }
  return {
    ...item,
    md_terminal: `🎬 ${item.alt} - ${item.url}`,
    md_github: `![${item.alt}](${item.url})`,
  }
}

/**
 * Validates fun.json: required fields, known verdicts, coverage of every
 * verdict, and no em dashes. Prints a summary and exits 1 on problems.
 * @returns {void}
 */
function check() {
  const items = loadPool()
  const problems = []
  for (const it of items) {
    if (!it.url || !Array.isArray(it.verdicts) || it.verdicts.length === 0) problems.push(`incomplete: ${JSON.stringify(it)}`)
    if (it.kind === 'xkcd' && (!it.img || !it.title || !it.num)) problems.push(`xkcd missing img/title/num: ${it.url}`)
    if (it.kind === 'gif' && !it.alt) problems.push(`gif missing alt: ${it.url}`)
    // title and alt become markdown link labels; these characters break them
    if (/[[\]\n]/.test(it.title || it.alt || '')) problems.push(`"[", "]" or newline in title/alt: ${it.url}`)
    for (const v of it.verdicts || []) if (!VERDICTS.includes(v)) problems.push(`unknown verdict "${v}": ${it.url}`)
  }
  for (const v of VERDICTS) if (!items.some(i => i.verdicts?.includes(v))) problems.push(`no entry for verdict ${v}`)
  if (JSON.stringify(items).includes('\u2014')) problems.push('em dash in pool')
  if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
  console.log(`fun.json ok: ${items.length} entries, ${VERDICTS.map(v => `${v}=${items.filter(i => i.verdicts.includes(v)).length}`).join(' ')}`)
}

/**
 * Picks a random pool item matching the verdict and prints it as JSON.
 * Fails soft: any error or empty match is silently swallowed.
 * @param {string} verdict - One of VERDICTS.
 * @returns {void}
 */
function pick(verdict) {
  try {
    const matches = loadPool().filter(i => i.verdicts?.includes(verdict))
    if (matches.length === 0) return
    console.log(JSON.stringify(render(matches[Math.floor(Math.random() * matches.length)])))
  } catch { /* fail soft */ }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isMain()) {
  const args = process.argv.slice(2)
  if (args.includes('--check')) check()
  else {
    const i = args.indexOf('--verdict')
    if (i !== -1) pick(args[i + 1])
  }
}
