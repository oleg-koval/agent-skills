import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectGitEvidence } from '../plugins/olko-github-pr/skills/lekker-review/scripts/git-evidence.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'git-evidence-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q'); git(dir, 'config', 'core.hooksPath', '/dev/null'); git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(dir, 'README.md'), 'base\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base')
  const mergeBase = git(dir, 'rev-parse', 'HEAD')
  return { dir, mergeBase }
}
const commit = dir => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'head'); return git(dir, 'rev-parse', 'HEAD') }

test('binds exact commits, raw diff bytes, NUL paths, and reused risk policy', t => {
  const { dir, mergeBase } = repo(t)
  const submodule = repo(t)
  git(dir, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', submodule.dir, 'vendor/sub')
  const path = 'src/auth/ spaced\nname.ts'
  const unicodePath = 'src/café.ts'
  const bomPath = '\uFEFFreadme.ts'
  mkdirSync(join(dir, 'src/auth'), { recursive: true })
  writeFileSync(join(dir, path), 'new content\n\n')
  writeFileSync(join(dir, unicodePath), 'unicode path\n')
  writeFileSync(join(dir, bomPath), 'bom path\n')
  writeFileSync(join(dir, 'README.md'), 'head docs\n')
  const headSha = commit(dir)
  const evidence = collectGitEvidence({ worktreePath: dir, mergeBase, headSha })
  assert.equal(evidence.status, 'available')
  assert.deepEqual(evidence.provenance, { baseSha: mergeBase, headSha, trackedCleanBefore: true, trackedCleanAfter: true })
  assert.deepEqual(evidence.changedPaths, ['.gitmodules', 'README.md', path, unicodePath, 'vendor/sub', bomPath])
  assert.ok(evidence.diff.text.includes('new content'))
  assert.deepEqual(evidence.risk.categories.map(c => c.category), ['auth'])
  const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '--full-index', '--unified=3', '--inter-hunk-context=0', '--diff-algorithm=myers', '--indent-heuristic', '--no-relative', '--ignore-submodules=none', '--submodule=short', '-O/dev/null']
  const raw = execFileSync('git', ['-c', 'core.quotePath=true', '-c', 'diff.suppressBlankEmpty=false', '-C', dir, 'diff', ...flags, mergeBase, headSha, '--'])
  assert.equal(evidence.diff.sha256, createHash('sha256').update(raw).digest('hex'))
  const orderDir = mkdtempSync(join(tmpdir(), 'git-order-'))
  t.after(() => rmSync(orderDir, { recursive: true, force: true }))
  const orderFile = join(orderDir, 'order')
  writeFileSync(orderFile, 'vendor/sub\n')
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.context', '0'], ['diff.algorithm', 'histogram'], ['diff.indentHeuristic', 'false'], ['diff.ignoreSubmodules', 'all'], ['core.quotePath', 'false'], ['diff.orderFile', orderFile], ['diff.suppressBlankEmpty', 'true']]) git(dir, 'config', key, value)
  const configured = collectGitEvidence({ worktreePath: dir, mergeBase, headSha })
  assert.deepEqual([configured.diff.sha256, configured.diff.text, configured.changedPaths], [evidence.diff.sha256, evidence.diff.text, evidence.changedPaths])
})

test('fails closed for invalid base, mismatched head, and dirty tracked files', t => {
  const { dir, mergeBase } = repo(t)
  writeFileSync(join(dir, 'head.txt'), 'head\n')
  const headSha = commit(dir)
  assert.equal(collectGitEvidence({ worktreePath: dir, mergeBase: 'f'.repeat(40), headSha }).status, 'unavailable')
  assert.equal(collectGitEvidence({ worktreePath: dir, mergeBase, headSha: mergeBase }).status, 'unavailable')
  writeFileSync(join(dir, 'README.md'), 'dirty\n')
  const dirty = collectGitEvidence({ worktreePath: dir, mergeBase, headSha })
  assert.equal(dirty.status, 'unavailable')
  assert.match(dirty.reason, /dirty/)
})
