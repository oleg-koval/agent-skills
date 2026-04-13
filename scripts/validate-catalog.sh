#!/bin/sh
set -eu

test -f catalog/skills.json
test -f collections/software-development.json
test -f collections/marketing.json
test -f collections/music.json
test -f collections/photography.json
test -f collections/docs-tools.json
test -f collections/release-tools.json
test -f .claude-plugin/marketplace.json
test -f .cursor-plugin/index.json
test -f .github/copilot-instructions.md

node <<'EOF'
const fs = require('fs')
const path = require('path')

const categories = new Set(['software-development', 'marketing', 'music', 'photography'])
const adapterFiles = {
  claude: (pkg) => path.join(pkg.path, 'adapters', 'claude', 'plugin.json'),
  codex: (pkg) => path.join(pkg.path, 'adapters', 'codex', 'README.md'),
  cursor: (pkg) => path.join(pkg.path, 'adapters', 'cursor', 'plugin.json'),
  copilot: (pkg) => path.join('.github', 'prompts', `${pkg.name}.prompt.md`),
}

const catalog = JSON.parse(fs.readFileSync('catalog/skills.json', 'utf8'))
const packagesByName = new Map(catalog.packages.map((pkg) => [pkg.name, pkg]))
const claudeManifest = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const cursorManifest = JSON.parse(fs.readFileSync('.cursor-plugin/index.json', 'utf8'))

for (const pkg of catalog.packages) {
  if (!pkg.name || !pkg.lookupName || !pkg.path || !pkg.description) {
    throw new Error(`package metadata is incomplete: ${JSON.stringify(pkg)}`)
  }

  if (!categories.has(pkg.category)) {
    throw new Error(`unknown category for ${pkg.name}: ${pkg.category}`)
  }

  const skillPath = path.join(pkg.path, 'SKILL.md')
  if (!fs.existsSync(skillPath)) {
    throw new Error(`missing SKILL.md for ${pkg.name}: ${skillPath}`)
  }

  for (const adapter of pkg.adapters || []) {
    const adapterFileFor = adapterFiles[adapter]
    if (!adapterFileFor) {
      throw new Error(`unknown adapter for ${pkg.name}: ${adapter}`)
    }

    const adapterFile = adapterFileFor(pkg)
    if (!fs.existsSync(adapterFile)) {
      throw new Error(`missing ${adapter} adapter for ${pkg.name}: ${adapterFile}`)
    }
  }
}

for (const collectionPath of fs.readdirSync('collections').map((name) => path.join('collections', name))) {
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'))
  for (const packageName of collection.packages || []) {
    if (!packagesByName.has(packageName)) {
      throw new Error(`${collectionPath} references unknown package: ${packageName}`)
    }
  }
}

for (const plugin of claudeManifest.plugins || []) {
  const source = plugin.source.replace(/^\.\//, '')
  if (!fs.existsSync(source)) {
    throw new Error(`Claude manifest source does not exist: ${plugin.source}`)
  }
}

for (const plugin of cursorManifest.plugins || []) {
  const source = plugin.source.replace(/^\.\//, '')
  if (!fs.existsSync(source)) {
    throw new Error(`Cursor manifest source does not exist: ${plugin.source}`)
  }
}

for (const pkg of catalog.packages) {
  const oldFlatPath = path.join('packages', pkg.name, 'SKILL.md')
  if (fs.existsSync(oldFlatPath)) {
    throw new Error(`stale flat package path exists: ${oldFlatPath}`)
  }
}
EOF

echo "catalog validation passed"
