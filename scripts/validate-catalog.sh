#!/bin/sh
set -eu

test -f catalog/skills.json
test -f .claude-plugin/marketplace.json
test -f .cursor-plugin/index.json
test -f .grok-plugin/index.json
test -f .github/copilot-instructions.md
test -d .windsurf/rules
test -d .kiro/steering
test -d adapters

node --input-type=module <<'EOF'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog, PLUGIN_ASSIGNMENT } from './scripts/lib/catalog.mjs'

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KNOWN_ADAPTERS = new Set(['claude', 'codex', 'cursor', 'grok', 'pi', 'hermes', 'copilot', 'windsurf', 'kiro'])
const adapterFile = {
  claude: (s) => join('adapters', 'claude', s.plugin.name, 'skills', s.name, 'SKILL.md'),
  cursor: (s) => join('adapters', 'cursor', s.plugin.name, 'skills', s.name, 'SKILL.md'),
  grok: (s) => join('adapters', 'grok', s.plugin.name, 'skills', s.name, 'SKILL.md'),
  codex: (s) => join('adapters', 'codex', s.plugin.name, 'README.md'),
  copilot: (s) => join('.github', 'prompts', `${s.name}.prompt.md`),
  windsurf: (s) => join('.windsurf', 'rules', `${s.name}.md`),
  kiro: (s) => join('.kiro', 'steering', `${s.name}.md`),
  pi: (s) => join('adapters', 'pi', s.plugin.name, 'README.md'),
  hermes: (s) => join('adapters', 'hermes', s.plugin.name, 'README.md'),
}

const catalog = loadCatalog()

// Plugin-level invariants.
const pluginNames = new Set()
for (const plugin of catalog.plugins) {
  if (!kebab.test(plugin.name)) throw new Error(`plugin name must be kebab-case: ${plugin.name}`)
  if (!plugin.name.startsWith('olko-')) throw new Error(`plugin name must carry the olko- prefix: ${plugin.name}`)
  if (pluginNames.has(plugin.name)) throw new Error(`duplicate plugin name: ${plugin.name}`)
  pluginNames.add(plugin.name)
  if (!plugin.description) throw new Error(`plugin has no description: ${plugin.name}`)
  if (!plugin.skills || plugin.skills.length === 0) {
    throw new Error(`plugin has no skills: ${plugin.name}\n  An empty plugin generates an uninstallable manifest.`)
  }
  const manifest = join('plugins', plugin.name, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) throw new Error(`missing generated plugin manifest: ${manifest}`)
}

// Skill-level invariants, including the duplicate-name check.
const seen = new Map()
for (const skill of catalog.skills) {
  if (seen.has(skill.name)) {
    throw new Error(
      `duplicate skill name in catalog: ${skill.name} (in ${seen.get(skill.name)} and ${skill.plugin.name})\n` +
      '  A duplicate inflates the public skill count and shadows the first entry.'
    )
  }
  seen.set(skill.name, skill.plugin.name)

  if (!kebab.test(skill.name)) throw new Error(`skill name must be kebab-case: ${skill.name}`)
  if (!skill.description) throw new Error(`skill has no description: ${skill.name}`)
  if (!skill.lookupName) throw new Error(`skill has no lookupName: ${skill.name}`)

  const expectedPath = join('plugins', skill.plugin.name, 'skills', skill.name)
  if (skill.path !== expectedPath) {
    throw new Error(`skill path must be ${expectedPath}, got ${skill.path}`)
  }
  const skillMd = join(skill.path, 'SKILL.md')
  if (!existsSync(skillMd)) throw new Error(`missing SKILL.md for ${skill.name}: ${skillMd}`)

  // Frontmatter name must match the directory name.
  const content = readFileSync(skillMd, 'utf8')
  const fmName = content.match(/^name:[ \t]*(.+)$/m)
  if (!fmName) throw new Error(`SKILL.md has no name field: ${skillMd}`)
  if (fmName[1].trim() !== skill.name) {
    throw new Error(`SKILL.md name "${fmName[1].trim()}" does not match directory "${skill.name}": ${skillMd}`)
  }

  for (const adapter of skill.adapters || []) {
    if (!KNOWN_ADAPTERS.has(adapter)) throw new Error(`unknown adapter for ${skill.name}: ${adapter}`)
    const file = adapterFile[adapter](skill)
    if (!existsSync(file)) throw new Error(`missing ${adapter} adapter for ${skill.name}: ${file}`)
  }
}

if (catalog.skills.length !== seen.size) {
  throw new Error(`skill count mismatch: ${catalog.skills.length} entries, ${seen.size} unique`)
}

// Reverse check: every skill on disk must be registered.
const registered = new Set(catalog.skills.map((s) => s.path))
for (const plugin of readdirSync('plugins')) {
  const skillsDir = join('plugins', plugin, 'skills')
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) continue
  for (const skill of readdirSync(skillsDir)) {
    const dir = join(skillsDir, skill)
    if (!statSync(dir).isDirectory()) continue
    if (!existsSync(join(dir, 'SKILL.md'))) continue
    if (!registered.has(dir)) {
      throw new Error(
        `skill on disk is not registered in catalog/skills.json: ${dir}\n` +
        '  Unregistered skills are missing from every plugin manifest and cannot be installed.'
      )
    }
  }
}

// The assignment table and the catalog must not drift apart. A count-only check
// would pass if two skills swapped plugins, so compare the groupings themselves.
for (const [pluginName, def] of Object.entries(PLUGIN_ASSIGNMENT)) {
  const plugin = catalog.plugins.find((p) => p.name === pluginName)
  if (!plugin) {
    throw new Error(`PLUGIN_ASSIGNMENT names a plugin absent from the catalog: ${pluginName}`)
  }
  const assigned = [...def.skills].sort()
  const actual = plugin.skills.map((s) => s.name).sort()
  if (assigned.join(',') !== actual.join(',')) {
    const missing = assigned.filter((n) => !actual.includes(n))
    const extra = actual.filter((n) => !assigned.includes(n))
    throw new Error(
      `PLUGIN_ASSIGNMENT and catalog disagree for ${pluginName}:\n` +
      `  in the table but not the catalog: ${missing.join(', ') || 'none'}\n` +
      `  in the catalog but not the table: ${extra.join(', ') || 'none'}`
    )
  }
}
for (const plugin of catalog.plugins) {
  if (!PLUGIN_ASSIGNMENT[plugin.name]) {
    throw new Error(`catalog has a plugin absent from PLUGIN_ASSIGNMENT: ${plugin.name}`)
  }
}

// Every skill must appear in the README table.
const readme = readFileSync('README.md', 'utf8')
for (const skill of catalog.skills) {
  if (!readme.includes(`${skill.path}/SKILL.md`)) {
    throw new Error(`skill is missing from the README table: ${skill.name}`)
  }
}

// Manifest sources must exist.
const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
for (const plugin of marketplace.plugins || []) {
  if (!kebab.test(plugin.name)) throw new Error(`marketplace plugin name must be kebab-case: ${plugin.name}`)
  const source = plugin.source.replace(/^\.\//, '') || '.'
  if (!existsSync(source)) throw new Error(`marketplace source does not exist: ${plugin.source}`)
}
for (const file of ['.cursor-plugin/index.json', '.grok-plugin/index.json']) {
  for (const plugin of (JSON.parse(readFileSync(file, 'utf8')).plugins || [])) {
    const source = plugin.source.replace(/^\.\//, '')
    if (!existsSync(source)) throw new Error(`${file} source does not exist: ${plugin.source}`)
  }
}

// No stale pre-restructure tree.
if (existsSync('packages')) throw new Error('stale packages/ directory still exists')
if (existsSync('collections')) throw new Error('stale collections/ directory still exists')

console.log(`catalog validation passed: ${catalog.plugins.length} plugins, ${catalog.skills.length} skills`)
EOF
