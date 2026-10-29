#!/usr/bin/env node
// Publish a local branch-review receipt using gh; PR-controlled values never enter shell source.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LABEL = 'reviewed-before-push';
export const PREFIX = '<!-- lekker:reviewed-before-push ';
const SHA = /^[a-f0-9]{40}$/;

export function validateReceipt(receipt) {
  if (receipt?.version !== 1 || receipt.mode !== 'branch' || receipt.result !== 'passed'
      || !SHA.test(receipt.headSha) || !SHA.test(receipt.baseSha)
      || !['workflow', 'codex', 'revmux'].includes(receipt.engine)
      || !['scan', 'medium', 'deep', 'deps'].includes(receipt.depth)
      || !Number.isFinite(Date.parse(receipt.reviewedAt))
      || !Array.isArray(receipt.findings)) {
    throw new Error('Invalid branch-review receipt');
  }
  for (const finding of receipt.findings) {
    if (!['critical', 'important', 'observation', 'idiomatic'].includes(finding.severity)
        || !['fixed', 'rebutted', 'open'].includes(finding.disposition)
        || (['critical', 'important'].includes(finding.severity) && finding.disposition === 'open')
        || (['fixed', 'rebutted'].includes(finding.disposition) && !finding.evidence?.trim())) {
      throw new Error('Findings require dispositions and evidence; no open Critical/Important finding is allowed');
    }
  }
  return receipt;
}

export function reviewComment(receipt) {
  validateReceipt(receipt);
  // Only publish the attestation, not local paths or potentially sensitive finding text.
  const { version, mode, result, headSha, baseSha, engine, depth, reviewedAt } = receipt;
  const attestation = { version, mode, result, headSha, baseSha, engine, depth, reviewedAt };
  return `Reviewed before push\n\nCommit: \`${headSha}\`\nBase: \`${baseSha}\`\nEngine: ${engine}\nDepth: ${depth}\nReviewed at: ${reviewedAt}\nResult: passed; no unresolved Critical/Important findings.\n\nThis records a local review; required CI and remote review gates still apply.\n\n${PREFIX}${JSON.stringify(attestation)} -->`;
}

export function publishReview({ repo, pr, receipt }, run = execFileSync) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[1-9]\d*$/.test(String(pr))) {
    throw new Error('Expected --repo owner/repo and a positive --pr number');
  }
  const body = reviewComment(receipt);
  const gh = (args, input) => run('gh', args, { encoding: 'utf8', input });
  const readHead = () => JSON.parse(gh(['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid,state']));
  const ensureCurrent = () => {
    const current = readHead();
    if (current.state !== 'OPEN' || current.headRefOid !== receipt.headSha) {
      throw new Error('PR is closed or its head differs from the reviewed commit; label withheld');
    }
  };
  ensureCurrent();
  // The installation is explicit: do not silently add a privileged workflow to someone else's repo.
  gh(['api', `repos/${repo}/contents/.github/workflows/reviewed-before-push.yml`]);
  gh(['api', '--method', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], JSON.stringify({ body }));
  gh(['label', 'create', LABEL, '--repo', repo, '--color', '0E8A16', '--description', 'Local review completed for the current PR head before push', '--force']);
  ensureCurrent();
  gh(['pr', 'edit', String(pr), '--repo', repo, '--add-label', LABEL]);
  // Catch a concurrent push after adding the label. The workflow also reconciles later pushes.
  try {
    ensureCurrent();
  } catch (error) {
    gh(['pr', 'edit', String(pr), '--repo', repo, '--remove-label', LABEL]);
    throw error;
  }
  return { label: LABEL, headSha: receipt.headSha };
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--repo', '--pr', '--receipt'].includes(argv[i]) || !argv[i + 1] || options[argv[i]]) {
      throw new Error('Usage: review-label.mjs --repo owner/repo --pr N --receipt receipt.json');
    }
    options[argv[i]] = argv[i + 1];
  }
  if (!options['--receipt']) throw new Error('--receipt is required');
  const receipt = JSON.parse(readFileSync(options['--receipt'], 'utf8'));
  console.log(JSON.stringify(publishReview({ repo: options['--repo'], pr: options['--pr'], receipt })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
