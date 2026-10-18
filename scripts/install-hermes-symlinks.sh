#!/bin/sh
set -eu

HERMES_SKILLS_DIR="${HERMES_HOME:-$HOME/.hermes}/skills"
case "$HERMES_SKILLS_DIR" in
  /*) ;;
  *) HERMES_SKILLS_DIR="$PWD/$HERMES_SKILLS_DIR" ;;
esac
case "${1:-}" in
  "") HERMES_PRUNE=0 ;;
  --prune) HERMES_PRUNE=1 ;;
  *) echo "usage: $0 [--prune]" >&2; exit 2 ;;
esac
test "$#" -le 1 || { echo "usage: $0 [--prune]" >&2; exit 2; }
# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT"
HERMES_SKILLS_DIR="$HERMES_SKILLS_DIR" HERMES_PRUNE="$HERMES_PRUNE" node --input-type=module <<'EOF'
import { lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { loadCatalog } from './scripts/lib/catalog.mjs'

const root = process.cwd()
const destination = join(process.env.HERMES_SKILLS_DIR, 'olko-agent-skills')
const entries = loadCatalog().skills
  .filter(skill => skill.adapters.includes('hermes'))
  .map(skill => ({
    target: join(root, skill.path),
    link: join(destination, skill.plugin.name, skill.name),
  }))

const existing = path => {
  try { return lstatSync(path) }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
const isExpectedLink = (link, target) => {
  const stat = existing(link)
  return stat?.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === target
}
const isManagedLink = link => {
  if (!existing(link)?.isSymbolicLink()) return false
  const target = resolve(dirname(link), readlinkSync(link))
  const parts = relative(root, target).split(sep)
  return parts.length === 4 && parts[0] === 'plugins' && parts[2] === 'skills'
    && parts[1] === basename(dirname(link)) && parts[3] === basename(link)
}

// Inspect every destination before writing anything. Never replace user-owned paths.
for (const parent of [destination, ...new Set(entries.map(entry => dirname(entry.link)))]) {
  const stat = existing(parent)
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`refusing to use non-directory or symlinked parent: ${parent}`)
  }
}
for (const { target, link } of entries) {
  const stat = existing(link)
  if (stat && !isExpectedLink(link, target)) {
    throw new Error(`refusing to replace existing skill path: ${link}`)
  }
}

const wanted = new Set(entries.map(entry => entry.link))
const stale = []
if (existing(destination)) {
  for (const plugin of readdirSync(destination, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue
    const pluginDir = join(destination, plugin.name)
    for (const skill of readdirSync(pluginDir)) {
      const link = join(pluginDir, skill)
      if (!wanted.has(link) && isManagedLink(link)) stale.push(link)
    }
  }
}
if (stale.length && process.env.HERMES_PRUNE !== '1') {
  throw new Error(`${stale.length} stale catalog-owned link(s) found; inspect them and rerun with --prune to remove them`)
}

let linked = 0
const created = []
try {
  for (const { target, link } of entries) {
    if (existing(link)) {
      if (!isExpectedLink(link, target)) throw new Error(`refusing to replace existing skill path: ${link}`)
      continue
    }
    mkdirSync(dirname(link), { recursive: true })
    try {
      symlinkSync(target, link, 'dir')
    } catch (error) {
      if (error.code === 'EEXIST' && isExpectedLink(link, target)) continue
      throw error
    }
    const stat = lstatSync(link)
    created.push({ link, target, dev: stat.dev, ino: stat.ino })
    linked++
  }
} catch (error) {
  for (const { link, target, dev, ino } of created.reverse()) {
    const stat = existing(link)
    if (stat?.dev === dev && stat?.ino === ino && isExpectedLink(link, target)) unlinkSync(link)
  }
  throw error
}
let pruned = 0
if (process.env.HERMES_PRUNE === '1') {
  for (const link of stale) {
    if (isManagedLink(link)) {
      unlinkSync(link)
      pruned++
    }
  }
}
console.log(`Hermes skills: ${entries.length} available, ${linked} linked, ${entries.length - linked} already linked, ${pruned} pruned`)
EOF
