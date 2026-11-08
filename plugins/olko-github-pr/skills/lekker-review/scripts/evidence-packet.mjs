import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const unavailable = reason => ({ schema: 1, status: 'unavailable', reason })

function reportIntegrity(boundary) {
  if (boundary?.captureStatus !== 'available') return false
  const report = boundary.report
  if (!record(report)) return false
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n')
  return sha256(bytes) === boundary.reportSha256
}

function filePatches(diff, paths) {
  const chunks = diff.split(/(?=^diff --git )/m).filter(Boolean)
  return paths.flatMap(path => {
    const chunk = chunks.find(value => value.startsWith(`diff --git a/${path} b/${path}\n`))
    if (!chunk) return []
    return [{ path, patch: chunk.trimEnd(), ranges: [...chunk.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(m => ({ start: Number(m[1]), count: Number(m[2] ?? 1) })) }]
  })
}

export function projectEvidencePacket(bundleBytes, expectedSha256, { dimension, paths, maxBytes = 32768 } = {}) {
  try {
    if (!Buffer.isBuffer(bundleBytes) || sha256(bundleBytes) !== expectedSha256) return unavailable('full bundle hash mismatch')
    const bundle = JSON.parse(bundleBytes.toString('utf8'))
    if (!record(bundle) || bundle.schema !== 1 || bundle.git?.status !== 'available' || !record(bundle.git.diff)
      || typeof bundle.git.diff.text !== 'string' || sha256(Buffer.from(bundle.git.diff.text)) !== bundle.git.diff.sha256) return unavailable('full evidence bundle is invalid')
    if (typeof dimension !== 'string' || !dimension || !Array.isArray(paths) || !paths.length
      || paths.some(path => typeof path !== 'string' || !bundle.git.changedPaths.includes(path))
      || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 262144) return unavailable('packet scope or size budget is invalid')
    const sourceRanges = filePatches(bundle.git.diff.text, paths)
    if (sourceRanges.length !== paths.length) return unavailable('selected source patch is missing from the full diff')
    const diagnostics = bundle.lint?.captureStatus === 'available' && Array.isArray(bundle.lint.report)
      ? bundle.lint.report.filter(row => paths.includes(row.filePath ?? row.file ?? row.filename)) : []
    const boundary = bundle.boundary
    if (boundary?.captureStatus === 'available' && !reportIntegrity(boundary)) return unavailable('boundary report hash mismatch')
    const report = boundary?.report
    if (boundary?.captureStatus === 'available' && (report.provenance?.baseSha !== bundle.git.provenance?.baseSha
      || report.provenance?.headSha !== bundle.git.provenance?.headSha || !bundle.git.changedPaths.includes(report.source))) return unavailable('boundary provenance does not match the full bundle')
    const candidate = report?.reducedCounterexample && report.candidates?.find(row => row.id === report.reducedCounterexample.id)
    const packet = { schema: 1, status: 'available', mode: 'shadow-projection', dimension, scope: { paths: [...paths].sort(), omittedPaths: bundle.git.changedPaths.filter(path => !paths.includes(path)), omittedContextReviewed: false, wholeDiffPassRequired: true },
      provenance: { baseSha: bundle.git.provenance?.baseSha, headSha: bundle.git.provenance?.headSha,
        diffSha256: bundle.git.diff.sha256, fullBundleSha256: expectedSha256,
        boundaryReportSha256: boundary?.captureStatus === 'available' ? boundary.reportSha256 : null },
      sourceRanges, lint: bundle.lint?.captureStatus === 'available' ? { status: 'available', diagnostics } : { status: 'unavailable', reason: bundle.lint?.reason ?? 'lint evidence absent' },
      boundary: boundary?.captureStatus === 'available' ? { status: candidate ? 'candidate' : 'no-candidate', source: report.source,
        contract: report.contract, provenance: report.provenance,
        witness: candidate ? { input: candidate.input, inputSha256: candidate.inputSha256, outcomes: candidate.outcomes,
          reducedScope: report.reducedCounterexample.scope, failure: boundary.summary?.reducedFailure } : null }
        : { status: 'unavailable', reason: boundary?.reason ?? 'boundary evidence absent' },
      coverageGaps: { omittedChangedPaths: bundle.git.changedPaths.filter(path => !paths.includes(path)), notApplicableDiagnosticsOmitted: (bundle.lint?.report?.length ?? 0) - diagnostics.length,
        omittedContextReviewed: false, broadDiffReviewRequired: true } }
    packet.packetBytes = 0
    packet.fullBundleBytes = bundleBytes.length
    let packetBytes = Buffer.byteLength(JSON.stringify(packet))
    while (packet.packetBytes !== packetBytes) { packet.packetBytes = packetBytes; packetBytes = Buffer.byteLength(JSON.stringify(packet)) }
    if (packetBytes > maxBytes) return unavailable('projected packet exceeds configured byte budget')
    return packet
  } catch { return unavailable('bundle or packet input is malformed') }
}

function main(argv) {
  const value = key => { const at = argv.indexOf(`--${key}`); return at < 0 ? null : argv[at + 1] }
  const file = value('bundle'), hash = value('sha256'), dimension = value('dimension'), paths = argv.flatMap((arg, i) => arg === '--path' ? [argv[i + 1]] : [])
  if (!file || !hash || !dimension || !paths.length) { console.error('usage: evidence-packet.mjs --bundle <full-bundle.json> --sha256 <trusted-bundle-sha256> --dimension <name> --path <changed-path> [--path <changed-path>] [--max-bytes <n>]'); process.exitCode = 2; return }
  try { console.log(JSON.stringify(projectEvidencePacket(readFileSync(file), hash, { dimension, paths, maxBytes: Number(value('max-bytes') ?? 32768) }))) }
  catch { console.log(JSON.stringify(unavailable('explicit bundle could not be read'))); process.exitCode = 2 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
