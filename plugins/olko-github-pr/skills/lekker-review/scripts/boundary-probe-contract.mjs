import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HELPER_MODULES = Object.freeze(['boundary-cases.mjs', 'boundary-filesystem.mjs', 'boundary-invocation.mjs', 'boundary-probe-contract.mjs', 'boundary-probe-runner.mjs', 'boundary-report.mjs', 'boundary-source.mjs', 'boundary-validation.mjs', 'git-evidence.mjs'])
const sha256 = value => createHash('sha256').update(value).digest('hex')

export const unavailable = reason => ({ schema: 1, status: 'unavailable', reason, candidates: [] })

export function observedChangedPath(bundle, source) {
  return bundle?.git?.status === 'available' && Array.isArray(bundle.git.changedPaths)
    && bundle.git.changedPaths.includes(source) && /^[a-f0-9]{40,64}$/.test(bundle.git.provenance?.baseSha ?? '')
    && /^[a-f0-9]{40,64}$/.test(bundle.git.provenance?.headSha ?? '')
}

export function validProbeConfig(config) {
  return config && typeof config === 'object' && !Array.isArray(config) && config.schema === 1
    && typeof config.trustedRoot === 'string' && typeof config.repoSlug === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.repoSlug)
    && (config.suffix === undefined || typeof config.suffix === 'string') && /^[a-z0-9]*$/.test(config.suffix ?? '')
    && (config.inputKind === undefined || config.inputKind === 'ascii')
    && (config.sourcePath === undefined && config.operation === undefined && config.expectedProperty === undefined
      || typeof config.sourcePath === 'string' && /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.mjs$/.test(config.sourcePath)
        && config.operation === 'node-fs.mkdtempSync.filename'
        && config.expectedProperty === 'valid ASCII targets produce a component within the observed byte limit')
    && Number.isSafeInteger(config.seed)
    && (config.maxInputs === undefined || Number.isSafeInteger(config.maxInputs) && config.maxInputs >= 8 && config.maxInputs <= 88)
}

export function hashBoundaryHelpers(adapterUrl) {
  return Object.fromEntries(HELPER_MODULES.map(name => [name,
    sha256(readFileSync(fileURLToPath(new URL(`./${name}`, adapterUrl))))]))
}
