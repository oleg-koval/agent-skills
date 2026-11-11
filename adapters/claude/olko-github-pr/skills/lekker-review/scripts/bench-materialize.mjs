#!/usr/bin/env node
// Materialize one benchmark case into a throwaway review input.
//
// Usage: node bench-materialize.mjs --corpus <corpus.json> --case <id> --out <dir>
//
// Writes into <dir>: repo/ (a clone with no remote, detached at baseRef, patch applied),
// pr.diff (the patch bytes), context.json and worktree.json. Prints { out, ... } as JSON.

import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCorpus } from './bench-corpus.mjs'

export function parseChangedPaths(diffText) {
  const lines = String(diffText).split('\n')
  const paths = lines.flatMap((line, i) => {
    if (line.startsWith('+++ b/')) return [line.slice(6)]
    if (line.startsWith('--- a/') && lines[i + 1] === '+++ /dev/null') return [line.slice(6)]
    return line.startsWith('rename to ') ? [line.slice(10)] : []
  })
  return [...new Set(paths)]
}

// Optional keys are null so the workflow reads "absent" instead of a made-up value.
export function buildContext(changedPaths, reviewTarget) {
  return {
    acList: '', projectRules: null, baseProjectRules: null, changedPaths,
    sentrySignals: null, ciStatus: null, existingReviews: null, deltaFile: null,
    reviewTarget, prePush: false, preflightFile: null, botPatternsFile: null,
    evidenceBundleFile: null, staticEvidenceFile: null, depsReport: null, depsInstall: null,
    prBody: '',
  }
}

export function materializePlan(c, corpusDir, outDir) {
  return {
    source: resolve(corpusDir, c.repo),
    patch: resolve(corpusDir, c.patch),
    clone: join(outDir, 'repo'),
    prDiff: join(outDir, 'pr.diff'),
    contextFile: join(outDir, 'context.json'),
    worktreeFile: join(outDir, 'worktree.json'),
  }
}

export function cloneSteps(source, clone, baseSha, patch) {
  return [
    ['clone', '--no-hardlinks', '--no-checkout', source, clone],
    ['-C', clone, 'checkout', '--detach', baseSha],
    ['-C', clone, 'remote', 'remove', 'origin'],
    ['-C', clone, 'apply', patch],
  ]
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function isGitRoot(dir) {
  try {
    return realpathSync(git('-C', dir, 'rev-parse', '--show-toplevel')) === realpathSync(dir)
  } catch {
    return false
  }
}

// A bench project is plain files inside this repo, not a repo of its own, and a clone of the
// enclosing repo would carry unrelated history. So a source that is not a git root is copied
// into a fresh one-commit repo; baseRef then has to be HEAD.
export function ensureGitSource(source, scratchDir) {
  if (isGitRoot(source)) return source
  const copy = mkdtempSync(join(scratchDir, 'source-'))
  cpSync(source, copy, { recursive: true })
  const quiet = ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false']
  git('-C', copy, 'init', '-q')
  git('-C', copy, 'add', '-A')
  git('-C', copy, ...quiet, 'commit', '-q', '-m', 'bench base')
  return copy
}

function materialize(corpusPath, caseId, out) {
  const corpusFile = resolve(corpusPath)
  const cases = validateCorpus(JSON.parse(readFileSync(corpusFile, 'utf8')))
  const c = cases.find((x) => x.id === caseId)
  if (!c) throw new Error(`no case ${caseId} in ${corpusFile}`)
  const outDir = resolve(out)
  mkdirSync(outDir, { recursive: true })
  const plan = materializePlan(c, dirname(corpusFile), outDir)
  const source = ensureGitSource(plan.source, outDir)
  const baseSha = git('-C', source, 'rev-parse', '--verify', `${c.baseRef}^{commit}`)
  cloneSteps(source, plan.clone, baseSha, plan.patch).forEach((args) => git(...args))
  copyFileSync(plan.patch, plan.prDiff)
  const changedPaths = parseChangedPaths(readFileSync(plan.prDiff, 'utf8'))
  writeFileSync(plan.contextFile, `${JSON.stringify(buildContext(changedPaths, `bench case ${c.id}`), null, 2)}\n`)
  const worktree = { path: plan.clone, baseRef: c.baseRef, headSha: git('-C', plan.clone, 'rev-parse', 'HEAD') }
  writeFileSync(plan.worktreeFile, `${JSON.stringify(worktree, null, 2)}\n`)
  return { out: outDir, case: c.id, ...worktree }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const [corpus, id, out] = [arg('--corpus'), arg('--case'), arg('--out')]
  if (!corpus || !id || !out) {
    process.stderr.write('usage: bench-materialize.mjs --corpus <corpus.json> --case <id> --out <dir>\n')
    process.exit(2)
  }
  try {
    process.stdout.write(`${JSON.stringify(materialize(corpus, id, out))}\n`)
  } catch (error) {
    process.stderr.write(`bench-materialize: ${error.message}\n`)
    process.exit(1)
  }
}
