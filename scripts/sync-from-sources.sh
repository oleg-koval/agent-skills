#!/bin/sh
set -eu

node <<'EOF'
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'skills.json'), 'utf8'))
let synced = 0

const copyIfPresent = (source, target) => {
  if (!fs.existsSync(source)) {
    return
  }

  fs.rmSync(target, { force: true, recursive: true })
  fs.cpSync(source, target, { recursive: true })
}

for (const pkg of catalog.packages) {
  if (!pkg.sourcePath) {
    continue
  }

  const sourcePath = path.resolve(root, pkg.sourcePath)
  const targetPath = path.resolve(root, pkg.path)

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`sourcePath for ${pkg.name} does not exist: ${pkg.sourcePath}`)
  }

  fs.mkdirSync(targetPath, { recursive: true })
  copyIfPresent(path.join(sourcePath, 'SKILL.md'), path.join(targetPath, 'SKILL.md'))
  copyIfPresent(path.join(sourcePath, 'references'), path.join(targetPath, 'references'))
  copyIfPresent(path.join(sourcePath, 'LICENSE'), path.join(targetPath, 'LICENSE'))
  synced += 1
  console.log(`synced ${pkg.name} from ${pkg.sourcePath}`)
}

if (synced === 0) {
  console.log('no package sourcePath entries configured; nothing to sync')
}
EOF
