// Single parse of catalog/skills.json, shared by the generator, the validator
// and the tests. The catalog is the source of truth; nothing else is authored.
import { readFileSync } from 'node:fs'

export const PLUGIN_ASSIGNMENT = {
  'olko-github-pr': {
    description: 'Drive GitHub pull requests to merge-ready: review-bot loops, CI fixes, descriptions, dependency triage.',
    skills: ['pr-finalize', 'pr-finalize-complete', 'pr-to-green', 'pr-description-writer',
             'qodoloop', 'coderabbitloop', 'codexloop', 'geminiloop', 'ci-fix-loop',
             'dependabot-triage', 'lekker-review'],
  },
  'olko-git-tools': {
    description: 'Everyday git and GitHub CLI operations: conventional commits, branch hygiene.',
    skills: ['git-commit', 'gh-cli', 'branch-cleanup'],
  },
  'olko-release': {
    description: 'Ship a release: semantic-release setup, changelogs, store listing copy, release-day routine.',
    skills: ['semantic-release-beta', 'open-source-publisher', 'release-day',
             'changelog-generator', 'store-listing-copy'],
  },
  'olko-product': {
    description: 'Take a product idea to a shippable build: MVP passes, full-stack scaffolds, launch plans.',
    skills: ['product-builder', 'mvp-oneshot', 'starter-rules', 'viral-launch'],
  },
  'olko-skill-meta': {
    description: 'Author and maintain agent skills and the AI toolchain itself.',
    skills: ['add-to-my-skills', 'skill-budget-audit', 'promptctl', 'ai-tools-setup',
             'relay', 'shared-knowledge-artifact'],
  },
  'olko-reflection': {
    description: 'Look back and improve: self-critique, retrospectives, performance review, rapid learning.',
    skills: ['self-critique', 'review-past-performance', 'retro-analysis', 'crash-course', 'wrap-up'],
  },
  'olko-obsidian': {
    description: 'Keep an Obsidian vault in sync with work: PR sync, task rollover, morning routine.',
    skills: ['obsidian-pr-sync', 'obsidian-task-rollover', 'morning-routine'],
  },
  'olko-apple-kit': {
    description: 'Build and ship Apple platform apps: macOS menubar apps, App Store submissions.',
    skills: ['apple-store-submit', 'macos-menubar-app'],
  },
  'olko-garmin-kit': {
    description: 'Build, test and publish Garmin Connect IQ watch faces.',
    skills: ['garmin-watchface'],
  },
  'olko-creative': {
    description: 'Creative and personal projects: photo galleries, music players, listings, wiki editing.',
    skills: ['gallery', 'fill-music-player', 'music-to-plex', 'vinted-listing', 'wikipedia-uk-editor'],
  },
  'olko-web-ops': {
    description: 'Operate a website: WAF rules, search console audits, analytics bootstrap, docs indexes.',
    skills: ['cloudflare-block-countries', 'search-console-indexing-audit',
             'docs-index-keeper', 'website-analytics-bootstrap'],
  },
}

export function loadCatalog(catalogPath = 'catalog/skills.json') {
  const raw = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const plugins = raw.plugins || []
  const skills = []
  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      const entry = { ...skill }
      // Non-enumerable so spreads and JSON.stringify skip it: the plugin object
      // holds every sibling skill, which would otherwise be copied per skill.
      Object.defineProperty(entry, 'plugin', { value: plugin, enumerable: false })
      skills.push(entry)
    }
  }
  return { name: raw.name, plugins, skills }
}
