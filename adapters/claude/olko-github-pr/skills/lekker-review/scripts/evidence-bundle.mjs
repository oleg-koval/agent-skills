#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectGitEvidence } from './git-evidence.mjs';
import { validateLintReceipt } from './validate-lint-receipt.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const unavailableLint = reason => ({ captureStatus: 'unavailable', reason });
const unavailableBundle = reason => ({ schema: 1,
  git: { schema: 1, status: 'unavailable', reason }, lint: unavailableLint(reason) });

export function collectEvidence(worktreeMetadata) {
  if (!record(worktreeMetadata)) return unavailableBundle('worktree metadata is missing or malformed');
  const git = collectGitEvidence({ worktreePath: worktreeMetadata.worktreePath,
    mergeBase: worktreeMetadata.mergeBase, headSha: worktreeMetadata.headSha });
  if (git.status !== 'available') return { schema: 1, git, lint: unavailableLint(`Git evidence unavailable: ${git.reason}`) };
  if (typeof worktreeMetadata.eslintJson !== 'string' || !worktreeMetadata.eslintJson) return { schema: 1, git, lint: unavailableLint('lint report path unavailable') };
  if (typeof worktreeMetadata.eslintProvenance !== 'string' || !worktreeMetadata.eslintProvenance) return { schema: 1, git, lint: unavailableLint('lint provenance path unavailable') };
  let reportBytes, receipt;
  try { reportBytes = readFileSync(worktreeMetadata.eslintJson); } catch { return { schema: 1, git, lint: unavailableLint('lint report could not be read') }; }
  try { receipt = JSON.parse(readFileSync(worktreeMetadata.eslintProvenance, 'utf8')); } catch { return { schema: 1, git, lint: unavailableLint('lint provenance is missing or malformed') }; }
  const provenance = validateLintReceipt(receipt, { baseSha: git.provenance.baseSha,
    headSha: git.provenance.headSha, trackedClean: git.provenance.trackedCleanBefore && git.provenance.trackedCleanAfter }, reportBytes);
  if (provenance.status !== 'available') return { schema: 1, git, lint: unavailableLint(provenance.reason) };
  let report;
  try { report = JSON.parse(reportBytes.toString('utf8')); } catch { return { schema: 1, git, lint: unavailableLint('lint report is malformed JSON') }; }
  if (!Array.isArray(report)) return { schema: 1, git, lint: unavailableLint('lint report is not a JSON array') };
  return { schema: 1, git, lint: { captureStatus: 'available', exitCode: provenance.exitCode,
    reportSha256: provenance.reportSha256, report } };
}

function main(argv) {
  const i = argv.indexOf('--worktree'), path = i < 0 ? null : argv[i + 1];
  if (!path || path.startsWith('--')) { console.error('usage: evidence-bundle.mjs --worktree <worktree.json>'); process.exitCode = 2; return; }
  try { console.log(JSON.stringify(collectEvidence(JSON.parse(readFileSync(path, 'utf8'))))); }
  catch { console.log(JSON.stringify(unavailableBundle('worktree metadata could not be read'))); process.exitCode = 2; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
