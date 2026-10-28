import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewRules } from '../plugins/olko-github-pr/skills/lekker-review/scripts/apply-review-rules.mjs';

const projectRules = [
  '=== repo/REVIEW.md ===',
  '## Paths to IGNORE',
  '- generated/**',
  '- docs/drafts',
  '',
].join('\n');

test('ignore paths filter unchanged findings but retain changed files', () => {
  const payload = {
    findings: [
      { file: 'generated/out.mjs' },
      { file: 'src/changed.mjs' },
      { file: 'docs/drafts/old.md' },
    ],
    preExisting: [{ file: 'generated/old.mjs' }],
  };
  assert.deepEqual(applyReviewRules(payload, {
    projectRules,
    changedPaths: ['generated/out.mjs', 'src/changed.mjs'],
  }), {
    findings: [{ file: 'generated/out.mjs' }, { file: 'src/changed.mjs' }],
    preExisting: [],
  });
});

test('missing changed paths fail open and retain findings', () => {
  const payload = { findings: [{ file: 'generated/out.mjs' }] };
  assert.deepEqual(applyReviewRules(payload, { projectRules }), payload);
});

test('supports direct ignore directives and recursive glob matching', () => {
  const payload = { findings: [{ file: 'vendor/lib/a.js' }, { file: 'vendorish/a.js' }] };
  assert.deepEqual(applyReviewRules(payload, {
    projectRules: '=== repo/REVIEW.md ===\nIGNORE: vendor/**',
    changedPaths: [],
  }).findings, [{ file: 'vendorish/a.js' }]);
});
