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

test('resolution needs an author dismissal to count as dismissed; outdated wins', () => {
  const outcome = (t) => classifyLekkerThread(t, 'ann').outcome
  for (const isResolved of [false, true]) {
    for (const body of ['This is by design', "won't fix"]) {
      const comments = [lekker('quality'), { author: 'ann', body }]
      assert.equal(outcome(thread({ isResolved, comments })), 'dismissed')
      assert.equal(outcome(thread({ isResolved, isOutdated: true, comments })), 'fixed')
    }
  }
  assert.equal(outcome(thread({ isResolved: true })), 'resolved')
  assert.equal(outcome(thread({ isResolved: true, isOutdated: true })), 'fixed')
  assert.equal(outcome(thread({ isResolved: true, comments: [lekker('quality'), { author: 'ann', body: 'Fixed, thanks' }] })), 'resolved')
  assert.equal(outcome(thread({ isResolved: true, comments: [lekker('quality'), { author: 'bob', body: "won't fix" }] })), 'resolved')
  assert.equal(outcome(thread({})), 'ignored')
  assert.equal(outcome(thread({ comments: [lekker('quality'), { author: 'bob', body: "won't fix" }] })), 'ignored')
})

test('dismissal rate is reported per agent', () => {
  const s = summarize([{ prAuthor: 'ann', threads: [
    thread({ comments: [lekker('quality')], isResolved: true }),
    thread({ comments: [lekker('quality')], isOutdated: true }),
    thread({ comments: [lekker('quality'), { author: 'ann', body: 'false positive' }] }),
    thread({ comments: [lekker('quality')] }),
    thread({ comments: [lekker('implementation')] }),
    thread({ comments: [{ author: 'oleg', body: 'plain human comment' }] }),
  ] }])
  assert.equal(s.comments, 5)
  const q = s.agents.find((a) => a.agent === 'quality')
  assert.deepEqual(q, { agent: 'quality', total: 4, fixed: 1, dismissed: 1, resolved: 1, ignored: 1, dismissalRate: 0.25 })
  assert.equal(s.agents.find((a) => a.agent === 'implementation').dismissalRate, 0)
})

test('fetchPr shapes the graphql response', () => {
  const fake = () => JSON.stringify({ data: { repository: { pullRequest: {
    author: { login: 'ann' },
    reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 't1', isResolved: true, isOutdated: false, path: 'a.ts', line: 3,
      comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ author: { login: 'oleg' }, body: 'x <!-- lekker:quality -->' }] } }] },
  } } } })
  const pr = fetchPr('o/r', 7, fake)
  assert.equal(pr.prAuthor, 'ann')
  assert.deepEqual(pr.threads, [thread({ isResolved: true, comments: [{ author: 'oleg', body: 'x <!-- lekker:quality -->' }] })])
  assert.equal(summarize([pr]).agents[0].resolved, 1)
})

test('fetchPr completes both connections before summarizing marked comments', () => {
  const connection = (nodes, endCursor = null) => ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } })
  const comment = (author, body) => ({ author: author ? { login: author } : null, body })
  const chatter = Array.from({ length: 50 }, () => comment('bob', 'Please take a look.'))
  const rawThread = (id, comments) => ({ id, path: `${id}.ts`, line: 3, isResolved: false, isOutdated: false, comments: connection(comments) })
  const threads = Array.from({ length: 201 }, (_, i) => rawThread(`t${i}`, [comment('bob', 'plain human comment')]))
  threads[0].comments = connection([comment('oleg', 'x <!-- lekker:quality -->'), ...chatter.slice(1)], 't0-c50')
  threads[100].isResolved = true
  threads[100].comments = connection([comment('oleg', 'x <!-- lekker:quality -->')])
  threads[200].comments = connection([comment('oleg', 'x <!-- lekker:implementation -->'), ...chatter.slice(1)], 't200-c50')
  const requests = []
  const fake = (cmd, args) => {
    assert.equal(cmd, 'gh')
    assert.deepEqual(args.slice(0, 2), ['api', 'graphql'])
    const field = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
    const cursor = field('cursor')
    const id = field('id')
    requests.push({ id, cursor })
    assert.match(field('query'), /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/)
    assert.match(field('query'), /after:\s*\$cursor/)
    if (id) {
      const pages = {
        't0-c50': connection(chatter, 't0-c100'),
        't0-c100': connection([comment('ann', 'This is by design')]),
        't200-c50': connection([comment(null, "won't fix"), comment('ann', 'false positive')]),
      }
      assert.ok(cursor.startsWith(`${id}-`))
      assert.ok(pages[cursor], `unexpected comments cursor: ${cursor}`)
      return JSON.stringify({ data: { node: { comments: pages[cursor] } } })
    }
    assert.equal(field('owner'), 'o')
    assert.equal(field('name'), 'r')
    assert.equal(field('pr'), '7')
    const pages = {
      first: connection(threads.slice(0, 100), 'threads100'),
      threads100: connection(threads.slice(100, 200), 'threads200'),
      threads200: connection(threads.slice(200)),
    }
    assert.ok(pages[cursor || 'first'], `unexpected threads cursor: ${cursor}`)
    return JSON.stringify({ data: { repository: { pullRequest: { author: { login: 'ann' }, reviewThreads: pages[cursor || 'first'] } } } })
  }
  const pr = fetchPr('o/r', 7, fake)
  assert.equal(pr.threads.length, 201)
  assert.equal(pr.threads[0].comments.length, 101)
  assert.equal(pr.threads[200].comments.length, 52)
  assert.equal(pr.threads[200].comments[50].author, null)
  assert.equal(requests.length, 6)
  assert.deepEqual(summarize([pr]), { comments: 3, agents: [
    { agent: 'quality', total: 2, fixed: 0, dismissed: 1, resolved: 1, ignored: 0, dismissalRate: 0.5 },
    { agent: 'implementation', total: 1, fixed: 0, dismissed: 1, resolved: 0, ignored: 0, dismissalRate: 1 },
  ] })
})

test('cli scores a saved fetch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-noise-'))
  try {
    const f = join(dir, 't.json')
    writeFileSync(f, JSON.stringify([{ prAuthor: 'ann', threads: [thread({ isResolved: true })] }]))
    const out = JSON.parse(execFileSync('node', [script, '--from', f, '--json'], { encoding: 'utf8' }))
    assert.equal(out.agents[0].dismissalRate, 0)
    assert.equal(out.agents[0].resolved, 1)
    const rendered = execFileSync('node', [script, '--from', f], { encoding: 'utf8' })
    assert.match(rendered, /fixed 0\s+dismissed 0\s+resolved 1\s+ignored 0\s+dismissal rate 0%/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
