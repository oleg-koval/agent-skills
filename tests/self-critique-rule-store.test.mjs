import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseRule,
  serializeRule,
  listRules,
  checklistMarkdown,
  fire,
  prune,
  evidenceCheck,
} from '../plugins/olko-reflection/skills/self-critique/scripts/rule-store.mjs';

const RULE_A = `---
name: rule-a
description: First rule
metadata:
  type: feedback
  fires: 2
  last_fired: 2026-09-01
  modified: 2026-08-01
---
Body of A.

- evidence 2026-08-01
`;

const RULE_B = `---
name: rule-b
description: Second rule
metadata:
  type: feedback
  modified: 2026-06-01
---
Body of B.
Line two.
`;

function fixtureDir(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-store-'));
  fs.writeFileSync(path.join(dir, 'a.md'), RULE_A);
  fs.writeFileSync(path.join(dir, 'b.md'), RULE_B);
  for (const [file, text] of Object.entries(extra)) {
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

test('listRules reads name, description, fires and last_fired', () => {
  const rules = listRules(fixtureDir());
  assert.deepEqual(
    rules.map((r) => ({
      name: r.name,
      description: r.description,
      fires: Number(r.metadata.fires ?? 0),
      lastFired: r.metadata.last_fired ?? null,
    })),
    [
      { name: 'rule-a', description: 'First rule', fires: 2, lastFired: '2026-09-01' },
      { name: 'rule-b', description: 'Second rule', fires: 0, lastFired: null },
    ],
  );
});

test('checklistMarkdown emits one bullet per rule: "- [name]: description"', () => {
  assert.equal(
    checklistMarkdown(fixtureDir()),
    '- [rule-a]: First rule\n- [rule-b]: Second rule\n',
  );
});

test('fire adds the keys when missing', () => {
  const dir = fixtureDir();
  const r = fire(dir, 'rule-b', '2026-10-27');
  assert.equal(r.metadata.fires, '1');
  assert.equal(r.metadata.last_fired, '2026-10-27');
  const text = fs.readFileSync(path.join(dir, 'b.md'), 'utf8');
  assert.match(text, /^  fires: 1$/m);
  assert.match(text, /^  last_fired: 2026-10-27$/m);
  assert.ok(text.endsWith('Body of B.\nLine two.\n'));
});

test('fire increments and preserves every other frontmatter line and the body byte for byte', () => {
  const dir = fixtureDir();
  assert.equal(serializeRule(parseRule(RULE_A)), RULE_A);
  fire(dir, 'rule-a', '2026-10-27');
  const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  assert.equal(
    after,
    RULE_A.replace('fires: 2', 'fires: 3').replace('last_fired: 2026-09-01', 'last_fired: 2026-10-27'),
  );
});

test('prune lists never-fired and idle rules only', () => {
  const dir = fixtureDir();
  assert.deepEqual(prune(dir, { idleDays: 30, today: '2026-10-27' }), [
    { name: 'rule-a', reason: 'idle' },
    { name: 'rule-b', reason: 'never-fired' },
  ]);
  assert.deepEqual(prune(dir, { idleDays: 90, today: '2026-10-27' }), [
    { name: 'rule-b', reason: 'never-fired' },
  ]);
});

test('evidence-check flags a fourth incident', () => {
  const ruleC = `---
name: rule-c
description: Many incidents
metadata:
  type: feedback
---
Why:

- incident 2026-01-01
- incident 2026-02-02
  - nested 2026-03-03
- incident 2026-04-04
- a plain bullet without a date
`;
  const dir = fixtureDir({ 'c.md': ruleC });
  assert.deepEqual(evidenceCheck(dir, { max: 3 }), [{ name: 'rule-c', count: 4 }]);
});

test('a file without frontmatter is skipped, not thrown', () => {
  const dir = fixtureDir({
    'MEMORY.md': '# Index\n\n- [a](a.md)\n',
    'broken.md': '---\nname: x\nno closing fence\n',
    'notes.txt': 'not markdown',
  });
  assert.deepEqual(listRules(dir).map((r) => r.name), ['rule-a', 'rule-b']);
  assert.doesNotThrow(() => prune(dir, { idleDays: 30, today: '2026-10-27' }));
});

test('does not propose a fresh rule that has never fired', () => {
  const dir = fixtureDir({ 'c.md': '---\nname: rule-c\ndescription: Fresh\n---\nBody.\n' })
  const names = prune(dir, { idleDays: 30, today: new Date().toISOString().slice(0, 10) }).map((p) => p.name)
  assert.ok(!names.includes('rule-c'))
});

test('proposes a never-fired rule older than idleDays', () => {
  const dir = fixtureDir({ 'c.md': '---\nname: rule-c\ndescription: Old\n---\nBody.\n' })
  const old = new Date(Date.now() - 100 * 86_400_000)
  fs.utimesSync(path.join(dir, 'c.md'), old, old)
  const today = new Date().toISOString().slice(0, 10)
  assert.deepEqual(prune(dir, { idleDays: 30, today }).filter((p) => p.name === 'rule-c'), [{ name: 'rule-c', reason: 'never-fired' }])
});
