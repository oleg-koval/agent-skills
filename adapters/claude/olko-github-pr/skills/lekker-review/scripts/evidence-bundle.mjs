#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectGitEvidence } from './git-evidence.mjs';
import { validateLintReceipt } from './validate-lint-receipt.mjs';
import { runBoundaryProbe } from './boundary-probe-runner.mjs';
import { validateBoundaryReport } from './boundary-validation.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const unavailableLint = reason => ({ captureStatus: 'unavailable', reason });
const unavailableBundle = reason => ({ schema: 1,
  git: { schema: 1, status: 'unavailable', reason }, lint: unavailableLint(reason) });

function collectBoundary(options, git) {
  if (!options?.trustedOptIn) return undefined;
  if (typeof options.configPath !== 'string' || typeof options.outputDir !== 'string') return { captureStatus: 'unavailable', reason: 'trusted opt-in needs a config and output directory' };
  try {
    const config = JSON.parse(readFileSync(options.configPath, 'utf8'));
    const probe = runBoundaryProbe({ config, worktreePath: options.worktreePath, mergeBase: git.provenance.baseSha,
      headSha: git.provenance.headSha, outputDir: options.outputDir, optIn: true });
    return validateBoundaryReport(probe, git);
  } catch { return { captureStatus: 'unavailable', reason: 'trusted boundary artifact is missing or malformed' }; }
}

export function collectEvidence(worktreeMetadata, options = {}) {
  if (!record(worktreeMetadata)) return { ...unavailableBundle('worktree metadata is missing or malformed'),
    ...(options.trustedOptIn ? { boundary: { captureStatus: 'unavailable', reason: 'worktree metadata unavailable' } } : {}) };
  const git = collectGitEvidence({ worktreePath: worktreeMetadata.worktreePath,
    mergeBase: worktreeMetadata.mergeBase, headSha: worktreeMetadata.headSha });
  if (git.status !== 'available') return { schema: 1, git, lint: unavailableLint(`Git evidence unavailable: ${git.reason}`), ...(options.trustedOptIn ? { boundary: { captureStatus: 'unavailable', reason: 'Git evidence unavailable' } } : {}) };
  const boundary = collectBoundary({ ...options, worktreePath: worktreeMetadata.worktreePath }, git);
  if (typeof worktreeMetadata.eslintJson !== 'string' || !worktreeMetadata.eslintJson) return { schema: 1, git, lint: unavailableLint('lint report path unavailable'), ...(boundary ? { boundary } : {}) };
  if (typeof worktreeMetadata.eslintProvenance !== 'string' || !worktreeMetadata.eslintProvenance) return { schema: 1, git, lint: unavailableLint('lint provenance path unavailable'), ...(boundary ? { boundary } : {}) };
  let reportBytes, receipt;
  try { reportBytes = readFileSync(worktreeMetadata.eslintJson); } catch { return { schema: 1, git, lint: unavailableLint('lint report could not be read'), ...(boundary ? { boundary } : {}) }; }
  try { receipt = JSON.parse(readFileSync(worktreeMetadata.eslintProvenance, 'utf8')); } catch { return { schema: 1, git, lint: unavailableLint('lint provenance is missing or malformed'), ...(boundary ? { boundary } : {}) }; }
  const provenance = validateLintReceipt(receipt, { baseSha: git.provenance.baseSha,
    headSha: git.provenance.headSha, trackedClean: git.provenance.trackedCleanBefore && git.provenance.trackedCleanAfter }, reportBytes);
  if (provenance.status !== 'available') return { schema: 1, git, lint: unavailableLint(provenance.reason), ...(boundary ? { boundary } : {}) };
  let report;
  try { report = JSON.parse(reportBytes.toString('utf8')); } catch { return { schema: 1, git, lint: unavailableLint('lint report is malformed JSON'), ...(boundary ? { boundary } : {}) }; }
  if (!Array.isArray(report)) return { schema: 1, git, lint: unavailableLint('lint report is not a JSON array'), ...(boundary ? { boundary } : {}) };
  return { schema: 1, git, lint: { captureStatus: 'available', exitCode: provenance.exitCode,
    reportSha256: provenance.reportSha256, report }, ...(boundary ? { boundary } : {}) };
}

function main(argv) {
  const i = argv.indexOf('--worktree'), path = i < 0 ? null : argv[i + 1];
  if (!path || path.startsWith('--')) { console.error('usage: evidence-bundle.mjs --worktree <worktree.json> [--trusted-boundary-opt-in --boundary-config <file> --boundary-out <dir>]'); process.exitCode = 2; return; }
  const value = name => { const at = argv.indexOf(`--${name}`); return at < 0 ? null : argv[at + 1]; };
  const boundaryOptions = { trustedOptIn: argv.includes('--trusted-boundary-opt-in'), configPath: value('boundary-config'), outputDir: value('boundary-out') };
  try { console.log(JSON.stringify(collectEvidence(JSON.parse(readFileSync(path, 'utf8')), boundaryOptions))); }
  catch { console.log(JSON.stringify(unavailableBundle('worktree metadata could not be read'))); process.exitCode = 2; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
