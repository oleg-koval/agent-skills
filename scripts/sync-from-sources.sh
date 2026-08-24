#!/bin/sh
set -eu

node --input-type=module <<'EOF'
import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadCatalog } from './scripts/lib/catalog.mjs'

const root = process.cwd()
let synced = 0

const copyIfPresent = (source, target) => {
  if (!existsSync(source)) return
  rmSync(target, { force: true, recursive: true })
  cpSync(source, target, { recursive: true })
}

for (const skill of loadCatalog().skills) {
  if (!skill.sourcePath) continue

  const sourcePath = resolve(root, skill.sourcePath)
  const targetPath = resolve(root, skill.path)

  if (!existsSync(sourcePath)) {
    throw new Error(`sourcePath for ${skill.name} does not exist: ${skill.sourcePath}`)
  }

  mkdirSync(targetPath, { recursive: true })
  copyIfPresent(join(sourcePath, 'SKILL.md'), join(targetPath, 'SKILL.md'))
  copyIfPresent(join(sourcePath, 'references'), join(targetPath, 'references'))
  copyIfPresent(join(sourcePath, 'LICENSE'), join(targetPath, 'LICENSE'))
  synced += 1
  console.log(`synced ${skill.name} into ${skill.path} from ${skill.sourcePath}`)
}

if (synced === 0) {
  console.log('no skill sourcePath entries configured; nothing to sync')
}
EOF
