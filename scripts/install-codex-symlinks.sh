#!/bin/sh
set -eu

CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
# shellcheck disable=SC1007 # CDPATH= intentionally clears CDPATH before cd, not an assignment typo
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

mkdir -p "$CODEX_SKILLS_DIR"

cd "$ROOT"
CODEX_SKILLS_DIR="$CODEX_SKILLS_DIR" node --input-type=module <<'EOF'
import { lstatSync, unlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from './scripts/lib/catalog.mjs'

const root = process.cwd()
const codexSkillsDir = process.env.CODEX_SKILLS_DIR

for (const skill of loadCatalog().skills) {
  if (!skill.adapters.includes('codex')) continue
  const target = join(root, skill.path)
  const linkPath = join(codexSkillsDir, skill.lookupName || skill.name)
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) {
      throw new Error(`${linkPath} exists and is not a symlink`)
    }
    unlinkSync(linkPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  symlinkSync(target, linkPath, 'dir')
  console.log(`linked ${skill.lookupName || skill.name} -> ${target}`)
}
EOF
