#!/usr/bin/env node
// Zero-agent regression test for lekker-review's PURE logic.
//
// Why this exists: every defect found in the 2026-08-31 hardening pass was in
// pure, synchronous code - the dedup bucket key, the hard-rule exemption gate,
// the model/effort routing - yet the only way to exercise any of it was a live
// workflow run costing ~7 agents and 70+ seconds. This runs the same logic in
// milliseconds with no agents at all. Run it after ANY edit to workflow.js:
//
//   node ~/.claude/skills/lekker-review/scripts/selftest.mjs
//
// It lifts the real functions out of workflow.js by source extraction rather
// than importing, because workflow.js is written for the Workflow harness (top
// level `return`, an injected `args` global) and is not importable as a module.
import { readFileSync } from 'node:fs'
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
  liftConst('HARD_RULES'),
  (() => { try { return liftConst('SAME_ISSUE_LINE_WINDOW') } catch { return 'const SAME_ISSUE_LINE_WINDOW = 30' } })(),
  "const SEVERITY_RANK = { observation: 0, idiomatic: 1, important: 2, critical: 3 }",
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

console.log('\nhard rules: a tag must be corroborated to skip verification')
// Regression: any agent could bypass the verifier by writing rule: "TS-1".
// Observed live - a test-coverage finding and a comment-policy finding both did.
check('TS-1 on a comment-policy finding is NOT exempt',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 6, title: 'Comment restates the function', badCode: '/** Sum a cart. */', description: 'a comment earns its place' }), false)
check('TS-1 on a test-coverage finding is NOT exempt',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 8, title: 'No test coverage', badCode: 'for (let i = 1;', description: 'zero test files added' }), false)
check('an unknown rule string is NOT exempt',
  isHardRule({ rule: 'MADE-UP', file: 'a.ts', line: 1, title: 't', badCode: 'x as Foo', description: '' }), false)
// TS-1 is judged on quoted code only: prose is full of `as` and `any`.
check('the word "any" in PROSE alone is NOT exempt',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'fails on any cart with items', badCode: 'total += lines[i].price', description: 'any agent could trip this' }), false)
check('the phrase "such as" in prose alone is NOT exempt',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'issue', badCode: 'const n = 1', description: 'a primitive such as String is used' }), false)

console.log('\nhard rules: genuine violations must STILL be exempt')
check('TS-1 with a real cast',   isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'cast', badCode: 'const x = y as Foo;', description: '' }), true)
check('TS-1 with a real any',    isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'any',  badCode: 'function f(x: any) {}', description: '' }), true)
check('TS-2 with a .js path',    isHardRule({ rule: 'TS-2', file: 'web/thing.js', line: 1, title: 'js added', badCode: '', description: '' }), true)
check('GQL-1 with a nodes query',isHardRule({ rule: 'GQL-1', file: 'q.graphql', line: 1, title: 'no pageInfo', badCode: 'products { nodes { id } }', description: '' }), true)
check('PR-1 anchored on the PR title', isHardRule({ rule: 'PR-1', file: 'PR title', line: 1, title: 'missing prefix', badCode: '', description: '' }), true)
// A cast to a lowercase built-in is as much a TS-1 violation as a cast to a
// named type. Missing it sent a genuine hard rule to a verifier that cannot
// answer a policy claim, where it could be dropped.
for (const cast of ['x as string', 'x as number', 'x as unknown as Foo', 'x as const', 'x as boolean']) {
  check(`TS-1 corroborated by \`${cast}\``,
    isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'cast', badCode: cast, description: '' }), true)
}
check('TS-1 corroborated by an any annotation',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'any', badCode: 'function f(x: any) {}', description: '' }), true)
check('TS-1 corroborated by an any[] ',
  isHardRule({ rule: 'TS-1', file: 'a.ts', line: 1, title: 'any', badCode: 'const xs: any[] = []', description: '' }), true)

console.log('\nverification scope by depth')
const crit = { severity: 'critical' }, imp = { severity: 'important' }, obs = { severity: 'observation' }
check('scan verifies nothing',            [crit, imp, obs].map(f => shouldVerify(f, 'scan')),   [false, false, false])
check('medium verifies criticals only',   [crit, imp, obs].map(f => shouldVerify(f, 'medium')), [true, false, false])
check('deep verifies crit + important',   [crit, imp, obs].map(f => shouldVerify(f, 'deep')),   [true, true, false])
check('a corroborated hard rule is never verified',
  shouldVerify({ severity: 'critical', rule: 'TS-2', file: 'x.js', badCode: '', description: '', title: '' }, 'deep'), false)

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

console.log(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) FAILED\n`)
process.exit(failed === 0 ? 0 : 1)
