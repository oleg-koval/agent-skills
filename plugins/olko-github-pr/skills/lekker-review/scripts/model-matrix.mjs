#!/usr/bin/env node
// Model and effort per lekker agent, picked from the PR's risk tier.
//
// Depth decides how many agents run; the tier decides how strong each one is.
// Effort comes before model size: a tier escalates effort first and moves to a
// bigger model only for risky changes. Finders stay one step below the gate
// (verifier), because the verifier decides what survives. The fast models
// (haiku, luna) only ever do first-pass triage or housekeeping.
//
//   node model-matrix.mjs --host claude|codex [--risk <tier>] [--lines <n>]
//     [--categories auth,billing,...] [--crossvendor] -- <changed-file>...
//
// `--categories` is the comma-joined `categories[].category` list from
// risk-paths.mjs. `--lines` is additions+deletions without lockfiles.
// `--crossvendor` moves the gate roles to the other host's model at the same
// tier: a cell gains `vendor` and `hostRoute` (the route it falls back to).
// Prints {host, tier, tierSource, reasons, visual, routing}.
import { pathToFileURL } from 'node:url'

export const TIERS = ['routine', 'standard', 'large', 'elevated', 'critical']
export const HOSTS = ['claude', 'codex']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Roles that decide whether a finding survives. Never a fast model.
export const GATE_ROLES = ['verifier', 'critic']

const r = (model, effort) => ({ model, effort })
const same = cell => [cell, cell, cell, cell, cell]

// One row per role: [routine, standard, large, elevated, critical].
// `large` (500-800 lines) keeps the finders on the standard route and moves only the
// verifier to the strong model at medium effort: finders are most of the spend
// (PR 83: 9.8M of 12.1M cache reads), the verifier decides what survives.
export const MATRIX = {
  claude: {
    triage:       same(r('haiku', 'medium')),
    specialist:   [r('sonnet', 'medium'), r('sonnet', 'high'), r('sonnet', 'high'), r('opus', 'high'), r('opus', 'xhigh')],
    rules:        [r('sonnet', 'medium'), r('sonnet', 'medium'), r('sonnet', 'medium'), r('sonnet', 'high'), r('sonnet', 'high')],
    verifier:     [r('sonnet', 'high'), r('sonnet', 'high'), r('opus', 'medium'), r('opus', 'high'), r('fable', 'high')],
    critic:       [r('sonnet', 'medium'), r('sonnet', 'high'), r('opus', 'medium'), r('opus', 'high'), r('fable', 'xhigh')],
    prover:       [r('sonnet', 'high'), r('sonnet', 'high'), r('sonnet', 'high'), r('sonnet', 'high'), r('opus', 'high')],
    fixer:        [r('sonnet', 'high'), r('sonnet', 'high'), r('sonnet', 'high'), r('sonnet', 'high'), r('opus', 'high')],
    polish:       same(r('sonnet', 'medium')),
    housekeeping: same(r('haiku', 'low')),
  },
  codex: {
    triage:       same(r('gpt-6-luna', 'medium')),
    specialist:   [r('gpt-6.2-sol', 'medium'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-astra', 'high'), r('gpt-6.2-astra', 'xhigh')],
    rules:        [r('gpt-6.2-sol', 'medium'), r('gpt-6.2-sol', 'medium'), r('gpt-6.2-sol', 'medium'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high')],
    verifier:     [r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-astra', 'medium'), r('gpt-6.2-astra', 'high'), r('gpt-6.2-astra', 'high')],
    critic:       [r('gpt-6.2-sol', 'medium'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-astra', 'medium'), r('gpt-6.2-astra', 'high'), r('gpt-6.2-astra', 'xhigh')],
    prover:       [r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-astra', 'high')],
    fixer:        [r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-sol', 'high'), r('gpt-6.2-astra', 'high')],
    polish:       same(r('gpt-6.2-sol', 'medium')),
    housekeeping: same(r('gpt-6-luna', 'low')),
  },
}

// A UI-only diff: Codex has a model positioned for visual reasoning.
const VISUAL_SPECIALIST = { codex: r('gpt-6.1-terra', 'high') }

export const FAST_MODELS = ['haiku', 'gpt-6-luna']

const DOC_FILE = /(^|\/)(docs?\/.*|[^/]+\.(md|mdx|txt|rst)|LICENSE[^/]*)$/i
const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|liquid|html)$/i
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$/i
const MIGRATION_FILE = /(^|\/)migrations?\/|\.sql$/i

const CRITICAL_CATEGORIES = ['auth', 'billing']
const ELEVATED_CATEGORIES = ['ci-workflow', 'installer']
const DEEP_LINES = 800
const DEEP_FILES = 25
const LARGE_LINES = 500

// Each rule: [tier, reason, test]. First match wins, so order is severity order.
const TIER_RULES = [
  ['critical', 'auth or billing paths', s => s.categories.some(c => CRITICAL_CATEGORIES.includes(c))],
  ['elevated', 'CI workflow or installer paths', s => s.categories.some(c => ELEVATED_CATEGORIES.includes(c))],
  ['elevated', 'migrations or SQL', s => s.files.some(f => MIGRATION_FILE.test(f))],
  ['elevated', `more than ${DEEP_LINES} changed lines or ${DEEP_FILES} files`, s => s.lines > DEEP_LINES || s.files.length > DEEP_FILES],
  ['routine', 'documentation only', s => s.files.length > 0 && s.files.every(f => DOC_FILE.test(f))],
  ['large', `more than ${LARGE_LINES} changed lines`, s => s.lines > LARGE_LINES],
]

export function tierFor({ files = [], categories = [], lines = 0, override } = {}) {
  if (override !== undefined) {
    if (!TIERS.includes(override)) throw new Error(`unknown risk tier "${override}"; use one of ${TIERS.join(', ')}`)
    return { tier: override, tierSource: 'override', reasons: ['--risk flag'] }
  }
  const signals = { files, categories, lines }
  const hit = TIER_RULES.find(([, , test]) => test(signals))
  return hit
    ? { tier: hit[0], tierSource: 'auto', reasons: [hit[1]] }
    : { tier: 'standard', tierSource: 'auto', reasons: ['default'] }
}

export function isVisual(files = []) {
  const code = files.filter(f => !TEST_FILE.test(f) && !DOC_FILE.test(f))
  return code.length > 0 && code.every(f => UI_FILE.test(f))
}

export function routingFor(host, tier, { visual = false, crossvendor = false } = {}) {
  if (!HOSTS.includes(host)) throw new Error(`unknown host "${host}"; use one of ${HOSTS.join(', ')}`)
  if (!TIERS.includes(tier)) throw new Error(`unknown risk tier "${tier}"`)
  const column = TIERS.indexOf(tier)
  const routing = Object.fromEntries(Object.entries(MATRIX[host]).map(([role, row]) => [role, row[column]]))
  const routed = visual && VISUAL_SPECIALIST[host] ? { ...routing, specialist: VISUAL_SPECIALIST[host] } : routing
  if (!crossvendor) return routed
  const vendor = HOSTS.find(h => h !== host)
  const crossed = Object.fromEntries(GATE_ROLES.map(role =>
    [role, { ...MATRIX[vendor][role][column], vendor, hostRoute: routed[role] }]))
  return { ...routed, ...crossed }
}

const ROLE_LABELS = {
  triage: 'Triage (scan depth, first pass only)',
  specialist: 'Specialists x5 (quality, implementation, simplification, conventions, test-quality)',
  rules: 'Project rules, deps checklist',
  verifier: 'Verifier, critic re-examine, fix verifier',
  critic: 'Completeness critic (deep)',
  prover: 'Prover (writes the failing test)',
  fixer: 'Fixer (--fix)',
  polish: 'Comment polish (--post)',
  housekeeping: 'Housekeeping',
}
const MODEL_NAMES = {
  haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable',
  'gpt-6-luna': 'Luna', 'gpt-6.2-sol': 'Sol', 'gpt-6.2-astra': 'Astra', 'gpt-6.1-terra': 'Terra',
}

// The README table, rendered from MATRIX so the two cannot drift
// (tests/lekker-model-matrix.test.mjs asserts README contains it).
export function matrixMarkdown() {
  const cell = (c, x) => `${MODEL_NAMES[c.model]} ${c.effort} / ${MODEL_NAMES[x.model]} ${x.effort}`
  const rows = Object.keys(MATRIX.claude).map(role =>
    `| ${ROLE_LABELS[role]} | ${TIERS.map((_, i) => cell(MATRIX.claude[role][i], MATRIX.codex[role][i])).join(' | ')} |`)
  return [`| Agent | ${TIERS.join(' | ')} |`, `| --- |${TIERS.map(() => ' --- |').join('')}`, ...rows].join('\n')
}

function parseArgs(argv) {
  const sep = argv.indexOf('--')
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const files = sep === -1 ? [] : argv.slice(sep + 1)
  const value = name => {
    const i = flags.indexOf(name)
    return i === -1 ? undefined : flags[i + 1]
  }
  const categories = (value('--categories') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return {
    host: value('--host'), override: value('--risk'), lines: Number(value('--lines') ?? 0), categories, files,
    crossvendor: flags.includes('--crossvendor'),
  }
}

function main(argv) {
  const { host, override, lines, categories, files, crossvendor } = parseArgs(argv)
  try {
    const { tier, tierSource, reasons } = tierFor({ files, categories, lines, override })
    const visual = isVisual(files)
    const routing = routingFor(host, tier, { visual, crossvendor })
    console.log(JSON.stringify({ host, tier, tierSource, reasons, visual, ...(crossvendor ? { crossvendor } : {}), routing }))
  } catch (error) {
    console.error(`model-matrix: ${error.message}`)
    process.exit(2)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
