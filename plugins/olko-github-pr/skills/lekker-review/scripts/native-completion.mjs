import { createHash } from 'node:crypto';

const DIMENSIONS = {
  deps: ['deps'],
  scan: ['triage-quality', 'triage-logic', 'project-rules'],
  medium: ['quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules'],
  deep: ['quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'project-rules'],
};
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const HASH = /^[a-f0-9]{64}$/i;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

export function validateNativeCompletion(receipt, expected, findingsBytes) {
  const unavailable = reason => ({ available: false, reason });
  if (!record(expected) || !record(expected.eligible) || !record(receipt)) return unavailable('receipt or expected inputs are malformed');
  if (!['deps', 'scan', 'medium', 'deep'].includes(expected.depth) || typeof expected.worktreeAvailable !== 'boolean'
      || !count(expected.eligible.verify) || !count(expected.eligible.prove)) return unavailable('expected policy inputs are malformed');
  if (typeof expected.runId !== 'string' || !expected.runId || typeof expected.headSha !== 'string' || !SHA.test(expected.headSha)) return unavailable('expected identity is malformed');
  if (!(findingsBytes instanceof Uint8Array)) return unavailable('findings bytes are unavailable');
  if (receipt.schema !== 1 || receipt.engine !== 'codex' || receipt.status !== 'complete') return unavailable('native completion is not complete');
  if (receipt.runId !== expected.runId || receipt.depth !== expected.depth) return unavailable('run identity or depth mismatch');
  if (typeof receipt.headSha !== 'string' || !SHA.test(receipt.headSha) || receipt.headSha.toLowerCase() !== expected.headSha.toLowerCase()) return unavailable('head SHA mismatch');
  if (typeof receipt.findingsSha256 !== 'string' || !HASH.test(receipt.findingsSha256)
      || createHash('sha256').update(findingsBytes).digest('hex') !== receipt.findingsSha256.toLowerCase()) return unavailable('findings hash mismatch');
  const required = DIMENSIONS[expected.depth];
  if (!Array.isArray(receipt.dimensions) || receipt.dimensions.length !== required.length) return unavailable('required review dimensions are missing or duplicated');
  const dimensions = Array.from(receipt.dimensions);
  if (dimensions.some(d => !record(d) || !required.includes(d.name) || d.status !== 'completed')) return unavailable('review dimensions are missing, unknown, or incomplete');
  if (new Set(dimensions.map(d => d.name)).size !== required.length) return unavailable('review dimensions are duplicated');
  const verify = expected.depth === 'deps' ? 0 : expected.eligible.verify;
  const prove = ['medium', 'deep'].includes(expected.depth) && expected.worktreeAvailable ? Math.min(5, expected.eligible.prove) : 0;
  const validStage = (stage, scheduled) => record(stage) && count(stage.scheduled) && count(stage.completed)
    && count(stage.failed) && stage.scheduled === scheduled && stage.completed === scheduled && stage.failed === 0;
  if (!record(receipt.stages) || !validStage(receipt.stages.verify, verify) || !validStage(receipt.stages.prove, prove)) return unavailable('verification or proof stage accounting is incomplete');
  if (receipt.stages.critic !== (expected.depth === 'deep' ? 'completed' : 'not_required')) return unavailable('critic stage status does not match depth');
  return { available: true, reason: null };
}
