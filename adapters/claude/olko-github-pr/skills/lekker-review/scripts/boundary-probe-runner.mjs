import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { observeComponentLimit } from './boundary-filesystem.mjs'
import { runTrustedCli } from './boundary-invocation.mjs'
import { generateBoundaryCases } from './boundary-cases.mjs'
import { assembleBoundaryReport, isBoundaryCandidate } from './boundary-report.mjs'
import { readTrustedSource, RUN_LOG_SOURCE } from './boundary-source.mjs'
import { hashBoundaryHelpers, observedChangedPath, unavailable, validProbeConfig } from './boundary-probe-contract.mjs'
import { collectGitEvidence } from './git-evidence.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')

export function runBoundaryProbe({ config, worktreePath, mergeBase, headSha, outputDir, optIn = false }) {
  if (!optIn) return unavailable('explicit trusted-probe opt-in is required')
  const sourcePath = config?.sourcePath ?? RUN_LOG_SOURCE
  const git = collectGitEvidence({ worktreePath, mergeBase, headSha })
  const evidenceBundle = { git }
  if (!observedChangedPath(evidenceBundle, sourcePath)) return unavailable('trusted adapter path is absent from observed Git changed paths')
  if (!validProbeConfig(config)) {
    return unavailable('trusted adapter configuration is missing or malformed')
  }
  try {
    const root = resolve(config.trustedRoot)
    const out = resolve(outputDir)
    if (existsSync(out)) throw new Error('output directory already exists; refusing to overwrite evidence')
    mkdirSync(out, { recursive: false })
    const componentLimit = observeComponentLimit(out)
    if (config.maxComponentBytes !== undefined && config.maxComponentBytes !== componentLimit) throw new Error('configured component limit differs from observed filesystem limit')
    const provenance = evidenceBundle.git.provenance
    const commits = { original: provenance.baseSha, defective: provenance.headSha,
      ...(config.repairedCommit ? { repaired: config.repairedCommit } : {}) }
    const roles = Object.keys(commits)
    const sources = Object.fromEntries(roles.map(role => [role, readTrustedSource(root, commits[role], sourcePath)]))
    const internalPrefix = `${'0'.repeat(15)}-${config.repoSlug}-`
    const cases = generateBoundaryCases({ seed: config.seed, limit: componentLimit,
      prefix: internalPrefix, suffix: config.suffix ?? '', count: config.maxInputs ?? 32, kinds: ['ascii'] })
      .filter(item => /^[a-z0-9-]+$/.test(item.input))
    const suffixBytes = Buffer.byteLength(config.suffix ?? '')
    const room = componentLimit - Buffer.byteLength(internalPrefix) - suffixBytes
    const requiredLengths = [room - 1 + suffixBytes, room + suffixBytes, room + 1 + suffixBytes]
    if (cases.length > 88 || requiredLengths.some(length => !cases.some(item => item.inputBytes === length))) {
      throw new Error('insufficient boundary coverage or input budget leaves no room for bounded reduction')
    }
    for (const [role, source] of Object.entries(sources)) writeFileSync(join(out, `${role}.source.mjs`), source.bytes)
    const results = cases.map(item => {
      const runs = Object.fromEntries(Object.entries(sources).map(([role, source]) => [role,
        runTrustedCli({ source, target: item.input, repoSlug: config.repoSlug, outputDir: out, id: `${item.id}-${role}` })]))
      return { id: item.id, kind: item.kind, input: item.input, inputSha256: item.inputSha256,
        inputBytes: item.inputBytes, prefix: internalPrefix, suffix: config.suffix ?? '',
        status: item.status, artifactRoot: out, runs }
    })
    const shrinkResults = []
    let reduced = null
    const firstCandidate = results.find(isBoundaryCandidate)
    if (firstCandidate) {
      let low = 0, high = firstCandidate.input.length, best = firstCandidate
      for (let step = 0; step < 10 && high - low > 1 && results.length + shrinkResults.length < 100; step += 1) {
        const middle = Math.floor((low + high) / 2), input = firstCandidate.input.slice(0, middle)
        const runs = Object.fromEntries(Object.entries(sources).map(([role, source]) => [role,
          runTrustedCli({ source, target: input, repoSlug: config.repoSlug, outputDir: out, id: `shrink-${step}-${role}` })]))
        const row = { id: `shrink-${step}`, kind: 'ascii', input, inputSha256: sha256(input), inputBytes: Buffer.byteLength(input),
          prefix: internalPrefix, suffix: config.suffix ?? '', status: 'available', artifactRoot: out, runs }
        shrinkResults.push(row)
        if (isBoundaryCandidate(row)) { high = middle; best = row } else low = middle
      }
      if (high - low > 1) throw new Error('bounded counterexample reduction exhausted invocation coverage')
      reduced = best
    }
    const report = assembleBoundaryReport({ source: sourcePath,
      provenance: { trustedRoot: root, repoSlug: config.repoSlug,
        baseSha: provenance.baseSha, headSha: provenance.headSha,
        sources: Object.fromEntries(Object.entries(sources).map(([role, source]) => [role,
          { commit: source.commit, sha256: source.sha256 }])) },
      seed: config.seed, componentLimit, prefixSha256: sha256(internalPrefix),
      suffixSha256: sha256(config.suffix ?? ''), cases, results, shrinkResults, outputDir: out, reduced })
    report.contract = { ...report.contract, operation: config.operation ?? 'node-fs.mkdtempSync.filename',
      expectedProperty: config.expectedProperty ?? 'valid ASCII targets produce a component within the observed byte limit',
      generator: 'seeded ASCII slug boundary lengths with bounded binary shrink',
      applicability: 'source path must appear in observed changed paths', invocationBudget: { inputs: config.maxInputs ?? 32, shrinkSteps: 10, timeoutMs: 5000 } }
    report.provenance.adapterSha256 = sha256(readFileSync(fileURLToPath(new URL('./boundary-probe.mjs', import.meta.url))))
    report.provenance.generatorSha256 = sha256(readFileSync(fileURLToPath(new URL('./boundary-cases.mjs', import.meta.url))))
    report.provenance.moduleSha256 = hashBoundaryHelpers(import.meta.url)
    report.provenance.runtime = process.version
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n')
    writeFileSync(join(out, 'boundary-report.json'), bytes)
    return { ...report, reportSha256: sha256(bytes), reportFile: join(out, 'boundary-report.json') }
  } catch (error) {
    return unavailable(`trusted boundary probe failed: ${error.message}`)
  }
}
