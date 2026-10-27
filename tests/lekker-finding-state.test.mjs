import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  begin, classifyThread, mergeFindings, recurringClasses, suppressedFindings,
} from '../plugins/olko-github-pr/skills/lekker-review/scripts/finding-state.mjs'

const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/finding-state.mjs'
const thread = (over) => ({ path: 'a.ts', line: 5, body: 'Missing null check', isResolved: false, isOutdated: false, replies: [], ...over })

function stateFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env, LEKKER_STATE_DIR: dir }
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--repo', 'o/r', '--target', 'pr-7'], { env, encoding: 'utf8' })
  const stateFile = () => join(dir, 'findings', readdirSync(join(dir, 'findings'))[0])
  return { dir, env, run, stateFile }
}

test('thread outcomes map to statuses', () => {
  assert.equal(classifyThread(thread({}), 'ann'), 'open')
  assert.equal(classifyThread(thread({ isOutdated: true }), 'ann'), 'fixed')
  assert.equal(classifyThread(thread({ isResolved: true }), 'ann'), 'rejected')
  assert.equal(classifyThread(thread({ replies: [{ author: 'ann', body: 'This is intentional, see ADR' }] }), 'ann'), 'intentional')
  assert.equal(classifyThread(thread({ replies: [{ author: 'ann', body: "won't fix" }] }), 'ann'), 'rejected')
  assert.equal(classifyThread(thread({ replies: [{ author: 'bob', body: "won't fix" }] }), 'ann'), 'open')
})

test('unknown PR authors can only yield fixed or open threads', () => {
  for (const prAuthor of [null, undefined, '']) {
    assert.equal(classifyThread(thread({ isResolved: true }), prAuthor), 'open')
    assert.equal(classifyThread(thread({ isResolved: true, replies: [{ author: 'ann', body: 'by design; won\'t fix' }] }), prAuthor), 'open')
    assert.equal(classifyThread(thread({ isResolved: true, isOutdated: true }), prAuthor), 'fixed')
  }
  const findings = mergeFindings([], [{ file: 'a.ts', line: 5, title: 'Missing null check' }], 1)
  const out = begin({ cycle: 1, findings }, [thread({ isResolved: true })], null)
  assert.equal(out.state.findings[0].status, 'open')
  assert.deepEqual(out.summary.suppressed, [])
})

test('status and cycles are reused only for the same location and title', () => {
  const original = { file: 'a.ts', line: 5, title: 'Missing null check' }
  const prior = mergeFindings([], [original], 1).map((f) => ({ ...f, status: 'rejected' }))
  const separate = [
    { ...original, file: 'b.ts' },
    { ...original, line: 6 },
    { ...original, line: 100 },
    { ...original, title: 'Missing null check for response' },
    { ...original, title: 'Missing null check for request' },
    { ...original, title: 'Missing missing missing validation' },
  ]
  const distinct = mergeFindings(prior, separate, 2)
  assert.equal(distinct.length, separate.length + 1)
  assert.deepEqual(distinct[0].cycles, [1])
  assert.ok(distinct.slice(1).every((f) => f.status === 'open'))
  const repeated = mergeFindings(prior, [{ ...original, title: '  Missing  null check  ' }], 2)
  assert.equal(repeated.length, 1)
  assert.equal(repeated[0].status, 'rejected')
  assert.deepEqual(repeated[0].cycles, [1, 2])
})

test('begin matches comment titles without including the explanation or code', () => {
  const title = 'Missing null check'
  const findings = mergeFindings([], [{ file: 'a.ts', line: 5, title }], 1)
  const explanation = '\n\nThe response can be absent when the remote server times out.\n```ts\nreturn response.value\n```'
  for (const comment of [
    { title, body: 'A completely different body with lots of unrelated words' },
    { body: `${title}${explanation}` },
    { body: `\n\n### ${title}${explanation}` },
    { body: `**${title}**${explanation}` },
  ]) {
    const out = begin({ cycle: 1, findings }, [thread({ ...comment, replies: [{ author: 'ann', body: 'by design' }] })], 'ann')
    assert.equal(out.state.findings[0].status, 'intentional')
    assert.equal(out.summary.suppressed.length, 1)
  }
  const unrelated = begin({ cycle: 1, findings }, [thread({ title: 'Missing response validation', body: title, isResolved: true })], 'ann')
  assert.deepEqual(unrelated.summary.suppressed, [])
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

test('state filenames distinguish full repository and target values', (t) => {
  const { dir, run } = stateFixture(t)
  const identities = [
    ['o/r', 'pr-7'], ['o-r', 'pr-7'], ['O/R', 'pr-7'],
    ['o/r', 'pr/7'], ['o/r', 'PR-7'], ['o/r-pr', '7'],
    ['組織/庫', 'pr-7'], ['組織/別', 'pr-7'],
  ]
  for (const [repo, target] of identities) {
    const result = run('begin', '--repo', repo, '--target', target)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).cycle, 1)
  }
  assert.equal(readdirSync(join(dir, 'findings')).length, identities.length)
  assert.equal(JSON.parse(run('begin').stdout).cycle, 2)
})

test('invalid state fails without writes from begin or record', (t) => {
  const { dir, run, stateFile } = stateFixture(t)
  assert.deepEqual(JSON.parse(run('show').stdout), { cycle: 0, findings: [] })
  assert.equal(run('begin').status, 0)
  const file = stateFile()
  const found = join(dir, 'input.json')
  writeFileSync(found, '[]')
  const invalid = [
    '{', 'null', '[]', '42', '"state"', '{}',
    '{"cycle":1}', '{"findings":[]}', '{"cycle":"1","findings":[]}',
    '{"cycle":-1,"findings":[]}', '{"cycle":1.5,"findings":[]}',
    '{"cycle":1,"findings":null}', '{"cycle":1,"findings":{}}',
  ]
  for (const raw of invalid) {
    writeFileSync(file, raw)
    for (const command of ['show', 'begin', 'record']) {
      const result = run(command, '--findings', found)
      assert.notEqual(result.status, 0, `${command} accepted ${raw}`)
      assert.equal(result.stdout, '')
      assert.equal(readFileSync(file, 'utf8'), raw)
      assert.deepEqual(readdirSync(join(dir, 'findings')), [file.split('/').at(-1)])
    }
  }
})

test('state writes publish complete JSON atomically and preserve state on failure', (t) => {
  const { dir, env, run, stateFile } = stateFixture(t)
  assert.equal(run('begin').status, 0)
  const destination = stateFile()
  const preload = join(dir, 'intercept-fs.mjs')
  // Observe the destination during a partial temporary write, and inject both
  // write and rename failures to prove that the old state remains readable.
  writeFileSync(preload, `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { dirname } from 'node:path';
    const destination = process.env.TEST_STATE_FILE;
    const before = fs.readFileSync(destination, 'utf8');
    const write = fs.writeFileSync;
    const rename = fs.renameSync;
    fs.writeFileSync = (path, data, options) => {
      assert.notEqual(path, destination);
      assert.equal(dirname(path), dirname(destination));
      write(path, data.slice(0, 5), options);
      assert.equal(fs.readFileSync(destination, 'utf8'), before);
      if (process.env.TEST_FAILURE === 'write') throw new Error('injected write failure');
      write(path, data, { ...options, flag: 'w' });
    };
    fs.renameSync = (source, target) => {
      assert.equal(target, destination);
      assert.equal(JSON.parse(fs.readFileSync(source, 'utf8')).cycle, 2);
      assert.equal(fs.readFileSync(destination, 'utf8'), before);
      if (process.env.TEST_FAILURE === 'rename') throw new Error('injected rename failure');
      rename(source, target);
    };
    syncBuiltinESMExports();
  `)
  const before = readFileSync(destination, 'utf8')
  for (const failure of ['write', 'rename', '']) {
    const result = spawnSync(process.execPath, ['--import', preload, script, 'begin', '--repo', 'o/r', '--target', 'pr-7'], {
      env: { ...env, TEST_STATE_FILE: destination, TEST_FAILURE: failure }, encoding: 'utf8',
    })
    if (failure) {
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, new RegExp(`injected ${failure} failure`))
      assert.equal(readFileSync(destination, 'utf8'), before)
    } else {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(JSON.parse(readFileSync(destination, 'utf8')).cycle, 2)
    }
    assert.equal(readdirSync(join(dir, 'findings')).length, 1)
  }
})
