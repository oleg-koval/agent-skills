#!/bin/sh
set -eu

node <<'EOF'
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const catalogPath = path.join(root, 'catalog', 'skills.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

const plugins = catalog.packages.map((pkg) => ({
  name: pkg.name,
  source: `./${pkg.path}/adapters/claude`,
  description: pkg.description,
}))

const cursorPlugins = catalog.packages.map((pkg) => ({
  name: pkg.name,
  source: `./${pkg.path}/adapters/cursor`,
  description: pkg.description,
}))

fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
fs.mkdirSync(path.join(root, '.cursor-plugin'), { recursive: true })

fs.writeFileSync(
  path.join(root, '.claude-plugin', 'marketplace.json'),
  JSON.stringify(
    {
      name: 'olko-skills',
      owner: { name: 'Oleg Koval' },
      plugins,
    },
    null,
    2,
  ) + '\n',
)

fs.writeFileSync(
  path.join(root, '.cursor-plugin', 'index.json'),
  JSON.stringify(
    {
      name: 'olko-skills',
      plugins: cursorPlugins,
    },
    null,
    2,
  ) + '\n',
)

console.log('generated marketplace manifests')
EOF
