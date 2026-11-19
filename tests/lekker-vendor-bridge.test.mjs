import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseArgs, promptFor, resultFrom, validate } from '../plugins/olko-github-pr/skills/lekker-review/scripts/vendor-bridge.mjs'

const bridge = 'plugins/olko-github-pr/skills/lekker-review/scripts/vendor-bridge.mjs'
const schema = { type: 'object', required: ['verdict'], properties: { verdict: { enum: ['confirmed', 'dropped'] } } }

// A fake vendor CLI. STUB_MODE picks the behaviour; argv and stdin are recorded for the assertions.
const STUB = `#!${process.execPath}
const fs = require('node:fs')
const name = require('node:path').basename(process.argv[1])
const dir = process.env.STUB_DIR
const args = process.argv.slice(2)
fs.writeFileSync(dir + '/' + name + '.argv.json', JSON.stringify(args))
fs.writeFileSync(dir + '/' + name + '.stdin', fs.readFileSync(0, 'utf8'))
const mode = process.env.STUB_MODE
const answer = '{"verdict":"confirmed"}'
if (mode === 'exit7') { console.error('auth failed: no session'); process.exit(7) }
if (mode === 'sleep') setTimeout(() => {}, 20000)
else if (mode === 'badjson') emit('not json at all')
else if (mode === 'mismatch') emit('{"verdict":"maybe"}')
else emit(answer)
function emit(body) {
  if (name === 'codex') fs.writeFileSync(args[args.indexOf('-o') + 1], body)
  else console.log(JSON.stringify({ is_error: false, result: body, structured_output: mode === 'badjson' ? undefined : JSON.parse(body.startsWith('{') ? body : 'null') }))
}
`

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'vendor-bridge-'))
  const stubs = join(root, 'bin')
  const work = join(root, 'work')
  mkdirSync(stubs)
  mkdirSync(work)
  for (const [name, body] of [['codex', STUB], ['claude', STUB]]) {
    writeFileSync(join(stubs, name), body)
    chmodSync(join(stubs, name), 0o755)
  }
  writeFileSync(join(work, 'schema.json'), JSON.stringify(schema))
  writeFileSync(join(work, 'prompt.md'), 'Judge the finding.')
  const run = ({ to = 'codex', mode = 'ok', extra = [], env = {}, pathDirs = [stubs] } = {}) => {
    const result = spawnSync(process.execPath, [bridge, '--to', to, '--model', 'm1', '--effort', 'high',
      '--schema', join(work, 'schema.json'), '--prompt', join(work, 'prompt.md'), '--cwd', work,
      '--out', join(work, 'out.json'), ...extra], {
      encoding: 'utf8', env: { PATH: pathDirs.join(':'), STUB_DIR: root, STUB_MODE: mode, ...env },
    })
    const out = existsSync(join(work, 'out.json')) ? JSON.parse(readFileSync(join(work, 'out.json'), 'utf8')) : undefined
    return { status: result.status, stderr: result.stderr, out }
  }
  const recorded = (name, ext) => readFileSync(join(root, `${name}.${ext}`), 'utf8')
  return { root, work, run, recorded, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('codex success writes validated JSON and passes the documented flags', () => {
  const sb = sandbox()
  try {
    const { status, out } = sb.run({ to: 'codex' })
    assert.equal(status, 0)
    assert.deepEqual(out, { verdict: 'confirmed' })
    const args = JSON.parse(sb.recorded('codex', 'argv.json'))
    assert.deepEqual(args.slice(0, 7), ['exec', '-m', 'm1', '-c', 'model_reasoning_effort=high', '-s', 'read-only'])
    assert.equal(args[args.indexOf('-C') + 1], sb.work)
    assert.equal(args.at(-1), '-')
    assert.ok(sb.recorded('codex', 'stdin').startsWith('Judge the finding.'))
  } finally { sb.cleanup() }
})

test('claude success reads structured_output and runs in plan mode with read-only tools', () => {
  const sb = sandbox()
  try {
    const { status, out } = sb.run({ to: 'claude' })
    assert.equal(status, 0)
    assert.deepEqual(out, { verdict: 'confirmed' })
    const args = JSON.parse(sb.recorded('claude', 'argv.json'))
    assert.equal(args[args.indexOf('--json-schema') + 1], JSON.stringify(schema))
    assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(git log:*),Bash(git status:*)')
    assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write,NotebookEdit')
    assert.equal(args[args.indexOf('--effort') + 1], 'high')
    assert.equal(sb.recorded('claude', 'stdin'), 'Judge the finding.')
  } finally { sb.cleanup() }
})

test('a missing CLI exits 3 with a fallback reason', () => {
  const sb = sandbox()
  try {
    const { status, out } = sb.run({ pathDirs: [] })
    assert.equal(status, 3)
    assert.match(out.fallback, /codex not found on PATH/)
  } finally { sb.cleanup() }
})

test('a non-zero exit exits 3 and keeps the first stderr line', () => {
  const sb = sandbox()
  try {
    const { status, out } = sb.run({ mode: 'exit7' })
    assert.equal(status, 3)
    assert.match(out.fallback, /codex exited 7: auth failed: no session/)
  } finally { sb.cleanup() }
})

test('invalid JSON and a schema mismatch both fall back', () => {
  const sb = sandbox()
  try {
    for (const to of ['codex', 'claude']) {
      const bad = sb.run({ to, mode: 'badjson' })
      assert.equal(bad.status, 3, to)
      assert.match(bad.out.fallback, /not valid JSON/, to)
      const mismatch = sb.run({ to, mode: 'mismatch' })
      assert.equal(mismatch.status, 3, to)
      assert.match(mismatch.out.fallback, /schema mismatch: \$\.verdict is not one of/, to)
    }
  } finally { sb.cleanup() }
})

test('a hung CLI is killed at --timeout and falls back', () => {
  const sb = sandbox()
  try {
    const started = Date.now()
    const { status, out } = sb.run({ mode: 'sleep', extra: ['--timeout', '0.5'] })
    assert.equal(status, 3)
    assert.match(out.fallback, /timed out after 0\.5s/)
    assert.ok(Date.now() - started < 8000)
  } finally { sb.cleanup() }
})

test('shell metacharacters in the prompt reach the CLI verbatim and are never executed', () => {
  const sb = sandbox()
  try {
    const hostile = 'x $(touch PWNED_SUBST) `touch PWNED_TICK` ; touch PWNED_SEMI \'"\' $HOME rm -rf /'
    writeFileSync(join(sb.work, 'prompt.md'), hostile)
    for (const to of ['codex', 'claude']) {
      assert.equal(sb.run({ to }).status, 0, to)
      assert.ok(sb.recorded(to, 'stdin').startsWith(hostile), to)
    }
    for (const marker of ['PWNED_SUBST', 'PWNED_TICK', 'PWNED_SEMI']) {
      assert.equal(existsSync(join(sb.work, marker)), false, marker)
    }
  } finally { sb.cleanup() }
})

test('a missing argument exits 2 without touching --out', () => {
  const sb = sandbox()
  try {
    const result = spawnSync(process.execPath, [bridge, '--to', 'codex'], { encoding: 'utf8' })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /missing --model/)
  } finally { sb.cleanup() }
})

test('parseArgs validates target and timeout and defaults to 600s', () => {
  const base = ['--to', 'claude', '--model', 'm', '--effort', 'low', '--schema', 's', '--prompt', 'p', '--cwd', 'c', '--out', 'o']
  assert.equal(parseArgs(base).options.timeout, 600)
  assert.match(parseArgs([...base, '--timeout', '0']).error, /--timeout/)
  assert.match(parseArgs(base.map(t => (t === 'claude' ? 'gemini' : t))).error, /--to/)
})

test('validate covers type, required, enum, items and nested properties', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'array', items: { type: 'integer' } }, b: { enum: ['x'] } } }
  assert.deepEqual(validate(s, { a: [1, 2], b: 'x' }), [])
  assert.deepEqual(validate(s, {}), ['$.a is required'])
  assert.deepEqual(validate(s, { a: [1, 'z'] }), ['$.a[1] is not integer'])
  assert.deepEqual(validate(s, { a: [], b: 'y' }), ['$.b is not one of x'])
  assert.deepEqual(validate(s, []), ['$ is not object'])
})

test('resultFrom unwraps a claude envelope, a fenced codex reply and an error envelope', () => {
  assert.deepEqual(resultFrom('claude', { stdout: JSON.stringify({ structured_output: { a: 1 } }) }), { value: { a: 1 } })
  assert.deepEqual(resultFrom('claude', { stdout: JSON.stringify({ result: '{"a":2}' }) }), { value: { a: 2 } })
  assert.match(resultFrom('claude', { stdout: JSON.stringify({ is_error: true, result: 'quota' }) }).error, /quota/)
  assert.deepEqual(resultFrom('codex', { rawOutText: '```json\n{"a":3}\n```' }), { value: { a: 3 } })
})

test('codex gets the schema in the prompt, claude gets the prompt unchanged', () => {
  assert.equal(promptFor('claude', 'P', '{}'), 'P')
  assert.match(promptFor('codex', 'P', '{"type":"object"}'), /^P\n\n.*JSON Schema:\n\{"type":"object"\}/s)
})
