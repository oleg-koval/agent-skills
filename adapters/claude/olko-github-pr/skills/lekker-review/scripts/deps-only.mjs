#!/usr/bin/env node
// Decides whether a PR is a pure dependency change: every changed file is a
// lockfile or a package.json, and each package.json differs only in its
// dependency keys. Such a PR gets the one-agent `deps` depth; anything else is
// `mixed` and falls back to the normal depth rules.
//
//   node deps-only.mjs <worktreePath> <mergeBase> <changed file>...
//
// Prints JSON: { kind: "deps"|"mixed", packageJsons, lockDirs, otherFiles }.
// Exit 0 in both cases; exit 2 only on bad arguments.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname } from 'node:path'

export const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
])
// `engines` is here because a dependency bump that needs a newer runtime
// raises it in the same PR; the deps agent checks it against the runtime image.
export const DEP_KEYS = new Set([
  'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
  'overrides', 'resolutions', 'engines',
])

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort()
}

// readAt(rev, path) returns the file text at that revision, or null when the
// file does not exist there. Injected so the selftest can drive it with fixtures.
export function classify(files, readAt, base = 'BASE', head = 'HEAD') {
  const packageJsons = []
  const lockDirs = []
  const otherFiles = []
  for (const file of files) {
    const name = basename(file)
    if (LOCKFILES.has(name)) {
      lockDirs.push(dirname(file))
      continue
    }
    if (name !== 'package.json') {
      otherFiles.push(file)
      continue
    }
    let before, after
    try {
      const b = readAt(base, file), a = readAt(head, file)
      if (b == null || a == null) throw new Error('missing on one side')
      before = JSON.parse(b)
      after = JSON.parse(a)
      if (!before || !after || typeof before !== 'object' || typeof after !== 'object') throw new Error('not an object')
    } catch {
      // Added, deleted or unparseable: a new or removed workspace is not a bump.
      packageJsons.push({ file, depKeysChanged: [], otherKeysChanged: ['<added, removed or unparseable>'] })
      continue
    }
    const keys = changedKeys(before, after)
    packageJsons.push({
      file,
      depKeysChanged: keys.filter(k => DEP_KEYS.has(k)),
      otherKeysChanged: keys.filter(k => !DEP_KEYS.has(k)),
    })
  }
  const pure = otherFiles.length === 0
    && packageJsons.every(p => p.otherKeysChanged.length === 0)
    && (lockDirs.length > 0 || packageJsons.length > 0)
  return { kind: pure ? 'deps' : 'mixed', packageJsons, lockDirs: [...new Set(lockDirs)].sort(), otherFiles }
}

function gitReader(worktree) {
  return (rev, path) => {
    try {
      return execFileSync('git', ['-C', worktree, 'show', `${rev}:${path}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      return null
    }
  }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isMain()) {
  const [worktree, mergeBase, ...files] = process.argv.slice(2)
  if (!worktree || !mergeBase || files.length === 0) {
    console.error('usage: deps-only.mjs <worktreePath> <mergeBase> <changed file>...')
    process.exit(2)
  }
  console.log(JSON.stringify(classify(files, gitReader(worktree), mergeBase, 'HEAD'), null, 2))
}
