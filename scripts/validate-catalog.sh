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
test -f .claude-plugin/plugin.json
test -f .cursor-plugin/index.json
test -f .grok-plugin/index.json
test -f .github/copilot-instructions.md
test -d .windsurf/rules
test -d .kiro/steering

node <<'EOF'
const fs = require('fs')
const path = require('path')

const categories = new Set(['software-development', 'marketing', 'music', 'photography'])
const adapterFiles = {
  claude: (pkg) => path.join(pkg.path, 'adapters', 'claude', 'plugin.json'),
  codex: (pkg) => path.join(pkg.path, 'adapters', 'codex', 'README.md'),
  cursor: (pkg) => path.join(pkg.path, 'adapters', 'cursor', 'plugin.json'),
  grok: (pkg) => path.join(pkg.path, 'adapters', 'grok', 'plugin.json'),
  pi: (pkg) => path.join(pkg.path, 'adapters', 'pi', 'README.md'),
  hermes: (pkg) => path.join(pkg.path, 'adapters', 'hermes', 'README.md'),
  copilot: (pkg) => path.join('.github', 'prompts', `${pkg.name}.prompt.md`),
  windsurf: (pkg) => path.join(pkg.path, 'adapters', 'windsurf', 'rules', `${pkg.name}.md`),
  kiro: (pkg) => path.join(pkg.path, 'adapters', 'kiro', 'steering', `${pkg.name}.md`),
}

const catalog = JSON.parse(fs.readFileSync('catalog/skills.json', 'utf8'))
const packagesByName = new Map(catalog.packages.map((pkg) => [pkg.name, pkg]))
const claudeManifest = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const claudePluginManifest = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'))
const cursorManifest = JSON.parse(fs.readFileSync('.cursor-plugin/index.json', 'utf8'))
const grokManifest = JSON.parse(fs.readFileSync('.grok-plugin/index.json', 'utf8'))
const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

if (!kebabCasePattern.test(claudeManifest.name)) {
  throw new Error(`Claude marketplace name must be kebab-case: ${claudeManifest.name}`)
}

if (!kebabCasePattern.test(claudePluginManifest.name)) {
  throw new Error(`Claude plugin name must be kebab-case: ${claudePluginManifest.name}`)
}

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

    if (adapter === 'claude') {
      const adapterManifest = JSON.parse(fs.readFileSync(adapterFile, 'utf8'))
      if (!kebabCasePattern.test(adapterManifest.name)) {
        throw new Error(`Claude adapter plugin name must be kebab-case for ${pkg.name}: ${adapterManifest.name}`)
      }
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
  if (!kebabCasePattern.test(plugin.name)) {
    throw new Error(`Claude manifest plugin name must be kebab-case: ${plugin.name}`)
  }

  const source = plugin.source.replace(/^\.\//, '') || '.'
  if (!fs.existsSync(source)) {
    throw new Error(`Claude manifest source does not exist: ${plugin.source}`)
  }
}

for (const skillPath of claudePluginManifest.skills || []) {
  const source = skillPath.replace(/^\.\//, '')
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(`Claude root plugin skill path is invalid: ${skillPath}`)
  }
}

for (const plugin of cursorManifest.plugins || []) {
  const source = plugin.source.replace(/^\.\//, '')
  if (!fs.existsSync(source)) {
    throw new Error(`Cursor manifest source does not exist: ${plugin.source}`)
  }
}

for (const plugin of grokManifest.plugins || []) {
  const source = plugin.source.replace(/^\.\//, '')
  if (!fs.existsSync(source)) {
    throw new Error(`Grok manifest source does not exist: ${plugin.source}`)
  }
}

for (const pkg of catalog.packages) {
  const oldFlatPath = path.join('packages', pkg.name, 'SKILL.md')
  if (fs.existsSync(oldFlatPath)) {
    throw new Error(`stale flat package path exists: ${oldFlatPath}`)
  }
}

// Assert every SKILL.md (canonical + adapter wrappers) has a valid closed frontmatter block
// Codex adapter files use README.md and are validated separately above
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name === 'SKILL.md') {
      const content = fs.readFileSync(full, 'utf8')
      if (!content.match(/^---\n[\s\S]*?\n---\n?/)) {
        throw new Error(`SKILL.md does not have valid closed frontmatter: ${full}`)
      }
    }
  }
}
walk('packages')
EOF

echo "catalog validation passed"
