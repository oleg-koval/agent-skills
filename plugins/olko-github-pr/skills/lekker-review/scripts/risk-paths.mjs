#!/usr/bin/env node
// Path-based risk for AUTO-DEPTH. Size alone misses the small PRs that matter:
// a 10-line change to a workflow file, a session check or a P21 mapping.
//
// Usage:
//   node risk-paths.mjs [--diff <pr.diff>] -- <changed-file>...
//   git diff --name-only -z <base>...HEAD | node risk-paths.mjs --stdin0 --diff <pr.diff>
// Use a shell-free process API for file arguments; never interpolate PR paths.
//
// Prints {"deep": bool, "needsHumanReview": bool, "categories": [{category, files}]}.
// `--diff` also lets the identifier `p21` count when it only appears in added lines.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RISK_RULES = [
  { category: 'ci-workflow', test: (f) => /^\.github\/workflows\//.test(f) },
  { category: 'auth', test: (f) => /(^|[/._-])(auth|authn|authz|authentication|authorization|oauth|session|sessions|permission|permissions|rbac|acl|jwt|login)([/._-]|$)/i.test(f.replace(/([a-z0-9])([A-Z])/g, '$1-$2')) },
  { category: 'billing', test: (f) => /(billing|payment|payments|invoice|invoices|checkout|stripe|subscription)/i.test(f) },
  { category: 'installer', test: (f) => /(^|\/)(install|setup|bootstrap|preinstall|postinstall)(?:[^/.]*|[^/]*\.(sh|bash|zsh|ps1|js|mjs|cjs|ts|py|bat|cmd))$/i.test(f) },
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
  let diffText = '';
  let inputMode = null;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      files.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--diff') {
      if (!argv[i + 1] || argv[i + 1] === '--') throw new Error('--diff requires a file');
      diffText = readFileSync(argv[++i], 'utf8');
    } else if (arg === '--stdin' || arg === '--stdin0') {
      if (inputMode) throw new Error('Choose only one stdin mode');
      inputMode = arg;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}; put filenames after --`);
    } else {
      files.push(arg);
    }
  }
  if (inputMode) {
    if (files.length) throw new Error('Do not mix stdin and file arguments');
    files.push(...readFileSync(0, 'utf8').split(inputMode === '--stdin0' ? '\0' : '\n').filter(Boolean));
  }
  console.log(JSON.stringify(riskPaths(files, diffText)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
