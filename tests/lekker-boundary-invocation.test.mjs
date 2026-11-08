import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runTrustedCli } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-invocation.mjs'

function run(t, id, source, timeoutMs = 5000) {
  const root = mkdtempSync(join(tmpdir(), `boundary-invocation-${id}-`)); t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, result: runTrustedCli({ source: { bytes: Buffer.from(source) }, target: 'target', repoSlug: 'repo',
    outputDir: root, id, timeoutMs }) }
}

test('captures fixed CLI stdout and classifies a known component-limit error', t => {
  const success = run(t, 'success', 'process.stdout.write("ok")')
  assert.equal(success.result.status, 'observed'); assert.equal(success.result.exitClass, 'success')
  assert.equal(readFileSync(join(success.root, success.result.stdoutFile), 'utf8'), 'ok')
  const rejected = run(t, 'rejected', 'console.error("ENAMETOOLONG"); process.exit(1)')
  assert.equal(rejected.result.exitClass, 'component-limit')
})

test('records timeout and signal as unavailable invocations', t => {
  const timeout = run(t, 'timeout', 'setInterval(() => {}, 1000)', 1000)
  assert.equal(timeout.result.status, 'timeout')
  const signal = run(t, 'signal', 'process.kill(process.pid, "SIGTERM")')
  assert.equal(signal.result.status, 'unavailable'); assert.equal(signal.result.signal, 'SIGTERM')
})
