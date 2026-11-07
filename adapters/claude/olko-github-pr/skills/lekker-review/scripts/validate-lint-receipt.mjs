import { createHash } from 'node:crypto'

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i
const HASH = /^[0-9a-f]{64}$/i
const unavailable = reason => ({ status: 'unavailable', reason })

export function validateLintReceipt(receipt, expected, reportBytes) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return unavailable('receipt missing or malformed')
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return unavailable('expected provenance missing')
  if (!(reportBytes instanceof Uint8Array)) return unavailable('raw lint report bytes unavailable')
  if (typeof expected.baseSha !== 'string' || !FULL_SHA.test(expected.baseSha)
      || typeof expected.headSha !== 'string' || !FULL_SHA.test(expected.headSha)) return unavailable('expected base/head must be full SHAs')
  if (expected.trackedClean !== true) return unavailable('current tracked worktree is not clean')
  if (receipt.schema !== 1) return unavailable('unsupported receipt schema')
  if (receipt.status !== 'available') return unavailable(typeof receipt.reason === 'string' ? receipt.reason : 'receipt status is unavailable')
  if (typeof receipt.baseSha !== 'string' || !FULL_SHA.test(receipt.baseSha)
      || receipt.baseSha.toLowerCase() !== expected.baseSha.toLowerCase()) return unavailable('base SHA mismatch')
  if (typeof receipt.headShaBefore !== 'string' || !FULL_SHA.test(receipt.headShaBefore)
      || typeof receipt.headShaAfter !== 'string' || !FULL_SHA.test(receipt.headShaAfter)
      || receipt.headShaBefore.toLowerCase() !== receipt.headShaAfter.toLowerCase()
      || receipt.headShaBefore.toLowerCase() !== expected.headSha.toLowerCase()) return unavailable('head SHA mismatch or drift')
  if (receipt.trackedCleanBefore !== true || receipt.trackedCleanAfter !== true) return unavailable('captured tracked worktree was not clean')
  if (receipt.exitCode !== 0 && receipt.exitCode !== 1) return unavailable('invalid ESLint exit code')
  if (typeof receipt.reportSha256 !== 'string' || !HASH.test(receipt.reportSha256)) return unavailable('report SHA-256 missing or malformed')
  const reportSha256 = createHash('sha256').update(reportBytes).digest('hex')
  if (reportSha256 !== receipt.reportSha256.toLowerCase()) return unavailable('lint report hash mismatch')
  return {
    status: 'available',
    baseSha: receipt.baseSha, headSha: receipt.headShaBefore,
    exitCode: receipt.exitCode, reportSha256,
    trackedCleanBefore: receipt.trackedCleanBefore, trackedCleanAfter: receipt.trackedCleanAfter,
  }
}
