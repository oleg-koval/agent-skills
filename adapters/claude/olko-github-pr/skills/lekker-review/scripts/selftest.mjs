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
// shouldVerify takes one argument now. Depth used to be able to switch verification
// off entirely, which meant a scan-depth review shipped unverified Criticals.
check('shouldVerify takes the finding alone', shouldVerify.length, 1)
check('critical and important are verified, observation is not',
  [crit, imp, obs].map(f => shouldVerify(f)), [true, true, false])
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

console.log(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) FAILED\n`)
process.exit(failed === 0 ? 0 : 1)
