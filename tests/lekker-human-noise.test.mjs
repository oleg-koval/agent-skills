import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  agentOf, classifyLekkerThread, fetchPr, summarize,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/human-noise.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/human-noise.mjs'
const lekker = (agent, text = 'Add a null check.') => ({ author: 'oleg', body: `${text}\n<!-- lekker:${agent} -->` })
const thread = (over) => ({ path: 'a.ts', line: 3, isResolved: false, isOutdated: false, comments: [lekker('quality')], ...over })

test('only comments carrying the lekker marker are identified', () => {
  assert.equal(agentOf('Add a check.\n<!-- lekker:test-quality -->'), 'test-quality')
  assert.equal(agentOf('a human comment'), null)
  assert.equal(classifyLekkerThread(thread({ comments: [{ author: 'oleg', body: 'human' }] }), 'ann'), null)
})

test('outcomes: fixed, dismissed by reply, dismissed by resolve, ignored', () => {
  const outcome = (t) => classifyLekkerThread(t, 'ann').outcome
  assert.equal(outcome(thread({ isOutdated: true })), 'fixed')
  assert.equal(outcome(thread({ comments: [lekker('quality'), { author: 'ann', body: 'This is by design' }] })), 'dismissed')
  assert.equal(outcome(thread({ isResolved: true })), 'dismissed')
  assert.equal(outcome(thread({})), 'ignored')
  assert.equal(outcome(thread({ comments: [lekker('quality'), { author: 'bob', body: "won't fix" }] })), 'ignored')
})

test('dismissal rate is reported per agent', () => {
  const s = summarize([{ prAuthor: 'ann', threads: [
    thread({ comments: [lekker('quality')], isResolved: true }),
    thread({ comments: [lekker('quality')], isOutdated: true }),
    thread({ comments: [lekker('implementation')] }),
    thread({ comments: [{ author: 'oleg', body: 'plain human comment' }] }),
  ] }])
  assert.equal(s.comments, 3)
  const q = s.agents.find((a) => a.agent === 'quality')
  assert.deepEqual([q.total, q.fixed, q.dismissed, q.dismissalRate], [2, 1, 1, 0.5])
  assert.equal(s.agents.find((a) => a.agent === 'implementation').dismissalRate, 0)
})

test('fetchPr shapes the graphql response', () => {
  const fake = () => JSON.stringify({ data: { repository: { pullRequest: {
    author: { login: 'ann' },
    reviewThreads: { nodes: [{ isResolved: true, isOutdated: false, path: 'a.ts', line: 3,
      comments: { nodes: [{ author: { login: 'oleg' }, body: 'x <!-- lekker:quality -->' }] } }] },
  } } } })
  const pr = fetchPr('o/r', 7, fake)
  assert.equal(pr.prAuthor, 'ann')
  assert.equal(summarize([pr]).agents[0].dismissed, 1)
})

test('cli scores a saved fetch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-noise-'))
  try {
    const f = join(dir, 't.json')
    writeFileSync(f, JSON.stringify([{ prAuthor: 'ann', threads: [thread({ isResolved: true })] }]))
    const out = JSON.parse(execFileSync('node', [script, '--from', f, '--json'], { encoding: 'utf8' }))
    assert.equal(out.agents[0].dismissalRate, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
