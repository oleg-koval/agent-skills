import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fullSha = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const MODULES = ['boundary-cases.mjs', 'boundary-filesystem.mjs', 'boundary-invocation.mjs',
  'boundary-probe-contract.mjs', 'boundary-probe-runner.mjs', 'boundary-report.mjs', 'boundary-source.mjs', 'boundary-validation.mjs', 'git-evidence.mjs'];

export function validateBoundaryReport(probe, git) {
  try {
    if (probe?.status !== 'available' || typeof probe.reportFile !== 'string') return { captureStatus: 'unavailable', reason: probe?.reason ?? 'trusted boundary probe unavailable' };
    const bytes = readFileSync(probe.reportFile), digestValue = createHash('sha256').update(bytes).digest('hex');
    const report = JSON.parse(bytes.toString('utf8'));
    const invalid = validateShape(report, git);
    if (digestValue !== probe.reportSha256 || invalid) return { captureStatus: 'unavailable', reason: invalid ?? 'boundary artifact hash mismatch' };
    const reducedFailure = readReducedFailure(report, probe.reportFile);
    return { captureStatus: 'available', reportPath: probe.reportFile, reportSha256: digestValue,
      provenance: report.provenance, summary: { candidateCount: report.candidates.length,
        inputCount: report.results.length, evidenceClass: 'composed trusted CLI probe',
        ...(reducedFailure ? { reducedFailure } : {}) }, report };
  } catch { return { captureStatus: 'unavailable', reason: 'trusted boundary artifact is missing or malformed' }; }
}

function readReducedFailure(report, reportFile) {
  if (!report.reducedCounterexample) return null;
  const row = report.results.find(result => result.id === report.reducedCounterexample.id);
  const run = row.runs.defective;
  const root = realpathSync(dirname(reportFile));
  if (realpathSync(report.artifactRoot) !== root || run.stderrFile !== `${row.id}-defective/stderr.raw`) throw new Error('invalid boundary artifact path');
  const path = realpathSync(join(root, run.stderrFile)), inside = relative(root, path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('boundary artifact escaped output directory');
  const stderr = readFileSync(path);
  if (sha256(stderr) !== run.stderrSha256 || !stderr.includes('ENAMETOOLONG')) throw new Error('boundary stderr does not support failure class');
  return { caseId: row.id, exitClass: run.exitClass, failureCode: 'ENAMETOOLONG',
    stderrFile: run.stderrFile, stderrSha256: run.stderrSha256 };
}

function validRun(run) {
  if (!record(run) || run.status !== 'observed' || !digest(run.stdoutSha256) || !digest(run.stderrSha256)
    || typeof run.stdoutFile !== 'string' || typeof run.stderrFile !== 'string') return false;
  return run.exitClass === 'success' && run.exitCode === 0 || run.exitClass === 'component-limit' && run.exitCode === 1;
}

function defectCandidate(row) {
  return row.runs.original.exitClass === 'success' && row.runs.defective.exitClass === 'component-limit'
    && (!row.runs.repaired || row.runs.repaired.exitClass === 'success');
}

function validateShape(report, git) {
  if (!record(report) || report.schema !== 1 || report.status !== 'available' || typeof report.source !== 'string'
    || report.source.startsWith('/') || report.source.split('/').some(part => !part || part === '.' || part === '..')) return 'boundary report identity is invalid';
  if (git?.status !== 'available' || !Array.isArray(git.changedPaths) || !git.changedPaths.includes(report.source)
    || report.provenance?.baseSha !== git.provenance?.baseSha || report.provenance?.headSha !== git.provenance?.headSha) return 'boundary report Git identity mismatch';
  if (!Array.isArray(report.results) || report.results.length === 0 || report.results.length > 100
    || report.contract?.count !== report.results.length || !Number.isSafeInteger(report.contract?.maxComponentBytes)
    || report.contract.maxComponentBytes < 1 || typeof report.contract.validInput !== 'string'
    || !Number.isSafeInteger(report.seed) || !Array.isArray(report.candidates)) return 'boundary report coverage is empty, malformed, or over budget';
  if (!fullSha(report.provenance.sources?.original?.commit) || report.provenance.sources.original.commit !== git.provenance.baseSha
    || !fullSha(report.provenance.sources?.defective?.commit) || report.provenance.sources.defective.commit !== git.provenance.headSha
    || !digest(report.provenance.sources.original.sha256) || !digest(report.provenance.sources.defective.sha256)
    || !digest(report.provenance.adapterSha256) || !digest(report.provenance.generatorSha256)
    || !record(report.provenance.moduleSha256) || Object.keys(report.provenance.moduleSha256).sort().join(',') !== MODULES.slice().sort().join(',')
    || Object.values(report.provenance.moduleSha256).some(value => !digest(value))
    || typeof report.provenance.runtime !== 'string' || typeof report.provenance.trustedRoot !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(report.provenance.repoSlug ?? '')) return 'boundary report source provenance is invalid';
  const roles = report.provenance.sources.repaired ? ['original', 'defective', 'repaired'] : ['original', 'defective'];
  if (roles.includes('repaired') && (!fullSha(report.provenance.sources.repaired.commit) || !digest(report.provenance.sources.repaired.sha256))) return 'boundary repaired source provenance is invalid';
  const ids = report.results.map(row => row?.id);
  if (new Set(ids).size !== ids.length) return 'boundary input identifiers are duplicated';
  for (const row of report.results) {
    if (!record(row) || typeof row.id !== 'string' || !/^[a-z0-9-]+$/.test(row.id)
      || typeof row.input !== 'string' || !/^[a-z0-9-]+$/.test(row.input)
      || row.status !== 'available' || row.inputBytes !== Buffer.byteLength(row.input) || row.inputSha256 !== sha256(row.input)) return 'boundary input coverage is invalid';
    if (!record(row.runs) || roles.some(role => !validRun(row.runs[role]))) return 'boundary invocation outcome is incomplete';
  }
  const expected = report.results.filter(defectCandidate).map(row => row.id).sort(), candidates = report.candidates;
  if (expected.length !== candidates.length || new Set(candidates.map(candidate => candidate?.id)).size !== candidates.length) return 'boundary candidate summary does not match observed outcomes';
  if (candidates.some(candidate => {
    const row = report.results.find(result => result.id === candidate?.id);
    return !row || !expected.includes(candidate.id) || candidate.input !== row.input || candidate.inputSha256 !== row.inputSha256
      || candidate.evidenceClass !== 'composed trusted CLI probe';
  })) return 'boundary candidate identity does not match observed outcomes';
  if (candidates.some(candidate => {
    const row = report.results.find(result => result.id === candidate.id);
    return roles.some(role => candidate.outcomes?.[role] !== row.runs[role].exitCode);
  })) return 'boundary candidate outcomes do not match invocation outcomes';
  const reduced = report.reducedCounterexample;
  if (!candidates.length) return reduced == null ? null : 'boundary reduced input has no candidate';
  const row = report.results.find(result => result.id === reduced?.id);
  if (!record(reduced) || !row || !candidates.some(candidate => candidate.id === row.id)
    || reduced.input !== row.input || reduced.inputSha256 !== row.inputSha256
    || roles.some(role => reduced.outcomes?.[role] !== row.runs[role].exitCode)) return 'boundary reduced input does not match observed candidate';
  return null;
}
