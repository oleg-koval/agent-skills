#!/bin/sh
set -eu

HERMES_SKILLS_DIR="${HERMES_HOME:-$HOME/.hermes}/skills"
# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT"
HERMES_SKILLS_DIR="$HERMES_SKILLS_DIR" node --input-type=module <<'EOF'
import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

// Inspect every destination before writing anything. Never replace user-owned paths.
for (const parent of [destination, ...new Set(entries.map(entry => dirname(entry.link)))]) {
  const stat = existing(parent)
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`refusing to use non-directory or symlinked parent: ${parent}`)
  }
}
for (const { target, link } of entries) {
  const stat = existing(link)
  if (stat && (!stat.isSymbolicLink() || resolve(dirname(link), readlinkSync(link)) !== target)) {
    throw new Error(`refusing to replace existing skill path: ${link}`)
  }
}

let linked = 0
for (const { target, link } of entries) {
  if (existing(link)) continue
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'dir')
  linked++
}
console.log(`Hermes skills: ${entries.length} available, ${linked} linked, ${entries.length - linked} already linked`)
EOF
