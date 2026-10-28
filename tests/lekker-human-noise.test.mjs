import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  agentOf, classifyLekkerThread, fetchPr, fetchPrs, summarize,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/human-noise.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/human-noise.mjs'
const lekker = (agent, text = 'Add a null check.') => ({ author: 'oleg', body: `${text}\n<!-- lekker:${agent} -->` })
const thread = (over) => ({ path: 'a.ts', line: 3, isResolved: false, isOutdated: false, comments: [lekker('quality')], ...over })

test('only comments carrying the lekker marker are identified', () => {
  assert.equal(agentOf('Add a check.\n<!-- lekker:test-quality -->'), 'test-quality')
  assert.equal(agentOf('a human comment'), null)
  assert.equal(classifyLekkerThread(thread({ comments: [{ author: 'oleg', body: 'human' }] }), 'ann'), null)
})

test('outcomes: fixed, dismissed by reply, resolved without evidence, ignored', () => {
  const outcome = (t) => classifyLekkerThread(t, 'ann').outcome
  assert.equal(outcome(thread({ isOutdated: true })), 'fixed')
  assert.equal(outcome(thread({ comments: [lekker('quality'), { author: 'ann', body: 'This is by design' }] })), 'dismissed')
  assert.equal(outcome(thread({ isResolved: true })), 'resolved')
  assert.equal(outcome(thread({ isResolved: true, comments: [lekker('quality'), { author: 'ann', body: 'This is by design' }] })), 'dismissed')
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
  assert.deepEqual([q.total, q.fixed, q.dismissed, q.resolved, q.dismissalRate], [2, 1, 0, 1, 0])
  assert.equal(s.agents.find((a) => a.agent === 'implementation').dismissalRate, 0)
})

test('fetchPr paginates all threads and all comments in each thread', () => {
  const calls = []
  const fake = (command, args, options) => {
    calls.push({ args, options })
    const query = args.find((arg) => arg.startsWith('query='))
    const threadCursor = args.find((arg) => arg.startsWith('threadCursor='))
    const commentCursor = args.find((arg) => arg.startsWith('commentCursor='))
    if (query.includes('$threadCursor')) {
      if (threadCursor) return JSON.stringify({ data: { repository: { pullRequest: {
        author: { login: 'ann' }, reviewThreads: { nodes: [{ id: 'later', isResolved: false, isOutdated: false, path: 'b.ts', line: 4,
          comments: { nodes: [{ author: { login: 'ann' }, body: 'won\'t fix' }], pageInfo: { hasNextPage: false, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } },
      } } } })
      return JSON.stringify({ data: { repository: { pullRequest: {
        author: { login: 'ann' }, reviewThreads: { nodes: [{ id: 'first', isResolved: false, isOutdated: false, path: 'a.ts', line: 3,
          comments: { nodes: [{ author: { login: 'oleg' }, body: 'x <!-- lekker:quality -->' }], pageInfo: { hasNextPage: true, endCursor: 'comment-page-2' } } }], pageInfo: { hasNextPage: true, endCursor: 'thread-page-2' } },
      } } } })
    }
    assert.equal(commentCursor, 'commentCursor=comment-page-2')
    return JSON.stringify({ data: { node: { comments: { nodes: [{ author: { login: 'ann' }, body: 'by design' }], pageInfo: { hasNextPage: false, endCursor: null } } } } })
  }
  const pr = fetchPr('o/r', 7, fake)
  assert.equal(pr.prAuthor, 'ann')
  assert.equal(pr.threads.length, 2)
  assert.equal(summarize([pr]).agents[0].dismissed, 1)
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.options.timeout === 30_000))
})

test('fetchPr reports a clear timeout error', () => {
  const fake = () => { const error = new Error('timed out'); error.code = 'ETIMEDOUT'; throw error }
  assert.throws(() => fetchPr('o/r', 7, fake), /timed out after 30s for o\/r#7/)
})

test('fetchPrs deduplicates PR numbers before fetching', () => {
  const fetched = []
  fetchPrs('o/r', ['7', '8', '7'], (repo, pr) => { fetched.push(`${repo}#${pr}`); return { pr } })
  assert.deepEqual(fetched, ['o/r#7', 'o/r#8'])
})

test('cli scores a saved fetch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-noise-'))
  try {
    const f = join(dir, 't.json')
    writeFileSync(f, JSON.stringify([{ prAuthor: 'ann', threads: [thread({ isResolved: true })] }]))
    const out = JSON.parse(execFileSync('node', [script, '--from', f, '--json'], { encoding: 'utf8' }))
    assert.equal(out.agents[0].dismissalRate, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
