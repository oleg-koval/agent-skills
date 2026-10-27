import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PENALTIES = {
  refuted_load_bearing: 25,
  refuted: 10,
  unverifiable_load_bearing: 10,
  unverifiable: 4,
  inferred_accepted: 5,
  missed_load_bearing: 15,
  missed: 5,
  only_critic_found: 5,
}

const ORIGINS = ['author', 'critic', 'both']
const STATUSES = ['verified', 'refuted', 'unverifiable', 'inferred']
const CHECKED_BY = ['command', 'read', 'inferred']

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.length > 0

const enumError = (path, field, value, allowed) => {
  if (value === undefined) return [`${path}.${field} missing`]
  return allowed.includes(value) ? [] : [`${path}.${field} invalid: ${value}`]
}

const claimErrors = (c, i) => {
  const path = `claims[${i}]`
  if (!isRecord(c)) return [`${path} invalid: not an object`]
  return [
    ...(isText(c.id) ? [] : [`${path}.id missing`]),
    ...(isText(c.text) ? [] : [`${path}.text missing`]),
    ...(typeof c.load_bearing === 'boolean' ? [] : [`${path}.load_bearing missing`]),
    ...enumError(path, 'origin', c.origin, ORIGINS),
    ...enumError(path, 'status', c.status, STATUSES),
    ...enumError(path, 'checked_by', c.checked_by, CHECKED_BY),
    ...(c.status === 'refuted' && c.checked_by === 'inferred'
      ? [`${path}.checked_by: a refuted claim must be checked by command or read`]
      : []),
  ]
}

const missedErrors = (m, i) => {
  const path = `missed[${i}]`
  if (!isRecord(m)) return [`${path} invalid: not an object`]
  return [
    ...(isText(m.id) ? [] : [`${path}.id missing`]),
    ...(isText(m.text) ? [] : [`${path}.text missing`]),
    ...(typeof m.load_bearing === 'boolean' ? [] : [`${path}.load_bearing missing`]),
    ...enumError(path, 'checked_by', m.checked_by, CHECKED_BY),
  ]
}

export const validateLedger = (ledger) => {
  if (!isRecord(ledger)) return ['ledger invalid: not an object']
  if (!Array.isArray(ledger.claims)) return ['claims missing']
  if (!Array.isArray(ledger.missed)) return ['missed missing']
  return [...ledger.claims.flatMap(claimErrors), ...ledger.missed.flatMap(missedErrors)]
}

const claimPenalties = (c) => {
  const lb = c.load_bearing
  const byStatus = {
    refuted: [lb ? 'refuted_load_bearing' : 'refuted'],
    unverifiable: [lb ? 'unverifiable_load_bearing' : 'unverifiable'],
    inferred: ['inferred_accepted'],
    verified: c.origin === 'critic' ? ['only_critic_found'] : [],
  }
  return byStatus[c.status]
}

const missedPenalty = (m) => (m.load_bearing ? 'missed_load_bearing' : 'missed')

const tally = (keys) =>
  keys.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + PENALTIES[k] }), {})

export const scoreLedger = (ledger) => {
  const breakdown = tally([...ledger.claims.flatMap(claimPenalties), ...ledger.missed.filter((m) => m.checked_by !== 'inferred').map(missedPenalty)])
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score: Math.max(0, 100 - total), breakdown }
}

export const ratchet = (prev, next) => {
  const p = scoreLedger(prev).score
  const n = scoreLedger(next).score
  return p > n ? { winner: 'prev', score: p } : { winner: 'next', score: n }
}

const mk = (id, lb, status) => ({
  id,
  text: `claim ${id}`,
  load_bearing: lb,
  origin: 'both',
  status,
  checked_by: status === 'inferred' ? 'inferred' : 'read',
  receipt: 'anchor',
})

// 95 = 5 (one inferred); 72 = 10+10+4+4; 40 = 25+25+10
const ANCHOR_LEDGERS = [
  { label: 'strong', claims: [mk('a1', false, 'inferred')] },
  { label: 'middling', claims: [mk('b1', false, 'refuted'), mk('b2', false, 'refuted'), mk('b3', false, 'unverifiable'), mk('b4', false, 'unverifiable')] },
  { label: 'weak', claims: [mk('c1', true, 'refuted'), mk('c2', true, 'refuted'), mk('c3', true, 'unverifiable')] },
]

export const anchors = () =>
  ANCHOR_LEDGERS.map(({ label, claims }) => {
    const ledger = { version: 1, claims, missed: [] }
    return { label, ledger, score: scoreLedger(ledger).score }
  })

const cell = (s) => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')

const claimRow = (c) =>
  `| ${[c.id, c.text, c.origin, c.status, c.checked_by, c.receipt].map(cell).join(' | ')} |`

export const summaryMarkdown = (ledger) =>
  [
    '| id | claim | origin | status | checked_by | receipt |',
    '| --- | --- | --- | --- | --- | --- |',
    ...ledger.claims.map(claimRow),
  ].join('\n')

const fail = (message) => {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`)
  process.exit(2)
}

const loadLedger = (path) => {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return fail(`cannot read ${path}: ${e.message}`)
  }
  const errors = validateLedger(parsed)
  if (errors.length > 0) return fail(errors.join('; '))
  return parsed
}

const COMMANDS = {
  score: ([a]) => scoreLedger(loadLedger(a)),
  ratchet: ([a, b]) => ratchet(loadLedger(a), loadLedger(b)),
  anchors: () => anchors(),
  summary: ([a]) => summaryMarkdown(loadLedger(a)),
}

const main = (argv) => {
  const [cmd, ...args] = argv
  const run = COMMANDS[cmd]
  if (!run) return fail(`unknown command: ${cmd}`)
  const out = run(args)
  process.stdout.write(typeof out === 'string' ? `${out}\n` : `${JSON.stringify(out, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
