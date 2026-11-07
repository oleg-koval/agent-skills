import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ExecutionContext, isParseError, scheduleRun, TreePrinters } from '@openrewrite/rewrite'
import { AsyncCallbackInSyncArrayMethod, JavaScriptParser } from '@openrewrite/rewrite/javascript'

const packageEntry = createRequire(import.meta.url).resolve('@openrewrite/rewrite')
const packageVersion = JSON.parse(readFileSync(resolve(dirname(packageEntry), '..', 'package.json'), 'utf8')).version
assert.equal(packageVersion, '8.100.3', 'install the pinned pilot package version')

const cases = [
  { name: 'async-filter', expected: 'warning', text: 'const values = [1, 2];\nconst result = values.filter(async value => value > 1);\n' },
  { name: 'async-forEach', expected: 'warning', text: 'const values = [1, 2];\nvalues.forEach(async value => console.log(value));\n' },
  { name: 'sync-filter', expected: 'unchanged', text: 'const values = [1, 2];\nconst result = values.filter(value => value > 1);\n' },
  { name: 'async-map', expected: 'unchanged', text: 'const values = [1, 2];\nconst result = values.map(async value => value + 1);\n' },
  { name: 'custom-filter', expected: 'unchanged', text: 'class Custom { filter(callback: () => Promise<boolean>): Promise<boolean> { return callback(); } }\nnew Custom().filter(async () => true);\n' },
  { name: 'syntax-error', expected: 'unavailable', text: 'const values = [;\n' },
]
const directory = 'artifacts'
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}/expectations.json`, JSON.stringify(cases, null, 2) + '\n')

async function run() {
  const started = performance.now()
  const outcomes = []
  for (const fixture of cases) {
    const ctx = new ExecutionContext()
    const source = await new JavaScriptParser({ ctx }).parseOne({ text: fixture.text, sourcePath: `${fixture.name}.ts` })
    if (isParseError(source)) {
      outcomes.push({ name: fixture.name, status: 'unavailable', reason: 'parse-error' })
      continue
    }
    assert.equal(await TreePrinters.print(source), fixture.text, 'parse/print lost source')
    const result = await scheduleRun(new AsyncCallbackInSyncArrayMethod(), [source], ctx)
    const after = result.changeset.find(item => item.after)?.after ?? source
    const printed = await TreePrinters.print(after)
    outcomes.push({ name: fixture.name, status: printed.includes('Async callback passed to .') ? 'warning' : 'unchanged', printed, patches: await Promise.all(result.changeset.map(item => item.diff())) })
  }
  return { elapsedMs: performance.now() - started, outcomes }
}

const first = await run()
writeFileSync(`${directory}/first.json`, JSON.stringify(first, null, 2) + '\n')
const second = await run()
writeFileSync(`${directory}/second.json`, JSON.stringify(second, null, 2) + '\n')
assert.deepEqual(first.outcomes, second.outcomes, 'repeated clean-input output differs')
for (const fixture of cases) {
  const outcome = first.outcomes.find(item => item.name === fixture.name)
  assert.equal(outcome.status, fixture.expected, fixture.name)
  if (fixture.expected === 'unchanged') assert.equal(outcome.printed, fixture.text, fixture.name)
}
console.log(JSON.stringify({ packageVersion, nodeVersion: process.version, recipe: new AsyncCallbackInSyncArrayMethod().name, repeatable: true, cases: first.outcomes.map(({ name, status }) => ({ name, status })), timingMs: [first.elapsedMs, second.elapsedMs], outputSha256: createHash('sha256').update(JSON.stringify(first.outcomes)).digest('hex') }))
