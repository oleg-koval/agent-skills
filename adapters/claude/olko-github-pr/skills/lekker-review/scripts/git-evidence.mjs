import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { riskPaths } from './risk-paths.mjs';

const FULL_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '--full-index', '--unified=3', '--inter-hunk-context=0', '--diff-algorithm=myers', '--indent-heuristic', '--no-relative', '--ignore-submodules=none', '--submodule=short', '-O/dev/null'];
const unavailable = reason => ({ schema: 1, status: 'unavailable', reason });
const git = (cwd, args) => execFileSync('git', ['-c', 'core.quotePath=true', '-c', 'diff.suppressBlankEmpty=false', '-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const fullSha = value => typeof value === 'string' && FULL_SHA.test(value);
const headOf = cwd => git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).toString('ascii').trim().toLowerCase();
const trackedStatus = cwd => git(cwd, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=none']);

export function collectGitEvidence({ worktreePath, mergeBase, headSha } = {}) {
  if (typeof worktreePath !== 'string' || !worktreePath || !fullSha(mergeBase) || !fullSha(headSha)) return unavailable('worktree path or full commit SHA is invalid');
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const baseSha = git(worktreePath, ['rev-parse', '--verify', `${mergeBase}^{commit}`]).toString('ascii').trim().toLowerCase();
    if (baseSha !== mergeBase.toLowerCase()) return unavailable('merge base does not resolve to the pinned commit');
    const headBefore = headOf(worktreePath);
    if (headBefore !== headSha.toLowerCase()) return unavailable('worktree HEAD does not match pinned head');
    if (trackedStatus(worktreePath).length) return unavailable('tracked worktree is dirty before collection');
    const rawDiff = git(worktreePath, ['diff', ...DIFF_FLAGS, baseSha, headBefore, '--']);
    const rawPaths = git(worktreePath, ['diff', '--name-only', '-z', ...DIFF_FLAGS, baseSha, headBefore, '--']);
    const headAfter = headOf(worktreePath);
    if (headAfter !== headBefore) return unavailable('worktree HEAD changed during collection');
    if (trackedStatus(worktreePath).length) return unavailable('tracked worktree became dirty during collection');
    const changedPaths = rawPaths.toString('latin1').split('\0').filter(Boolean)
      .map(path => decoder.decode(Buffer.from(path, 'latin1'))).sort();
    const text = decoder.decode(rawDiff);
    return { schema: 1, status: 'available', provenance: { baseSha, headSha: headAfter, trackedCleanBefore: true, trackedCleanAfter: true },
      changedPaths, diff: { sha256: createHash('sha256').update(rawDiff).digest('hex'), text }, risk: riskPaths(changedPaths, text) };
  } catch (error) {
    return unavailable(error instanceof TypeError ? 'git evidence is not valid UTF-8' : 'git evidence command failed');
  }
}
