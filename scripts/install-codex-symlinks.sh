#!/bin/sh
set -eu

CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CATALOG="$ROOT/catalog/skills.json"

mkdir -p "$CODEX_SKILLS_DIR"

node - "$CATALOG" "$ROOT" "$CODEX_SKILLS_DIR" <<'EOF'
const fs = require('fs')
const path = require('path')

const [, , catalogPath, root, codexSkillsDir] = process.argv
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

for (const pkg of catalog.packages) {
  const target = path.join(root, pkg.path)
  const lookupName = pkg.lookupName || `olko:${pkg.name}`
  const linkPath = path.join(codexSkillsDir, lookupName)

  try {
    const stat = fs.lstatSync(linkPath)
    if (!stat.isSymbolicLink()) {
      throw new Error(`${linkPath} exists and is not a symlink`)
    }
    fs.unlinkSync(linkPath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  fs.symlinkSync(target, linkPath, 'dir')
  console.log(`linked ${lookupName} -> ${target}`)
}
EOF
