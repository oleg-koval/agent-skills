import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectGitEvidence } from '../plugins/olko-github-pr/skills/lekker-review/scripts/git-evidence.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const collectorUrl = new URL('../plugins/olko-github-pr/skills/lekker-review/scripts/git-evidence.mjs', import.meta.url).href
const collectWithGitEnvironment = (metadata, extraEnv) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', "import(process.argv[1]).then(({collectGitEvidence})=>console.log(JSON.stringify(collectGitEvidence(JSON.parse(process.argv[2])))) )", collectorUrl, JSON.stringify(metadata)], { encoding: 'utf8', env: { ...process.env, ...extraEnv } }))
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
  assert.deepEqual(evidence.risk.categories.map(c => c.category), ['auth'])
  const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '--full-index', '--unified=3', '--inter-hunk-context=0', '--diff-algorithm=myers', '--indent-heuristic', '--no-relative', '--ignore-submodules=none', '--submodule=short', '-O/dev/null']
  const raw = execFileSync('git', ['--no-replace-objects', '-c', 'core.quotePath=true', '-c', 'diff.suppressBlankEmpty=false', '-C', dir, 'diff', ...flags, mergeBase, headSha, '--'])
  assert.equal(evidence.diff.sha256, createHash('sha256').update(raw).digest('hex'))
  assert.equal(evidence.diff.text, raw.toString('utf8'))
  const orderFile = join(dir, '.git', 'test-diff-order')
  writeFileSync(orderFile, 'vendor/sub\n')
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.context', '0'], ['diff.algorithm', 'histogram'], ['diff.indentHeuristic', 'false'], ['diff.ignoreSubmodules', 'all'], ['core.quotePath', 'false'], ['diff.orderFile', orderFile], ['diff.suppressBlankEmpty', 'true']]) git(dir, 'config', key, value)
  const configured = collectGitEvidence({ worktreePath: dir, mergeBase, headSha })
  assert.deepEqual([configured.diff.sha256, configured.diff.text, configured.changedPaths], [evidence.diff.sha256, evidence.diff.text, evidence.changedPaths])
})

test('ignores inherited repository redirects and replacement refs', t => {
  const { dir, mergeBase } = repo(t)
  writeFileSync(join(dir, 'head.txt'), 'head\n')
  const headSha = commit(dir)
  const cloneRoot = mkdtempSync(join(tmpdir(), 'git-evidence-clone-'))
  t.after(() => rmSync(cloneRoot, { recursive: true, force: true }))
  const clone = join(cloneRoot, 'repo')
  execFileSync('git', ['clone', '-q', dir, clone])
  writeFileSync(join(dir, 'README.md'), 'hidden dirty\n')
  const redirected = collectWithGitEnvironment({ worktreePath: dir, mergeBase, headSha }, { GIT_DIR: join(clone, '.git'), GIT_WORK_TREE: clone })
  assert.equal(redirected.status, 'unavailable')
  assert.match(redirected.reason, /dirty/)

  const replacedRepo = repo(t)
  writeFileSync(join(replacedRepo.dir, 'head.txt'), 'head\n')
  const replacedHead = commit(replacedRepo.dir)
  git(replacedRepo.dir, 'replace', replacedRepo.mergeBase, replacedHead)
  assert.deepEqual(collectGitEvidence({ worktreePath: replacedRepo.dir, mergeBase: replacedRepo.mergeBase, headSha: replacedHead }).changedPaths, ['head.txt'])
})

test('fails closed when tracked files use assume-unchanged or skip-worktree', t => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const { dir, mergeBase } = repo(t)
    git(dir, 'update-index', flag, 'README.md')
    writeFileSync(join(dir, 'README.md'), 'hidden dirty\n')
    const evidence = collectGitEvidence({ worktreePath: dir, mergeBase, headSha: mergeBase })
    assert.equal(evidence.status, 'unavailable', flag)
    assert.match(evidence.reason, /assume-unchanged or skip-worktree/)
  }
})

test('fails closed on invalid UTF-8 paths and patch content', async t => {
  for (const kind of ['path', 'content']) await t.test(kind, t => {
    const { dir, mergeBase } = repo(t)
    const path = kind === 'path' ? Buffer.concat([Buffer.from(`${dir}/`), Buffer.from([0xff])]) : join(dir, 'invalid.bin')
    try { writeFileSync(path, Buffer.from(kind === 'path' ? 'valid\n' : [0xff])) } catch (error) {
      if (kind === 'path' && error.code === 'EILSEQ') return t.skip('filesystem cannot create invalid-byte filenames')
      throw error
    }
    assert.match(collectGitEvidence({ worktreePath: dir, mergeBase, headSha: commit(dir) }).reason, /UTF-8/)
  })
})

test('fails closed on HEAD or tracked drift during collection', async t => {
  for (const kind of ['HEAD', 'tracked']) await t.test(kind, t => {
    const { dir, mergeBase } = repo(t), shim = mkdtempSync(join(tmpdir(), 'git-shim-'))
    t.after(() => rmSync(shim, { recursive: true, force: true }))
    writeFileSync(join(dir, 'src.js'), 'head\n'); const headSha = commit(dir)
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const mutation = kind === 'HEAD' ? `"${realGit}" -C "${dir}" update-ref HEAD ${mergeBase}` : `printf drift > "${join(dir, 'README.md')}"`
    writeFileSync(join(shim, 'git'), `#!/bin/sh\n"${realGit}" "$@"\nresult=$?\nfor arg do if [ "$arg" = diff ]; then ${mutation}; break; fi; done\nexit "$result"\n`, { mode: 0o755 })
    const evidence = collectWithGitEnvironment({ worktreePath: dir, mergeBase, headSha }, { PATH: `${shim}:${process.env.PATH}` })
    assert.equal(evidence.status, 'unavailable'); assert.match(evidence.reason, kind === 'HEAD' ? /HEAD changed/ : /dirty/)
  })
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
