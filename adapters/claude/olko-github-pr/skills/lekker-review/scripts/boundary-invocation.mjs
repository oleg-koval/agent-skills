import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = value => createHash('sha256').update(value).digest('hex')

export function runTrustedCli({ source, target, repoSlug, outputDir, id, timeoutMs = 5000 }) {
  const dir = join(outputDir, id)
  const home = join(dir, 'home'), state = join(dir, 'state'), scripts = join(dir, 'scripts')
  mkdirSync(home, { recursive: true }); mkdirSync(state, { recursive: true }); mkdirSync(scripts, { recursive: true })
  const cli = join(scripts, 'run-log.mjs')
  writeFileSync(cli, source.bytes)
  const child = spawnSync(process.execPath, [cli, 'start', '--repo', `trusted/${repoSlug}`, '--target', target,
    '--mode', 'branch', '--depth', 'scan', '--engine', 'workflow', '--host', 'codex'], {
    cwd: dir, env: { HOME: home, LEKKER_STATE_DIR: state, TMPDIR: dir, PATH: '/usr/bin:/bin' }, encoding: 'buffer', timeout: timeoutMs,
  })
  const stdout = child.stdout ?? Buffer.alloc(0), stderr = child.stderr ?? Buffer.alloc(0)
  writeFileSync(join(dir, 'stdout.raw'), stdout); writeFileSync(join(dir, 'stderr.raw'), stderr)
  const exitClass = child.status === 0 ? 'success'
    : child.status === 1 && stderr.toString('utf8').includes('ENAMETOOLONG') ? 'component-limit' : 'unexpected'
  return { status: child.error?.code === 'ETIMEDOUT' ? 'timeout' : child.error || child.signal ? 'unavailable' : 'observed',
    exitCode: child.status, signal: child.signal ?? null, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr),
    stdoutFile: `${id}/stdout.raw`, stderrFile: `${id}/stderr.raw`, errorCode: child.error?.code ?? null, exitClass }
}
