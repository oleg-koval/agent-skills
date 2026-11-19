import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

export const PENALTIES = {
  refuted_load_bearing: 25,
  refuted: 10,
  unverifiable_load_bearing: 10,
  unverifiable: 4,
  inferred_accepted: 5,
  inferred_accepted_load_bearing: 10,
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
    ...(['verified', 'refuted'].includes(c.status) && c.checked_by === 'inferred'
      ? [`${path}.checked_by: verified and refuted claims must be checked by command or read`]
      : []),
    ...(['verified', 'refuted'].includes(c.status) && !(typeof c.receipt === 'string' && c.receipt.trim().length > 0)
      ? [`${path}.receipt: verified and refuted claims require a non-empty receipt`]
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
    inferred: [lb ? 'inferred_accepted_load_bearing' : 'inferred_accepted'],
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

const asArray = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v])

const duplicateIdErrors = (ledger) => {
  const ids = [...ledger.claims, ...ledger.missed].map((x) => x.id)
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].map((id) => `duplicate id: ${id}`)
}

// Every author claim is accounted for, and every claim the author owns names it.
const authorErrors = (ledger, author) => {
  if (!Array.isArray(author)) return ['author claims invalid: not an array']
  const known = new Set(author.map((a) => a.id))
  const used = new Set(ledger.claims.flatMap((c) => asArray(c.author_id)))
  const perClaim = ledger.claims.flatMap((c, i) => {
    const path = `claims[${i}]`
    if (c.origin === 'critic') {
      return c.author_id === undefined ? [] : [`${path}.author_id: origin critic must not name an author claim`]
    }
    return known.has(c.author_id) ? [] : [`${path}.author_id: origin ${c.origin} needs an author claim id, got ${c.author_id}`]
  })
  const dropped = [...known].filter((id) => !used.has(id)).map((id) => `author claim ${id} has no ledger entry`)
  return [...perClaim, ...dropped]
}

// critic maps a round label ("r1") to that round's raw critic JSON. A critic_ref is "r1:claims.0" or "r1:missed.2".
const criticRefs = (critic) =>
  Object.entries(critic).flatMap(([label, out]) => [
    ...asArray(out?.claims).map((_, i) => `${label}:claims.${i}`),
    ...asArray(out?.missed).map((_, i) => `${label}:missed.${i}`),
  ])

const criticErrors = (ledger, critic) => {
  const valid = new Set(criticRefs(critic))
  const entries = [
    ...ledger.claims.map((c, i) => [`claims[${i}]`, c]),
    ...ledger.missed.map((m, i) => [`missed[${i}]`, m]),
  ]
  const used = new Set(entries.flatMap(([, e]) => asArray(e.critic_ref)))
  const perEntry = entries.flatMap(([path, e]) => {
    const refs = asArray(e.critic_ref)
    const unknown = refs.filter((r) => !valid.has(r)).map((r) => `${path}.critic_ref: unknown ${r}`)
    if (e.origin === 'author') {
      return refs.length === 0 ? unknown : [...unknown, `${path}.critic_ref: origin author must not cite the critic`]
    }
    return refs.length === 0 ? [...unknown, `${path}.critic_ref: missing, name the critic item this entry came from`] : unknown
  })
  const dropped = [...valid].filter((r) => !used.has(r)).map((r) => `critic item ${r} has no ledger entry`)
  return [...perEntry, ...dropped]
}

// A revision may add claims, never silently drop one.
const carryErrors = (ledger, prev) => {
  const have = new Set(ledger.claims.map((c) => c.id))
  return prev.claims.filter((c) => !have.has(c.id)).map((c) => `claim ${c.id} from the previous ledger is missing`)
}

export const integrityErrors = (ledger, { author, critic, prev } = {}) => [
  ...duplicateIdErrors(ledger),
  ...(author ? authorErrors(ledger, author) : []),
  ...(critic ? criticErrors(ledger, critic) : []),
  ...(prev ? carryErrors(ledger, prev) : []),
]

const isOpenClaim = (c) => c.status !== 'verified'
const isOpenMissed = (m) => m.checked_by !== 'inferred'

export const openDefects = (ledger) => ({
  load_bearing:
    ledger.claims.filter((c) => isOpenClaim(c) && c.load_bearing).length +
    ledger.missed.filter((m) => isOpenMissed(m) && m.load_bearing).length,
  other:
    ledger.claims.filter((c) => isOpenClaim(c) && !c.load_bearing).length +
    ledger.missed.filter((m) => isOpenMissed(m) && !m.load_bearing).length,
})

// The kept ledger is the ratchet winner across rounds; a later round wins ties.
const winnerIndex = (ledgers) =>
  ledgers.reduce((best, l, i) => (scoreLedger(l).score >= scoreLedger(ledgers[best]).score ? i : best), 0)

// ledgers are in round order. done means the kept ledger has no load-bearing item left open.
export const statusOf = (ledgers) => {
  const trajectory = ledgers.map((l) => scoreLedger(l).score)
  const kept = winnerIndex(ledgers)
  const open = openDefects(ledgers[kept])
  return {
    rounds: ledgers.length,
    first_score: trajectory[0],
    final_score: trajectory[kept],
    kept: kept + 1,
    trajectory,
    open,
    done: open.load_bearing === 0,
  }
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

// 95 = 5 (one inferred, not load-bearing); 72 = 10+10+4+4; 40 = 25+25+10
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

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return fail(`cannot read ${path}: ${e.message}`)
  }
}

const loadLedger = (path) => {
  const parsed = readJson(path)
  const errors = validateLedger(parsed)
  if (errors.length > 0) return fail(errors.join('; '))
  return parsed
}

const OPTIONS = {
  author: { type: 'string' },
  critic: { type: 'string', multiple: true },
  prev: { type: 'string' },
}

const criticFromFlags = (specs) =>
  Object.fromEntries(
    specs.map((spec) => {
      const at = spec.indexOf('=')
      return at < 1 ? fail(`--critic needs <label>=<path>, got ${spec}`) : [spec.slice(0, at), readJson(spec.slice(at + 1))]
    }),
  )

const contextFrom = (flags, prevPath) => {
  const given = flags.author !== undefined || flags.critic !== undefined || prevPath !== undefined
  return {
    given,
    author: flags.author === undefined ? undefined : readJson(flags.author),
    critic: flags.critic === undefined ? undefined : criticFromFlags(flags.critic),
    prev: prevPath === undefined ? undefined : loadLedger(prevPath),
  }
}

const checked = (ledger, context) => {
  const errors = integrityErrors(ledger, context)
  return errors.length > 0 ? fail(errors.join('; ')) : (context.given ? 'checked' : 'unchecked')
}

const withIntegrity = (ledger, flags, prevPath) => ({ ledger, integrity: checked(ledger, contextFrom(flags, prevPath)) })

const COMMANDS = {
  score: ([a], flags) => {
    const { ledger, integrity } = withIntegrity(loadLedger(a), flags, flags.prev)
    return { ...scoreLedger(ledger), integrity }
  },
  check: ([a], flags) => ({ ok: true, integrity: withIntegrity(loadLedger(a), flags, flags.prev).integrity }),
  ratchet: ([a, b], flags) => {
    const { ledger, integrity } = withIntegrity(loadLedger(b), flags, a)
    return { ...ratchet(loadLedger(a), ledger), integrity }
  },
  status: (paths) => statusOf(paths.map(loadLedger)),
  anchors: () => anchors(),
  summary: ([a]) => summaryMarkdown(loadLedger(a)),
}

const main = (argv) => {
  const [cmd, ...rest] = argv
  const run = COMMANDS[cmd]
  if (!run) return fail(`unknown command: ${cmd}`)
  const { values, positionals } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true })
  const out = run(positionals, values)
  process.stdout.write(typeof out === 'string' ? `${out}\n` : `${JSON.stringify(out, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
