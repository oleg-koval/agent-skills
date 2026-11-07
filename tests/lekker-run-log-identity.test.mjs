import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs'

test('same-second starts allocate independent run archives', async () => {
  const state = mkdtempSync(join(tmpdir(), 'lekker-run-identity-'))
  try {
    const shim = join(state, 'freeze-clock.cjs')
    writeFileSync(shim, `const RealDate = Date; globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-11-07T12:00:00.000Z'])) }
      static now() { return RealDate.parse('2026-11-07T12:00:00.000Z') }
    }`)
    const env = { ...process.env, LEKKER_STATE_DIR: state, NODE_OPTIONS: `--require=${shim}` }
    const args = extra => [cli, 'start', '--repo', 'org/repo', '--target', 'pr-7', ...extra]
    const start = extra => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args(extra), { env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', reject)
      child.on('close', status => status === 0
        ? resolve(JSON.parse(stdout))
        : reject(new Error(`start failed (${status}): ${stderr}`)))
    })
    const [first, second] = await Promise.all([
      start(['--mode', 'pr', '--depth', 'deep', '--engine', 'workflow']),
      start(['--mode', 'branch', '--depth', 'shallow', '--engine', 'revmux', '--fix']),
    ])
    assert.notEqual(first.runId, second.runId)
    assert.equal(first.runId.startsWith('20261107T120000-repo-pr-7-'), true)
    assert.equal(second.runId.startsWith('20261107T120000-repo-pr-7-'), true)
    const runDir = id => join(state, 'runs', id)
    const readRun = id => JSON.parse(readFileSync(join(runDir(id), 'run.json'), 'utf8'))
    assert.deepEqual([readRun(first.runId).depth, readRun(first.runId).engine], ['deep', 'workflow'])
    assert.deepEqual([readRun(second.runId).depth, readRun(second.runId).engine], ['shallow', 'revmux'])

    const attachment = join(state, 'findings.json')
    writeFileSync(attachment, '{"findings":[]}\n')
    const run = extra => JSON.parse(spawnSync(process.execPath, [cli, ...extra], {
      encoding: 'utf8', env,
    }).stdout)
    run(['attach', first.runId, attachment])
    run(['mark', second.runId, 'review'])
    assert.equal(readFileSync(join(runDir(first.runId), 'findings.json'), 'utf8'), '{"findings":[]}\n')
    assert.equal(existsSync(join(runDir(second.runId), 'findings.json')), false)
    assert.equal(readFileSync(join(runDir(second.runId), 'timeline.jsonl'), 'utf8').includes('review'), true)
    assert.equal(readFileSync(join(runDir(first.runId), 'timeline.jsonl'), 'utf8').includes('review'), false)

    for (const id of [first.runId, second.runId]) run(['finish', id, '--status', 'ok', '--verdict', 'lgtm'])
    const report = run(['report', '--days', '0', '--json'])
    assert.equal(report.runs, 2)
    assert.deepEqual(new Set(report.table.map(row => row.group)), new Set(['workflow/deep', 'revmux/shallow']))
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})
