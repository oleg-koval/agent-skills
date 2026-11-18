import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readSkillVersion } from '../plugins/olko-github-pr/skills/lekker-review/scripts/skill-version.mjs'

const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs'
const pluginJson = 'plugins/olko-github-pr/.claude-plugin/plugin.json'

test('readSkillVersion returns the version string or null', () => {
  assert.equal(readSkillVersion(() => '{"version":"1.2.3"}'), '1.2.3')
  assert.equal(readSkillVersion(() => { throw new Error('ENOENT') }), null)
  assert.equal(readSkillVersion(() => '{not json'), null)
  assert.equal(readSkillVersion(() => '{"version":12}'), null)
  assert.equal(readSkillVersion(() => '{"version":""}'), null)
  assert.equal(readSkillVersion(() => '{}'), null)
})

test('start and finish record the plugin version in run.json and runs.jsonl', () => {
  const state = mkdtempSync(join(tmpdir(), 'lekker-skill-version-'))
  try {
    const env = { ...process.env, LEKKER_STATE_DIR: state }
    const run = args => JSON.parse(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env }).stdout)
    const { runId } = run(['start', '--repo', 'org/repo', '--target', 'pr-1'])
    const expected = JSON.parse(readFileSync(pluginJson, 'utf8')).version
    const readRun = () => JSON.parse(readFileSync(join(state, 'runs', runId, 'run.json'), 'utf8'))
    assert.equal(typeof expected, 'string')
    assert.equal(readRun().skillVersion, expected)
    run(['finish', runId, '--status', 'ok'])
    const rows = readFileSync(join(state, 'runs.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(rows.at(-1).runId, runId)
    assert.equal(rows.at(-1).skillVersion, expected)
    assert.equal(readRun().skillVersion, expected)
    assert.equal(rows.at(-1).schema, 1)
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})
