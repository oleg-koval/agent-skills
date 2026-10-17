#!/usr/bin/env node
// Zero-agent regression test for lekker-review's PURE logic.
//
// Why this exists: every defect found in the 2026-08-31 hardening pass was in
// pure, synchronous code - the dedup bucket key, the hard-rule exemption gate,
// the model/effort routing - yet the only way to exercise any of it was a live
// workflow run costing ~7 agents and 70+ seconds. This runs the same logic in
// milliseconds with no agents at all. Run it after ANY edit to workflow.js:
//
//   node <SKILL_ROOT>/scripts/selftest.mjs
//
// It lifts the real functions out of workflow.js by source extraction rather
// than importing, because workflow.js is written for the Workflow harness (top
// level `return`, an injected `args` global) and is not importable as a module.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
// Optional arg: a different workflow.js to test. Used to prove this suite
// actually discriminates - point it at a pre-fix backup and it must FAIL.
const target = process.argv[2] || join(SKILL, 'workflow.js')
const src = readFileSync(target, 'utf8')
console.log(`selftest target: ${target}`)

function lift(name) {
  const i = src.indexOf(`function ${name}`)
  if (i === -1) throw new Error(`selftest: function ${name} not found in workflow.js - was it renamed?`)
  let d = 0, j = i
  for (;; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') { d--; if (d === 0) break }
  }
  return src.slice(i, j + 1)
}

function liftConst(name) {
  const m = new RegExp(`^const ${name} = .*$`, 'm').exec(src)
  if (!m) throw new Error(`selftest: const ${name} not found in workflow.js`)
  return m[0]
}

const preamble = [
  // HARD_RULES is absent from the current workflow.js: the allowlist went away
  // with the exemption it gated. It is still lifted-with-a-fallback rather than
  // dropped, because this suite must stay runnable against an OLDER workflow.js
  // (see the target argument above) to prove it discriminates. Without the
  // fallback the old file throws ReferenceError instead of reporting FAIL, and a
  // suite that crashes on the pre-fix input has proved nothing.
  (() => { try { return liftConst('HARD_RULES') } catch { return 'const HARD_RULES = []' } })(),
  (() => { try { return liftConst('SAME_ISSUE_LINE_WINDOW') } catch { return 'const SAME_ISSUE_LINE_WINDOW = 30' } })(),
  "const SEVERITY_RANK = { observation: 0, idiomatic: 1, important: 2, critical: 3 }",
  // hardRuleCorroborated is likewise gone from the current file and kept in this
  // list for the same reason: an older workflow.js calls it from isHardRule.
  ...['titleTokens', 'sameIssue', 'nearbyLines', 'spanWithinWindow', 'hardRuleCorroborated',
      'isHardRule', 'longest', 'mergeFindings', 'dedup', 'shouldVerify'].map(n => {
        try { return lift(n) } catch { return `function ${n}() { throw new Error('${n} absent from this workflow.js') }` }
      }),
].join('\n')

const { dedup, isHardRule, shouldVerify, sameIssue } =
  new Function(preamble + '\nreturn { dedup, isHardRule, shouldVerify, sameIssue }')()

let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { console.log(`  ok   ${name}`) }
  else { console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`); failed++ }
}

console.log('\ndedup: the same defect anchored at different lines must merge')
// Regression: bucketing on `file:line` meant these two were never compared,
// despite a title similarity of 0.64 against a 0.4 threshold. Observed live.
const dupes = [
  { file: 'src/total.ts', line: 14, severity: 'critical', title: 'Off-by-one loop skips the first cart line', badCode: 'for (let i = 1;', description: 'aaa' },
  { file: 'src/total.ts', line: 9,  severity: 'critical', title: 'cartTotal skips the first line item (off-by-one loop start)', badCode: 'for (let i = 1;', description: 'bb' },
]
check('two anchors, one issue -> 1 finding', dedup(dupes).length, 1)
check('merge keeps the highest severity', dedup([
  { file: 'a.ts', line: 3, severity: 'observation', title: 'Off-by-one loop skips first line', badCode: '', description: '' },
  { file: 'a.ts', line: 5, severity: 'critical',    title: 'Off-by-one loop skips the first line', badCode: '', description: '' },
])[0].severity, 'critical')

console.log('\ndedup: distinct issues must NOT be merged')
check('similar titles 390 lines apart stay separate', dedup([
  { file: 'big.ts', line: 10,  severity: 'important', title: 'Missing pagination on the products query', badCode: '', description: '' },
  { file: 'big.ts', line: 400, severity: 'important', title: 'Missing pagination on the orders query',   badCode: '', description: '' },
]).length, 2)
check('same line, unrelated titles stay separate', dedup([
  { file: 'a.ts', line: 7, severity: 'important', title: 'Unbounded retry loop hides throttling', badCode: '', description: '' },
  { file: 'a.ts', line: 7, severity: 'important', title: 'Metafield namespace hardcoded in the query', badCode: '', description: '' },
]).length, 2)
// Grouping must not depend on arrival order. With only g[0] compared, findings
// at 25, 50 and 1 all joined when 25 arrived first, spanning 49 lines.
const spanCase = [
  { file: 'a.ts', line: 25, severity: 'important', title: 'Missing pagination on the query', badCode: '', description: '' },
  { file: 'a.ts', line: 50, severity: 'important', title: 'Missing pagination on the query', badCode: '', description: '' },
  { file: 'a.ts', line: 1,  severity: 'important', title: 'Missing pagination on the query', badCode: '', description: '' },
]
check('a group never spans more than the window (25, 50, 1)', dedup(spanCase).length, 2)
check('the same set in a different order gives the same answer',
  dedup([spanCase[2], spanCase[0], spanCase[1]]).length, dedup(spanCase).length)

check('different files never merge', dedup([
  { file: 'a.ts', line: 7, severity: 'critical', title: 'Off-by-one loop skips the first line', badCode: '', description: '' },
  { file: 'b.ts', line: 7, severity: 'critical', title: 'Off-by-one loop skips the first line', badCode: '', description: '' },
]).length, 2)

// This section used to assert that a `rule` tag had to be corroborated against a
// hardcoded HARD_RULES list before it could SKIP verification. That guard existed
// because a fabricated tag could buy exemption. It is gone because the exemption
// is gone: shouldVerify now returns true for every Critical and Important finding,
// and a hard rule takes the verifier's rule-specific anchor and applicability path
// instead of its runtime challenges, validated against the configured canonical
// rules file. A hardcoded list also could not recognise a custom house rule, which
// the current design supports on purpose.
//
// So the tag no longer buys a free pass; it selects a verification path. The
// predicate is correspondingly narrow: does this finding claim a rule at all.
console.log('\nhard rules: the tag selects a verification path, it does not skip one')
// Regression, still worth holding: a finding with no rule tag must never be
// treated as one. That is what routes it to the runtime challenges.
check('no rule tag is not a hard rule',
  isHardRule({ file: 'a.ts', line: 1, title: 't', badCode: 'x as Foo', description: '' }), false)
check('an empty rule tag is not a hard rule',
  isHardRule({ rule: '', file: 'a.ts', line: 1, title: 't', badCode: '', description: '' }), false)
check('a whitespace-only rule tag is not a hard rule',
  isHardRule({ rule: '   ', file: 'a.ts', line: 1, title: 't', badCode: '', description: '' }), false)
check('a non-string rule tag is not a hard rule',
  isHardRule({ rule: 1, file: 'a.ts', line: 1, title: 't', badCode: '', description: '' }), false)

console.log('\nhard rules: built-in and custom tags both route to rule-specific verification')
for (const rule of ['TS-1', 'TS-2', 'GQL-1', 'PR-1']) {
  check(`built-in ${rule} is a hard rule`,
    isHardRule({ rule, file: 'a.ts', line: 1, title: 't', badCode: '', description: '' }), true)
}
// A house rule defined in the operator's canonical rules file cannot be known to
// this workflow. Rejecting it here is what a hardcoded list did, and it silently
// disabled every custom rule a deployment configured.
check('a custom house rule is a hard rule',
  isHardRule({ rule: 'SEC-1', file: 'a.ts', line: 1, title: 't', badCode: '', description: '' }), true)

console.log('\nverification scope: depth controls breadth, never the trust bar')
const crit = { severity: 'critical' }, imp = { severity: 'important' }, obs = { severity: 'observation' }
// Depth used to be able to switch verification off entirely, which meant a
// scan-depth review shipped unverified Criticals. Only `deps` opts out now (its
// single checklist agent reports advisory facts), see the deps depth section.
check('critical and important are verified at every non-deps depth, observation is not',
  ['scan', 'medium', 'deep', undefined].map(d => [crit, imp, obs].map(f => shouldVerify(f, d))),
  Array(4).fill([true, true, false]))
check('a hard rule is NOT exempt from verification',
  shouldVerify({ severity: 'critical', rule: 'TS-2', file: 'x.js', badCode: '', description: '', title: '' }), true)
check('a custom hard rule is NOT exempt either',
  shouldVerify({ severity: 'critical', rule: 'SEC-1', file: 'x.ts', badCode: '', description: '', title: '' }), true)

// Per-host model routing is optional: a deployment may pin models per host via
// a MODEL_TABLE, or leave every agent() call to name its own model. Test it
// only when it is present, so this suite runs against either shape.
const routingAssign = /const\s+MODEL\s*=\s*MODEL_TABLE\s*\[\s*HOST\s*\]/.exec(src)
const hasRouting = Boolean(routingAssign)
// A guard that can silently disable itself is worse than no guard. If the file
// clearly HAS a MODEL_TABLE but the assignment did not parse, that is a failure,
// not a reason to skip.
if (!hasRouting && /MODEL_TABLE/.test(src)) {
  check('MODEL_TABLE is present but its assignment was not recognised', false, true)
}
if (!hasRouting) {
  console.log('\nmodel + effort routing: not configured in this workflow.js, skipped')
} else {
  console.log('\nmodel + effort routing is pinned per host, never inherited')
  const routing = new Function('input', [
    src.slice(src.indexOf('const HOST = '), routingAssign.index + routingAssign[0].length),
    'return { HOST, MODEL }',
  ].join('\n'))
  check('an absent host arg falls back to the default table', routing({}).MODEL, routing({ host: 'claude' }).MODEL)
  check('an unknown host falls back to the default, not an invalid model', routing({ host: 'nonsense' }).HOST, 'claude')
  check('host matching is case-insensitive', routing({ host: 'CODEX' }).HOST, 'codex')
  // Every role must resolve to a non-empty model, and effort must be set.
  for (const host of ['claude', 'codex']) {
    const m = routing({ host }).MODEL
    const roles = Object.keys(m).filter(k => k !== 'effort')
    check(`${host}: every role resolves to a model`, roles.every(r => typeof m[r] === 'string' && m[r].length > 0), true)
    check(`${host}: effort is set`, typeof m.effort === 'string' && m.effort.length > 0, true)
  }
}

console.log('\nrevmux adapter: fixture mapping')
{
  const { execFileSync, spawnSync } = await import('node:child_process')
  const fixturePath = join(SKILL, 'scripts', 'fixtures', 'revmux-report.json')
  const contextPath = join(SKILL, 'scripts', 'fixtures', 'context.json')
  const pricingPath = join(SKILL, 'references', 'pricing.json')
  const adapterPath = join(SKILL, 'scripts', 'revmux-adapter.mjs')
  const adapterArgs = [adapterPath, fixturePath, '--pricing', pricingPath, '--context', contextPath]
  const out = execFileSync('node', adapterArgs, { encoding: 'utf8' })
  const adapted = JSON.parse(out)

  check('engine tag', adapted.engine, 'revmux')
  check('critical confirmed kept critical',
    adapted.findings.some(f => f.title.includes('Race between webhook retry') && f.severity === 'critical'), true)
  check('major refined -> important, agreedBy from 2 sources',
    (() => {
      const f = adapted.findings.find(f => f.title.includes('Discount stacking'))
      return f && f.severity === 'important' && Array.isArray(f.agreedBy) && f.agreedBy.length === 2
    })(), true)
  check('minor + lekker-conventions lens -> idiomatic',
    adapted.findings.find(f => f.title.includes('naming matrix'))?.severity, 'idiomatic')
  check('immaterial verdict dropped, not re-promoted',
    adapted.findings.some(f => f.title.includes('Unused import')), false)
  check('rejected non-hard-rule dropped',
    adapted.findings.some(f => f.title.includes('double-count a tip')), false)
  check('TS-1 rejected but corroborated by quoted code IS re-promoted to critical',
    (() => {
      const f = adapted.findings.find(f => f.title.includes('Unsafe cast on inventory adjustment'))
      return f && f.severity === 'critical' && f.rule === 'TS-1'
    })(), true)
  check('TS-1 rejected with no corroborating code stays dropped',
    adapted.findings.some(f => f.title.includes('Type safety concern in inventory handler')), false)
  check('prose without an extracted snippet leaves badCode empty',
    adapted.findings.find(f => f.title.includes('no retry backoff'))?.badCode, '')
  check('configured custom hard rule with quoted code is re-promoted',
    adapted.findings.find(f => f.title.includes('Session token is logged'))?.severity, 'critical')
  check('configured custom hard rule without quoted code stays dropped',
    adapted.findings.some(f => f.title.includes('Possible session concern')), false)
  check('pre_existing becomes observation with Pre-existing: prefix',
    (() => {
      const f = adapted.findings.find(f => f.title.includes('no retry backoff'))
      return f && f.severity === 'observation' && f.description.startsWith('Pre-existing:')
    })(), true)
  check('open_questions pass through as questions',
    adapted.questions.length, 1)
  check('degraded agent surfaced by name',
    adapted.degraded, ['adversarial'])
  check('droppedCount counts four rejected or immaterial findings', adapted.droppedCount, 4)
  check('hardRuleCount counts built-in and custom re-promotions', adapted.hardRuleCount, 2)
  check('totalUsd computed from known pricing', typeof adapted.totalUsd === 'number' && adapted.totalUsd > 0, true)
  check('malformed token rows do not make totalUsd NaN', Number.isFinite(adapted.totalUsd), true)
  check('malformed token rows keep their own usd unknown',
    adapted.agents.find(a => a.name === 'malformed-cost')?.usd, null)
  check('no pricingMissing when all models are priced', adapted.pricingMissing, undefined)
  check('test-quality coverage verdict is populated from attributed findings',
    adapted.coverageVerdict.includes('Operator-flip mutation'), true)
  check('mutation-slip summary is populated from attributed findings',
    adapted.mutationSlip.includes('retry guard'), true)
  check('mock smells are structured from attributed findings', adapted.mockSmells.length, 1)

  const noPricingOut = execFileSync('node', [adapterPath, fixturePath, '--context', contextPath], { encoding: 'utf8' })
  const noPricingAdapted = JSON.parse(noPricingOut)
  check('without a pricing file every model is pricingMissing',
    noPricingAdapted.pricingMissing?.includes('claude-sonnet-5'), true)
  check('without a pricing file totalUsd is null', noPricingAdapted.totalUsd, null)

  for (const [label, badArgs] of [
    ['report', [adapterPath, join(SKILL, 'SKILL.md')]],
    ['pricing', [adapterPath, fixturePath, '--pricing', join(SKILL, 'SKILL.md'), '--context', contextPath]],
  ]) {
    const failedRun = spawnSync('node', badArgs, { encoding: 'utf8' })
    check(`invalid ${label} JSON exits 2`, failedRun.status, 2)
    check(`invalid ${label} JSON has a clear error`, failedRun.stderr.includes(`${label} JSON`), true)
  }
}

console.log('\ncloser picker: pool, exact rendering, fail-soft and --check')
{
  const { spawnSync } = await import('node:child_process')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pickerPath = join(SKILL, 'scripts', 'pick-closer.mjs')
  const { VERDICTS, render, loadPool } = await import(pickerPath)
  const run = (args, pool) => spawnSync('node', [pickerPath, ...args], {
    encoding: 'utf8', env: { ...process.env, ...(pool ? { LEKKER_FUN_FILE: pool } : {}) },
  })
  const tmp = mkdtempSync(join(tmpdir(), 'lekker-fun-'))
  const writePool = (name, body) => {
    const p = join(tmp, name)
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
    return p
  }

  check('fun.json passes --check', run(['--check']).status, 0)
  for (const item of loadPool()) {
    const r = render(item)
    check(`renders ${item.url}`, r.md_github.includes(item.kind === 'xkcd' ? item.img : item.url) && r.md_terminal.endsWith(item.url), true)
  }

  const xkcd = { num: 1, title: 'T', url: 'https://xkcd.com/1/', img: 'https://imgs.xkcd.com/1.png', verdicts: ['lgtm'] }
  const gif = { url: 'https://media.giphy.com/media/x/giphy.gif', alt: 'Nod', verdicts: ['lgtm-with-changes', 'needs-work'] }
  check('xkcd md_terminal', render({ kind: 'xkcd', ...xkcd }).md_terminal, '🎲 xkcd #1 "T" - https://xkcd.com/1/')
  check('xkcd md_github', render({ kind: 'xkcd', ...xkcd }).md_github, '![xkcd #1 "T"](https://imgs.xkcd.com/1.png)\n[xkcd #1 "T"](https://xkcd.com/1/)')
  check('gif md_terminal', render({ kind: 'gif', ...gif }).md_terminal, '🎬 Nod - https://media.giphy.com/media/x/giphy.gif')
  check('gif md_github', render({ kind: 'gif', ...gif }).md_github, '![Nod](https://media.giphy.com/media/x/giphy.gif)')

  // One entry per verdict makes the random pick deterministic.
  const fixture = writePool('fixture.json', { xkcd: [xkcd], gifs: [gif] })
  for (const verdict of VERDICTS) {
    const out = run(['--verdict', verdict], fixture)
    const expected = render(verdict === 'lgtm' ? { kind: 'xkcd', ...xkcd } : { kind: 'gif', ...gif })
    check(`${verdict}: picks the matching fixture entry`, out.stdout ? JSON.parse(out.stdout).md_github : null, expected.md_github)
  }

  for (const [label, pool] of [['missing pool', join(tmp, 'missing.json')], ['malformed pool', writePool('bad.json', '{not json')]]) {
    const out = run(['--verdict', 'lgtm'], pool)
    check(`${label} fails soft (exit 0, no output)`, [out.status, out.stdout], [0, ''])
  }

  for (const [label, pool] of [
    ['unknown verdict', { xkcd: [xkcd], gifs: [{ ...gif, verdicts: ['lgtm-with-changes', 'needs-work', 'meh'] }] }],
    ['xkcd without img', { xkcd: [{ ...xkcd, img: '' }], gifs: [gif] }],
    ['bracket in title', { xkcd: [{ ...xkcd, title: 'a]b' }], gifs: [gif] }],
    ['uncovered verdict', { xkcd: [xkcd], gifs: [{ ...gif, verdicts: ['needs-work'] }] }],
    ['em dash in alt', { xkcd: [xkcd], gifs: [{ ...gif, alt: 'a \u2014 b' }] }],
  ]) {
    check(`--check rejects ${label}`, run(['--check'], writePool(`${label.replace(/ /g, '-')}.json`, pool)).status, 1)
  }

  const read = f => readFileSync(join(SKILL, f), 'utf8')
  check('SKILL.md documents --no-fun', read('SKILL.md').includes('--no-fun') && read('SKILL.md').includes('FUN=false'), true)
  const fmt = read('references/output-format.md')
  check('Closer section follows the Review Cost pricing notes', fmt.indexOf('## 🎲 Closer') > fmt.indexOf('Per-MTok pricing'), true)
  check('github-post and artifact-page both use CLOSER', read('references/github-post.md').includes('CLOSER') && read('references/artifact-page.md').includes('CLOSER'), true)
}

console.log('\ndeps depth: routing, classifier, line validation')
{
  const dimsSrc = (() => { try { return lift('dimensionsFor') } catch { return null } })()
  check('workflow.js defines dimensionsFor', Boolean(dimsSrc), true)
  if (dimsSrc) {
    const dimensionsFor = new Function(dimsSrc + '\nreturn dimensionsFor')()
    const M = { review: 'r', triage: 't' }
    check('deps runs exactly one agent', dimensionsFor('deps', M).map(d => d.file), ['deps.md'])
    check('scan still runs the triage pair', dimensionsFor('scan', M).length, 2)
    check('medium still runs five specialists', dimensionsFor('medium', M).length, 5)
    check('every dimension prompt file exists',
      ['deps', 'scan', 'medium'].flatMap(d => dimensionsFor(d, M)).every(d => existsSync(join(SKILL, 'references', 'agents', d.file))), true)
  }
  check('deps verifies nothing', [crit, imp, obs].map(f => shouldVerify(f, 'deps')), [false, false, false])
  check('scan still verifies Criticals and Importants', [crit, imp, obs].map(f => shouldVerify(f, 'scan')), [true, true, false])
  check('deps skips the prover', /depth !== 'scan' && depth !== 'deps'/.test(src), true)

  const { classify } = await import(join(SKILL, 'scripts', 'deps-only.mjs'))
  const pkg = o => JSON.stringify(o)
  const files = {
    'BASE:web/package.json': pkg({ name: 'web', scripts: { t: 'vitest' }, devDependencies: { vitest: '^3.2.0' }, engines: { node: '>=20' } }),
    'HEAD:web/package.json': pkg({ name: 'web', scripts: { t: 'vitest' }, devDependencies: { vitest: '^3.2.4' }, overrides: { tinypool: '^2.1.2' }, engines: { node: '>=20' } }),
    'BASE:eng/package.json': pkg({ name: 'eng', engines: { node: '>=20' } }),
    'HEAD:eng/package.json': pkg({ name: 'eng', engines: { node: '>=24' } }),
    'BASE:mix/package.json': pkg({ name: 'mix', scripts: { t: 'jest' }, dependencies: { a: '1' } }),
    'HEAD:mix/package.json': pkg({ name: 'mix', scripts: { t: 'vitest' }, dependencies: { a: '2' } }),
  }
  const readAt = (rev, p) => files[`${rev}:${p}`] ?? null
  const deps = classify(['package-lock.json', 'web/package.json', 'web/package-lock.json'], readAt)
  check('lockfiles + dep keys -> deps', deps.kind, 'deps')
  check('deps reports the changed dep keys', deps.packageJsons[0].depKeysChanged, ['devDependencies', 'overrides'])
  check('deps reports each lockfile dir', deps.lockDirs, ['.', 'web'])
  check('engines-only change -> deps', classify(['eng/package.json'], readAt).kind, 'deps')
  check('a scripts change -> mixed', classify(['mix/package.json', 'package-lock.json'], readAt).kind, 'mixed')
  check('a source file -> mixed', classify(['package-lock.json', 'web/src/a.ts'], readAt).kind, 'mixed')
  check('an added package.json -> mixed', classify(['new/package.json'], readAt).kind, 'mixed')

  const { validate, loadDedup } = await import(join(SKILL, 'scripts', 'validate-lines.mjs'))
  const { mkdtempSync, writeFileSync: wf, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const wt = mkdtempSync(join(tmpdir(), 'lekker-lines-'))
  mkdirSync(join(wt, 'web'))
  const body = Array.from({ length: 80 }, (_, i) => `  "pad${i}": "x",`)
  body[69] = '    "tinypool": "^2.1.2"'
  wf(join(wt, 'web', 'package.json'), body.join('\n'))
  const dedupFn = loadDedup(target)
  const f = (line, badCode, title = 'tinypool override forces a major') =>
    ({ file: 'web/package.json', line, severity: 'observation', title, description: '', badCode, fix: '' })
  const r = validate([
    f(398, '+    "tinypool": "^2.1.2"'),
    f(70, '"tinypool": "^2.1.2"', 'tinypool override forces a major vitest does not declare'),
    f(12, 'something that is not in the file at all', 'phantom'),
    f(71, '"tinypool": "^2.1.2"', 'near enough'),
    { file: 'CI: checks / audit', line: 1, severity: 'observation', title: 'ci', description: '', badCode: 'x', fix: '' },
  ], wt, dedupFn)
  check('diff line 398 is re-anchored to file line 70, then merged with its twin',
    r.findings.filter(x => x.line === 70 && /tinypool/.test(x.title)).length, 1)
  check('an unfindable badCode nulls the line', r.findings.find(x => x.title === 'phantom')?.line, null)
  check('within +-3 lines is kept', r.findings.some(x => x.line === 71 || x.title === 'near enough'), true)
  check('a non-file anchor is left alone', r.findings.find(x => x.title === 'ci')?.line, 1)
  check('summary counts', [r.summary.remapped, r.summary.nulled, r.summary.unchecked], [1, 1, 1])
}

console.log('\nbot pre-emption: lint pre-flight, pattern mining, precision store')
{
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, mkdirSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const tmp = mkdtempSync(join(tmpdir(), 'lekker-bots-'))
  const script = name => join(SKILL, 'scripts', name)

  const lint = (name, content) => {
    const inPath = join(tmp, `${name}.json`)
    const outPath = join(tmp, `${name}.out.json`)
    if (content !== undefined) wf(inPath, content)
    const res = spawnSync('node', [script('lint-findings.mjs'), inPath, outPath], {
      encoding: 'utf8', env: { ...process.env, LEKKER_WORKTREE_PATH: '/wt' },
    })
    return { status: res.status, out: JSON.parse(rf(outPath, 'utf8')) }
  }
  const msg = (ruleId, line, severity = 2, fix) => ({ ruleId, line, column: 1, severity, message: `${ruleId} hit`, ...(fix ? { fix } : {}) })
  const report = JSON.stringify([
    { filePath: '/wt/web/a.ts', messages: [msg('no-unused-vars', 3), msg('no-console', 9, 1), msg('no-unused-vars', 7, 2, { range: [0, 1], text: '' })] },
    { filePath: '/wt/web/b.ts', messages: [msg('no-unused-vars', 1)] },
    { filePath: '/wt/web/c.ts', messages: [] },
  ])
  const issues = lint('issues', report)
  check('lint: one finding per rule, errors first', issues.out.findings.map(f => f.rule), ['LINT:no-unused-vars', 'LINT:no-console'])
  check('lint: error -> important, warning -> idiomatic', issues.out.findings.map(f => f.severity), ['important', 'idiomatic'])
  check('lint: paths relative to the worktree', issues.out.findings[0].file, 'web/a.ts')
  check('lint: fixable and site count carried', [issues.out.findings[0].lintFixable, issues.out.findings[0].lintSiteCount], [true, 3])
  check('lint: every finding is botPredicted', issues.out.findings.every(f => f.botPredicted === true), true)
  check('lint: summary', [issues.out.summary.status, issues.out.summary.messageCount, issues.out.summary.ruleCount], ['issues', 4, 2])
  check('lint: a report with no messages is clean', lint('clean', '[{"filePath":"/wt/a.ts","messages":[]}]').out.summary.status, 'clean')
  check('lint: an empty report is not clean', lint('empty', '').out.summary.status, 'empty-report')
  check('lint: a non-array report is not clean', lint('obj', '{}').out.summary.status, 'not-an-eslint-json-report')
  const missing = lint('missing')
  check('lint: a missing report is unknown, exit 0', [missing.status, missing.out.summary.status.startsWith('unreadable:')], [0, true])

  const store = join(tmp, 'precision.jsonl')
  const prec = args => spawnSync('node', [script('bot-precision.mjs'), ...args, '--jsonl', store], { encoding: 'utf8' })
  const predicted = join(tmp, 'issues.out.json')
  const rec = prec(['record', '--repo', 'acme/app', '--pr', '7', '--predicted', predicted])
  check('precision: record appends one prediction', [rec.status, JSON.parse(rf(store, 'utf8').trim()).predictedCount], [0, 2])
  check('precision: lint findings are tagged lint-preflight',
    JSON.parse(rf(store, 'utf8').trim()).predicted.every(p => p.source === 'lint-preflight'), true)
  check('precision: no prediction scores as nothing, not 0%', /no recorded prediction/.test(prec(['score', '--repo', 'acme/app', '--pr', '8']).stdout), true)
  check('precision: summary with no scores', /no scored reviews yet/.test(prec(['summary']).stdout), true)

  // Stub gh on PATH so the miner runs offline against a fixed comment set.
  const bin = join(tmp, 'bin')
  mkdirSync(bin)
  const comments = [
    ...[1, 2, 3].map(i => ({ user: { login: 'greptile-apps[bot]' }, path: 'src/a.ts', html_url: `https://x/${i}`, body: 'This type cast bypasses the compiler and hides a real mismatch here.' })),
    { user: { login: 'gemini-code-assist[bot]' }, path: 'src/b.ts', html_url: 'https://x/4', body: 'The promise is not awaited, so errors are silently ignored by the caller.' },
    { user: { login: 'a-human' }, path: 'src/c.ts', html_url: 'https://x/5', body: 'Humans are not mined, only the bots are counted here.' },
  ]
  wf(join(tmp, 'comments.json'), JSON.stringify([comments]))
  wf(join(bin, 'gh'), `#!/bin/sh\ncat "${join(tmp, 'comments.json')}"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  const out = join(tmp, 'patterns.md')
  const mine = slug => spawnSync('bash', [script('mine-bot-comments.sh'), slug, out], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  const m1 = mine('acme/app')
  const md1 = rf(out, 'utf8')
  check('mine: exit 0 and a section for the repo', [m1.status, md1.includes('## acme/app\n')], [0, true])
  check('mine: counts only bot comments', /Mined from 4 bot review comment/.test(md1), true)
  check('mine: a repeated claim is one pattern with its count', /\*\*x3\*\* - This type cast/.test(md1), true)
  check('mine: categories table', /\| 3 \| type cast \/ any \|/.test(md1), true)
  mine('acme/other')
  mine('acme/app')
  const md2 = rf(out, 'utf8')
  check('mine: re-mining replaces the section, other repos kept',
    [md2.split('## acme/app\n').length - 1, md2.includes('## acme/other\n')], [1, true])

  check('workflow.js tells agents not to re-report the pre-flight', src.includes('"preflightFile"'), true)
  const skillMd = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  check('SKILL.md passes preflightFile and botPatternsFile in CONTEXT_FILE',
    skillMd.includes('"preflightFile":') && skillMd.includes('"botPatternsFile":'), true)
}

console.log(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) FAILED\n`)
process.exit(failed === 0 ? 0 : 1)
