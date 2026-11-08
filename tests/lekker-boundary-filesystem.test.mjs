import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { observeComponentLimit } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-filesystem.mjs'

test('observes a bounded filesystem component limit and removes its probe files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boundary-filesystem-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const observed = observeComponentLimit(dir)
  assert.ok(Number.isSafeInteger(observed) && observed > 0 && observed <= 1024)
  assert.equal(observed, observeComponentLimit(dir))
})

test('failed observations leave no directory that poisons retries', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boundary-filesystem-error-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const original = fs.writeFileSync
  try {
    fs.writeFileSync = () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }) }
    syncBuiltinESMExports()
    assert.throws(() => observeComponentLimit(dir), /full/)
  } finally { fs.writeFileSync = original; syncBuiltinESMExports() }
  assert.ok(observeComponentLimit(dir) > 0)
})
