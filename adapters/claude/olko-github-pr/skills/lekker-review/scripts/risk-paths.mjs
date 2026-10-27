#!/usr/bin/env node
// Path-based risk for AUTO-DEPTH. Size alone misses the small PRs that matter:
// a 10-line change to a workflow file, a session check or a P21 mapping.
//
// Usage:
//   node risk-paths.mjs [--diff <pr.diff>] <changed-file>...
//   git diff --name-only <base>...HEAD | node risk-paths.mjs --stdin [--diff <pr.diff>]
//
// Prints {"deep": bool, "needsHumanReview": bool, "categories": [{category, files}]}.
// `--diff` also lets the identifier `p21` count when it only appears in added lines.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RISK_RULES = [
  { category: 'ci-workflow', test: (f) => /^\.github\/workflows\//.test(f) },
  { category: 'auth', test: (f) => /(^|[/._-])(auth|authn|authz|oauth|session|sessions|permission|permissions|rbac|acl|jwt|login)([/._-]|$)/i.test(f) },
  { category: 'billing', test: (f) => /(billing|payment|payments|invoice|invoices|checkout|stripe|subscription)/i.test(f) },
  { category: 'installer', test: (f) => /(^|\/)(install|setup|bootstrap|preinstall|postinstall)[^/]*\.(sh|bash|zsh|ps1|js|mjs|cjs|ts|py)$/i.test(f) },
  { category: 'p21', test: (f) => /p21/i.test(f) },
];

export function addedLinesMention(diffText, pattern) {
  return diffText.split('\n').some((l) => l.startsWith('+') && !l.startsWith('+++') && pattern.test(l));
}

export function riskPaths(files, diffText = '') {
  const categories = RISK_RULES
    .map((rule) => ({ category: rule.category, files: files.filter(rule.test) }))
    .map((c) => (c.category === 'p21' && c.files.length === 0 && addedLinesMention(diffText, /p21/i)
      ? { ...c, files: ['(identifier p21 in added lines)'] }
      : c))
    .filter((c) => c.files.length > 0);
  return { deep: categories.length > 0, needsHumanReview: categories.length > 0, categories };
}

function main(argv) {
  const diffAt = argv.indexOf('--diff');
  const diffText = diffAt === -1 ? '' : readFileSync(argv[diffAt + 1], 'utf8');
  const args = argv.filter((a, i) => a !== '--diff' && argv[i - 1] !== '--diff' && a !== '--stdin');
  const files = argv.includes('--stdin')
    ? readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    : args;
  console.log(JSON.stringify(riskPaths(files, diffText)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
