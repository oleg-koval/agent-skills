import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const RUN_LOG_SOURCE = 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs'
const gitEnv = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

export function readTrustedSource(root, commit, sourcePath = RUN_LOG_SOURCE) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('trusted source needs an exact commit SHA')
  if (typeof sourcePath !== 'string' || sourcePath.startsWith('/') || sourcePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('trusted source path must be repository-relative')
  let resolved
  try {
    resolved = execFileSync('git', ['--no-replace-objects', '-C', root, 'rev-parse', '--verify', `${commit}^{commit}`], {
      encoding: 'utf8', env: gitEnv, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch { throw new Error('trusted commit is unavailable') }
  if (resolved !== commit) throw new Error('trusted commit did not resolve exactly')
  let bytes
  try { bytes = execFileSync('git', ['--no-replace-objects', '-C', root, 'show', `${resolved}:${sourcePath}`], { env: gitEnv, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { throw new Error('trusted CLI source is unavailable at the pinned commit') }
  return { commit: resolved, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}
