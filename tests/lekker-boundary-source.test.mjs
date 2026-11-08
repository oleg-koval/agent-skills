import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readTrustedSource, RUN_LOG_SOURCE } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-source.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

test('exports trusted CLI bytes from an exact commit rather than the mutable worktree', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boundary-source-')), repo = join(dir, 'repo')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'config', 'core.hooksPath', '/dev/null')
  git(repo, 'config', 'user.name', 'Boundary Test'); git(repo, 'config', 'user.email', 'boundary@example.invalid')
  mkdirSync(join(repo, 'plugins/olko-github-pr/skills/lekker-review/scripts'), { recursive: true })
  writeFileSync(join(repo, RUN_LOG_SOURCE), 'committed CLI bytes\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'trusted source')
  const commit = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, RUN_LOG_SOURCE), 'mutable worktree bytes\n')
  const source = readTrustedSource(repo, commit)
  assert.equal(source.commit, commit)
  assert.equal(source.bytes.toString(), 'committed CLI bytes\n')
  assert.match(source.sha256, /^[a-f0-9]{64}$/)
  assert.throws(() => readTrustedSource(repo, 'f'.repeat(40)), /trusted commit|git/)
})
