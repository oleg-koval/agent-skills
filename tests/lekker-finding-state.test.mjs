import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  begin, classifyThread, mergeFindings, recurringClasses, suppressedFindings,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/finding-state.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/finding-state.mjs'
const thread = (over) => ({ path: 'a.ts', line: 5, body: 'Missing null check', isResolved: false, isOutdated: false, replies: [], ...over })

test('thread outcomes map to statuses', () => {
  assert.equal(classifyThread(thread({}), 'ann'), 'open')
  assert.equal(classifyThread(thread({ isOutdated: true }), 'ann'), 'fixed')
  assert.equal(classifyThread(thread({ isResolved: true }), 'ann'), 'rejected')
  assert.equal(classifyThread(thread({ replies: [{ author: 'ann', body: 'This is intentional, see ADR' }] }), 'ann'), 'intentional')
  assert.equal(classifyThread(thread({ replies: [{ author: 'ann', body: "won't fix" }] }), 'ann'), 'rejected')
  assert.equal(classifyThread(thread({ replies: [{ author: 'bob', body: "won't fix" }] }), 'ann'), 'open')
})

test('begin counts cycles, suppresses answered findings and reports recurring classes', () => {
  const found = [{ file: 'a.ts', line: 5, title: 'Missing null check', bugClass: 'null-check' }]
  const one = mergeFindings([], found, 1)
  const two = mergeFindings(one, found, 2)
  assert.deepEqual(two[0].cycles, [1, 2])
  assert.deepEqual(recurringClasses(two), [{ class: 'null-check', cycles: 2 }])

  const out = begin({ cycle: 3, findings: two }, [thread({ replies: [{ author: 'ann', body: 'by design' }] })], 'ann')
  assert.equal(out.summary.cycle, 4)
  assert.equal(out.summary.rethink, true)
  assert.deepEqual(suppressedFindings(out.state.findings).map((f) => f.status), ['intentional'])
  assert.equal(begin({ cycle: 1, findings: [] }, [], null).summary.rethink, false)
})

test('cli persists state across begin and record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-state-'))
  const env = { ...process.env, LEKKER_STATE_DIR: dir }
  const run = (...a) => JSON.parse(execFileSync('node', [script, ...a, '--repo', 'o/r', '--target', 'pr-7'], { env, encoding: 'utf8' }))
  try {
    assert.equal(run('begin').cycle, 1)
    const f = join(dir, 'f.json')
    writeFileSync(f, JSON.stringify({ findings: [{ file: 'a.ts', line: 5, title: 'Missing null check' }] }))
    assert.equal(run('record', '--findings', f).recorded, 1)
    const t = join(dir, 't.json')
    writeFileSync(t, JSON.stringify({ prAuthor: 'ann', threads: [thread({ isResolved: true })] }))
    const second = run('begin', '--threads', t)
    assert.equal(second.cycle, 2)
    assert.equal(second.suppressed.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
