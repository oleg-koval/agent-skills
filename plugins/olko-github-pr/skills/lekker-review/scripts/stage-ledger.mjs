import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const counters = ['inputTokens', 'cachedInputTokens', 'outputTokens']
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const unavailable = reason => ({ schema: 1, status: 'unavailable', reason, stages: [] })

function validCount(value) { return Number.isSafeInteger(value) && value >= 0 }

export function buildStageLedger(manifest, adjudication) {
  if (!record(manifest) || manifest.schema !== 1 || !Array.isArray(manifest.sessions)) return unavailable('explicit session manifest is missing or malformed')
  const seen = new Set(), stages = new Map()
  for (const session of manifest.sessions) {
    if (!record(session) || typeof session.sessionId !== 'string' || !session.sessionId || typeof session.stage !== 'string' || !session.stage) return unavailable('session identity or stage is invalid')
    if (seen.has(session.sessionId)) return unavailable('duplicate session identity')
    seen.add(session.sessionId)
    let stage = stages.get(session.stage)
    if (!stage) { stage = { name: session.stage, sessions: 0, status: 'available', inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, elapsedSeconds: [], unavailableSessions: 0 }; stages.set(session.stage, stage) }
    if (session.status !== 'available') { stage.status = 'partial'; stage.unavailableSessions += 1; continue }
    if (!record(session.usage) || counters.some(key => !validCount(session.usage[key])) || session.usage.cachedInputTokens > session.usage.inputTokens
      || session.elapsedSeconds !== undefined && !(typeof session.elapsedSeconds === 'number' && Number.isFinite(session.elapsedSeconds) && session.elapsedSeconds >= 0)) return unavailable('session counters or elapsed observation are invalid')
    stage.sessions += 1
    stage.inputTokens += session.usage.inputTokens
    stage.cachedInputTokens += session.usage.cachedInputTokens
    stage.uncachedInputTokens += session.usage.inputTokens - session.usage.cachedInputTokens
    stage.outputTokens += session.usage.outputTokens
    if (session.elapsedSeconds !== undefined) stage.elapsedSeconds.push(session.elapsedSeconds)
  }
  const claims = adjudication?.claims
  let outcome = { status: 'unavailable', confirmedDefects: [], falseAlarms: null, duplicates: null, unknownDiscovery: null, unknownVerification: null }
  if (record(adjudication) && adjudication.schema === 1 && Array.isArray(claims)) {
    if (claims.some(item => !record(item) || !['confirmed', 'false-alarm', 'duplicate', 'unresolved'].includes(item.verdict))) return unavailable('adjudication claim is malformed')
    for (const stage of stages.values()) { stage.discoveredDefects = []; stage.verifiedDefects = [] }
    const confirmed = claims.filter(item => item?.verdict === 'confirmed')
    const ids = confirmed.map(item => item.defectId).filter(id => typeof id === 'string' && id)
    outcome = { status: 'available', confirmedDefects: [...new Set(ids)], falseAlarms: claims.filter(item => item.verdict === 'false-alarm').length,
      duplicates: claims.filter(item => item.verdict === 'duplicate').length, unresolved: claims.filter(item => item.verdict === 'unresolved').length,
      unknownDiscovery: 0, unknownVerification: 0 }
    for (const item of confirmed) {
      if (typeof item.defectId !== 'string' || !item.defectId) return unavailable('confirmed claim lacks a defect identity')
      for (const [field, value] of [['discoveredDefects', item.discoveryStage], ['verifiedDefects', item.verificationStage]]) {
        const bucket = field === 'discoveredDefects' ? 'unknownDiscovery' : 'unknownVerification'
        if (!stages.has(value)) outcome[bucket] += 1
        else {
          const stage = stages.get(value)
          stage[field] ??= []
          stage[field].push(item.defectId)
        }
      }
    }
    for (const stage of stages.values()) {
      stage.discoveredDefects = [...new Set(stage.discoveredDefects ?? [])]
      stage.verifiedDefects = [...new Set(stage.verifiedDefects ?? [])]
    }
  }
  for (const stage of stages.values()) {
    if (stage.status === 'partial') for (const key of ['inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens']) stage[key] = null
    else for (const key of ['inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens']) if (!Number.isSafeInteger(stage[key])) return unavailable('stage totals exceed safe integer range')
  }
  return { schema: 1, status: 'available', stages: [...stages.values()], outcomes: outcome }
}

export function buildStageLedgerFromFiles(manifest, adjudication) {
  if (!record(manifest) || manifest.schema !== 1 || !Array.isArray(manifest.runs)) return buildStageLedger(manifest, adjudication)
  const sessions = []
  for (const [index, run] of manifest.runs.entries()) {
    if (!record(run) || typeof run.stage !== 'string' || !run.stage || typeof run.usageFile !== 'string' || !run.usageFile) return unavailable('run manifest needs explicit stage and usageFile entries')
    let saved
    try { saved = JSON.parse(readFileSync(run.usageFile, 'utf8')) } catch {
      sessions.push({ sessionId: `${run.stage}:unavailable:${index}`, stage: run.stage, status: 'unavailable' }); continue
    }
    if (!record(saved) || saved.available !== true || !Array.isArray(saved.sessions) || saved.sessions.length === 0) {
      sessions.push({ sessionId: `${run.stage}:unavailable:${index}`, stage: run.stage, status: 'unavailable' }); continue
    }
    for (const [sessionIndex, row] of saved.sessions.entries()) {
      if (!record(row)) { sessions.push({ sessionId: `${run.stage}:malformed:${index}:${sessionIndex}`, stage: run.stage, status: 'unavailable' }); continue }
      sessions.push({ sessionId: row.sessionId, stage: run.stage,
      status: row.usage ? 'available' : 'unavailable', usage: row.usage && {
        inputTokens: row.usage.input_tokens, cachedInputTokens: row.usage.cached_input_tokens,
        outputTokens: row.usage.output_tokens }, elapsedSeconds: row.wallSeconds })
    }
  }
  const claims = Array.isArray(adjudication?.claims) ? adjudication.claims
    : Array.isArray(adjudication?.evaluations) ? adjudication.evaluations.flatMap(item => item?.decisions ?? []) : null
  return buildStageLedger({ schema: 1, sessions }, claims ? { schema: 1, claims } : null)
}

function main(argv) {
  const arg = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1] }
  const manifest = arg('manifest'), adjudication = arg('adjudication')
  if (!manifest || manifest.startsWith('--')) { console.error('usage: stage-ledger.mjs --manifest <saved-session-manifest.json> [--adjudication <saved-adjudication.json>]'); process.exitCode = 2; return }
  try { console.log(JSON.stringify(buildStageLedgerFromFiles(JSON.parse(readFileSync(manifest, 'utf8')), adjudication ? JSON.parse(readFileSync(adjudication, 'utf8')) : null))) }
  catch { console.log(JSON.stringify(unavailable('explicit artifact could not be read'))); process.exitCode = 2 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
