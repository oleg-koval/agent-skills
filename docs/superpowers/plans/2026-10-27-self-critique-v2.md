# Self-critique v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the self-critique score a function of a labelled claim ledger instead of a critic's vibe, blind the critic in round one, re-verify what the critic infers, restate the corrected answer, and give every durable rule a fire counter and a prune path, with a repeatable end-to-end test that proves a correct answer scores 90+ on round one and a seeded-wrong answer does not.

**Architecture:** Two small Node scripts carry the deterministic parts (`claim-ledger.mjs`: score, anchors, ratchet, summary table; `rule-store.mjs`: list, checklist, fire, prune, evidence cap over memory files). `SKILL.md` is rewritten to call them at fixed moments. A gated end-to-end test runs the skill headless with `claude -p` on two fixture answers against a fixture repo and asserts the scores and the refuted claims.

**Tech Stack:** Node 22 (ESM, `node:test`, no dependencies), POSIX sh test wrappers, Claude Code CLI 2.1.x for the gated e2e.

**Spec:** `docs/superpowers/specs/2026-10-27-self-critique-v2-spec.md` (sections "Weak parts", "Killer feature", "Changes recommended").

## Global Constraints

- Canonical content lives only at `plugins/olko-reflection/skills/self-critique/`; run `./scripts/build-adapters.sh` after any skill change and commit the generated tree (repo `CLAUDE.md`).
- No em dashes anywhere in skill content.
- `catalog/skills.json` is the only metadata source; the skill `description` there must match the SKILL.md frontmatter description.
- Node `>=22`, no new npm dependencies.
- Commit messages are conventional and never mention an assistant.
- Scripts must exit 0 and print nothing harmful on malformed input (same stance as `critique-nudge.mjs`): a malformed ledger prints a JSON error to stderr and exits 2, never throws a stack trace.
- The Stop hook is out of scope for this plan (the spec lists it; the user's pasted scope does not).

## Review Focus

1. A ledger where every claim is `verified` and nothing is `missed` must score exactly 100; a critic that returns no findings must not be able to lower the score (Task 1 test `scores 100 for a clean ledger`).
2. A claim labelled `checked_by: inferred` that the author accepted without re-verification is penalised, so a hallucinated critic finding costs the critic, not the author (Task 1 test `penalises accepted inferred findings`).
3. A memory file whose frontmatter has no `metadata.fires` key must still list, fire and prune without crashing (Task 3 test `fire adds the keys when missing`).
4. The e2e correct-answer fixture must reach 90+ on round one; if it does not, the scoring or the blind prompt is still inflating, and the test fails loudly rather than passing on round three (Task 6 assertion A).
5. A rule with more than three dated evidence lines is flagged, never silently truncated (Task 3 test `evidence-check flags a fourth incident`).

---

### Task 1: `claim-ledger.mjs` score, anchors, ratchet

**Files:**
- Create: `plugins/olko-reflection/skills/self-critique/scripts/claim-ledger.mjs`
- Create: `tests/self-critique-ledger.test.mjs`
- Create: `tests/test-self-critique-ledger.sh` (one line: `node --test tests/self-critique-ledger.test.mjs`, same shape as `tests/test-lekker-workflow.sh`)

**Interfaces:**
- Consumes: nothing.
- Produces: ESM exports `scoreLedger(ledger) -> { score: number, breakdown: Record<string, number> }`, `ratchet(prev, next) -> { winner: 'prev'|'next', score: number }`, `anchors() -> Array<{ label: string, ledger: Ledger, score: number }>`, `summaryMarkdown(ledger) -> string`. CLI: `node claim-ledger.mjs score <ledger.json>`, `ratchet <a.json> <b.json>`, `anchors`, `summary <ledger.json>`.

Ledger shape (JSON, validated by `validateLedger`, which returns a list of error strings):

```json
{
  "version": 1,
  "claims": [
    { "id": "c1", "text": "retries default to 3", "load_bearing": true,
      "origin": "both", "status": "verified", "checked_by": "read",
      "receipt": "config.json:2 \"retries\": 3" }
  ],
  "missed": [ { "id": "m1", "text": "handler swallows errors", "load_bearing": true } ]
}
```

Enumerations: `origin` in `author | critic | both`; `status` in `verified | refuted | unverifiable | inferred`; `checked_by` in `command | read | inferred`.

Penalty table (the whole scoring rule; copy verbatim into the script as one exported `PENALTIES` object):

| key | points |
| --- | --- |
| `refuted_load_bearing` | 25 |
| `refuted` | 10 |
| `unverifiable_load_bearing` | 10 |
| `unverifiable` | 4 |
| `inferred_accepted` (status `inferred`, any origin) | 5 |
| `missed_load_bearing` | 15 |
| `missed` | 5 |
| `only_critic_found` (origin `critic`, status `verified`: author relied on it without listing it) | 5 |

`score = max(0, 100 - sum)`. Ties in `ratchet` go to `next`.

- [ ] **Step 1: Write the failing tests**

```js
test('scores 100 for a clean ledger', () => {
  assert.equal(scoreLedger({ version: 1, claims: [verified('c1', true)], missed: [] }).score, 100)
})
test('applies the penalty table', () => {
  const l = { version: 1, claims: [refuted('c1', true), unverifiable('c2', false), inferred('c3', false)], missed: [{ id: 'm1', text: 'x', load_bearing: true }] }
  assert.deepEqual(scoreLedger(l), { score: 51, breakdown: { refuted_load_bearing: 25, unverifiable: 4, inferred_accepted: 5, missed_load_bearing: 15 } })
})
test('penalises accepted inferred findings', () => {
  assert.equal(scoreLedger({ version: 1, claims: [inferred('c1', false)], missed: [] }).score, 95)
})
test('floors at 0', () => { /* five refuted load-bearing claims */ assert.equal(score, 0) })
test('ratchet keeps the higher score and prefers next on a tie', () => {
  assert.deepEqual(ratchet(clean, bad), { winner: 'prev', score: 100 })
  assert.deepEqual(ratchet(clean, clean), { winner: 'next', score: 100 })
})
test('anchors are produced by the same function', () => {
  for (const a of anchors()) assert.equal(scoreLedger(a.ledger).score, a.score)
  assert.deepEqual(anchors().map((a) => a.score), [95, 72, 40])
})
test('validateLedger names every bad field', () => {
  assert.deepEqual(validateLedger({ version: 1, claims: [{ id: 'c1', status: 'maybe' }], missed: [] }),
    ['claims[0].text missing', 'claims[0].load_bearing missing', 'claims[0].origin missing', 'claims[0].status invalid: maybe', 'claims[0].checked_by missing'])
})
test('summaryMarkdown renders one row per claim with a status word', () => {
  assert.match(summaryMarkdown(l), /\| c1 \| .* \| refuted \|/)
})
test('cli exits 2 with a JSON error on malformed input', () => {
  const r = spawnSync('node', [script, 'score', badPath]); assert.equal(r.status, 2); JSON.parse(r.stderr)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `sh tests/test-self-critique-ledger.sh`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module**

Signatures: `validateLedger(ledger: unknown): string[]`, `scoreLedger(ledger: Ledger): { score, breakdown }` (breakdown omits zero keys), `ratchet(prev: Ledger, next: Ledger)`, `anchors()`, `summaryMarkdown(ledger)` producing a table with columns `id | claim | origin | status | checked_by | receipt`. The CLI branch runs only when `import.meta.url` matches `process.argv[1]`. The three anchors are hand-built ledgers: a 95 (one `unverifiable`), a 72 (one `refuted_load_bearing` and three `unverifiable` non-load-bearing... pick any combination the table makes exact), a 40.

- [ ] **Step 4: Run to verify they pass**

Run: `sh tests/test-self-critique-ledger.sh`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/olko-reflection/skills/self-critique/scripts/claim-ledger.mjs tests/self-critique-ledger.test.mjs tests/test-self-critique-ledger.sh
git commit -m "feat(self-critique): score from a labelled claim ledger with anchors and a ratchet"
```

### Task 2: Blind critic prompt and claim diff in SKILL.md

**Files:**
- Modify: `plugins/olko-reflection/skills/self-critique/SKILL.md` (sections "Procedure" steps 1 to 3, "Critic prompt template", "Notes")
- Modify: `catalog/skills.json` (self-critique `description`)

**Interfaces:**
- Consumes: Task 1 CLI commands and the ledger JSON shape.
- Produces: the round-one critic output contract used by Task 6's e2e: a fenced JSON block with `claims` (the critic's own list, each with `text`, `load_bearing`, `status`, `checked_by`, `receipt`), `missed`, `where_wrong`, `shapes`, `verdict`. No `score` field: the score is computed.

- [ ] **Step 1: Rewrite Step 1 (Snapshot)**: keep the receipt rules; add that the author's claim list is written to `.self-critique/author-claims.json` (array of `{ id, text, load_bearing, receipt }`) and is NOT shown to the critic in round one.

- [ ] **Step 2: Rewrite Step 2 (Spawn the critic)**: round one input is the original task text and the answer verbatim only. The critic extracts claims itself. Replace `{{CLAIMS_AND_SOURCES}}` in the template with `{{TASK}}`. Add to the "Do this" list: "Label every finding with `checked_by`: `command` (you ran it and quote the output), `read` (you opened the file or record and quote it), `inferred` (reasoning only)." Remove `score` from the critic's output list and add `claims`.

- [ ] **Step 3: Add Step 2b (Merge into the ledger)**: the author matches critic claims to author claims by meaning and sets `origin` (`both`, `author`, `critic`); every critic finding with `checked_by: inferred` is re-verified by the author before it may become `refuted`; if the author cannot verify it, it stays `inferred`. Save `.self-critique/ledger-v1.json`, run `node <skill>/scripts/claim-ledger.mjs score` and `summary`. State that claims found by only one side are reported under their own heading, "Asymmetric claims".

- [ ] **Step 4: Rewrite Step 3 (Decide and loop)**: stop at `score >= 90` or no actionable fixes; max 3 rounds; after a revision, run `ratchet` on the previous and new ledger and keep the winner; round two and later hand the critic the author's receipts for still-open claims (it is no longer blind). Add a cost line: the critic runs on a mid-tier model (Sonnet class) by default; escalate one tier only when a mid-tier round found nothing and the answer is load-bearing. Verify load-bearing claims first when the budget is tight.

- [ ] **Step 5: Paste the anchors**: add a "Score anchors" subsection containing the output of `node scripts/claim-ledger.mjs anchors` rendered as three short ledgers with their scores, and the penalty table from Task 1.

- [ ] **Step 6: Update the catalog description** to: "Adversarially critique your own last answer: a blind critic agent re-derives and verifies every claim against live sources, the score is computed from a labelled claim ledger, you revise under a ratchet, restate the corrected answer, and turn each caught error into a durable rule with a fire counter." Copy the same string into the SKILL.md frontmatter `description`.

- [ ] **Step 7: Rebuild and validate**

Run: `./scripts/build-adapters.sh && npm run validate && git diff --stat`
Expected: validators pass; generated adapters for self-critique changed.

- [ ] **Step 8: Commit**

```bash
git add -A plugins/olko-reflection/skills/self-critique catalog/skills.json adapters .claude-plugin .cursor-plugin .grok-plugin .github/prompts .github/copilot-instructions.md
git commit -m "feat(self-critique): blind round-one critic, computed score, checked_by labels"
```

### Task 3: `rule-store.mjs` list, checklist, fire, prune, evidence cap

**Files:**
- Create: `plugins/olko-reflection/skills/self-critique/scripts/rule-store.mjs`
- Create: `tests/self-critique-rule-store.test.mjs`
- Create: `tests/test-self-critique-rule-store.sh`

**Interfaces:**
- Consumes: a directory of Claude Code memory files: Markdown with a YAML frontmatter block holding `name`, `description`, and a `metadata:` map indented by two spaces (observed format: `metadata:\n  type: feedback\n  modified: ...`).
- Produces: exports `parseRule(text) -> { name, description, metadata: Record<string,string>, body }`, `serializeRule(rule) -> string`, `listRules(dir) -> Rule[]`, `checklistMarkdown(dir) -> string`, `fire(dir, name, isoDate) -> Rule`, `prune(dir, { idleDays, today }) -> Array<{ name, reason: 'never-fired' | 'idle' }>`, `evidenceCheck(dir, { max: 3 }) -> Array<{ name, count }>`. CLI mirrors them: `list --dir`, `checklist --dir`, `fire <name> --dir --date`, `prune --dir --idle-days 60 --date`, `evidence-check --dir`.

An evidence line is a body line matching `/^\s*-\s.*\b20\d\d-\d\d-\d\d\b/`.

- [ ] **Step 1: Write the failing tests** (each builds a tmp dir with two fixture files, one with `metadata.fires: 2` and `metadata.last_fired: 2026-09-01`, one with no such keys)

```js
test('listRules reads name, description, fires and last_fired', ...)        // fires defaults to 0, last_fired to null
test('checklistMarkdown emits one bullet per rule: "- [name]: description"', ...)
test('fire adds the keys when missing', () => { const r = fire(dir, 'rule-b', '2026-10-27'); assert.equal(r.metadata.fires, '1'); assert.equal(r.metadata.last_fired, '2026-10-27'); assert.match(readFileSync(fileB,'utf8'), /^  fires: 1$/m) })
test('fire increments and preserves every other frontmatter line and the body byte for byte', ...)
test('prune lists never-fired and idle rules only', () => { assert.deepEqual(prune(dir, { idleDays: 30, today: '2026-10-27' }), [{ name: 'rule-a', reason: 'idle' }, { name: 'rule-b', reason: 'never-fired' }]) })
test('evidence-check flags a fourth incident', () => { /* body with 4 dated bullets */ assert.deepEqual(evidenceCheck(dir, { max: 3 }), [{ name: 'rule-c', count: 4 }]) })
test('a file without frontmatter is skipped, not thrown', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `sh tests/test-self-critique-rule-store.sh`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module.** Frontmatter parsing is line based (no YAML library): top-level `key: value` and `metadata:` followed by two-space-indented `key: value` lines. `serializeRule` must round-trip `parseRule` output unchanged when nothing was modified (the byte-for-byte test pins this).

- [ ] **Step 4: Run to verify they pass**

Run: `sh tests/test-self-critique-rule-store.sh`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/olko-reflection/skills/self-critique/scripts/rule-store.mjs tests/self-critique-rule-store.test.mjs tests/test-self-critique-rule-store.sh
git commit -m "feat(self-critique): rule store with fire counter, prune and evidence cap"
```

### Task 4: Step 5 rewrite: rules that prove their worth

**Files:**
- Modify: `plugins/olko-reflection/skills/self-critique/SKILL.md` (section "Step 5" and "Notes")

**Interfaces:**
- Consumes: Task 3 CLI.

- [ ] **Step 1: Add a replay pass to Step 1 (Snapshot)**: before spawning the critic, run `node <skill>/scripts/rule-store.mjs checklist --dir <memory dir>` and check the answer against every rule. Each hit is tagged `(recurring)` in the report and recorded with `fire <name> --date <today>`. State the memory dir resolution: Claude Code auto-memory dir for the current project, else the repo's `.claude/memory`, else skip with a one-line note.

- [ ] **Step 2: Replace "sharpen the existing entry"** with: add one dated evidence line to the existing rule, maximum three per rule; a fourth incident means the rule named the incident, not the shape: rewrite the rule text, keep the three most recent evidence lines. Run `evidence-check` before writing and report any flagged rule.

- [ ] **Step 3: Add a prune pass**: at the end of Step 5 run `prune --idle-days 60`; list candidates in the report under "Rules proposed for deletion"; never delete without the user's reply.

- [ ] **Step 4: Rewrite Step 4 (Report)**: the report opens with the full corrected answer (`v_final`, restated in full, not a diff), then the claim ledger table from `summary`, then Where you were wrong, Asymmetric claims, Recurring rules fired, Iterations, Score trajectory, Unverifiable, Declined fixes, Rules written, Rules proposed for deletion.

- [ ] **Step 5: Rebuild, validate, commit**

Run: `./scripts/build-adapters.sh && npm run validate`

```bash
git add -A plugins/olko-reflection/skills/self-critique adapters .claude-plugin .cursor-plugin .grok-plugin .github/prompts .github/copilot-instructions.md
git commit -m "feat(self-critique): replay stored rules, fire counters, prune pass, restate the corrected answer"
```

### Task 5: Fixtures for the end-to-end test

**Files:**
- Create: `tests/fixtures/self-critique/repo/config.json` with exactly `{ "retries": 3, "timeout_ms": 5000 }`
- Create: `tests/fixtures/self-critique/repo/handler.js`: reads `config.json`, loops `retries` times calling an injected `fn`, wraps it in `try { } catch { }` with an empty catch (the swallowed error is the load-bearing claim a good critic must list under `missed`).
- Create: `tests/fixtures/self-critique/task.md`: "Explain how handler.js retries and times out, and name any error-handling risk."
- Create: `tests/fixtures/self-critique/answer-correct.md`: four claims, all true (retries 3, timeout 5000 ms, loop stops on first success, errors are swallowed by an empty catch), each with a `file:line` receipt.
- Create: `tests/fixtures/self-critique/answer-seeded.md`: claims retries 5 (wrong), timeout 30 s (wrong), "the production dashboard shows zero errors for this handler" (unverifiable), omits the swallowed-error risk (missed, load-bearing).
- Create: `tests/fixtures/self-critique/expected.json`: `{ "correct": { "min_round1_score": 90 }, "seeded": { "max_round1_score": 70, "must_refute": ["retries", "timeout"], "must_miss": ["swallow"] } }`

- [ ] **Step 1: Write the fixtures as specified.**
- [ ] **Step 2: Verify `node tests/fixtures/self-critique/repo/handler.js` runs and exits 0.**
- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/self-critique
git commit -m "test(self-critique): fixture repo with a correct and a seeded-wrong answer"
```

### Task 6: Gated end-to-end test with `claude -p`

**Files:**
- Create: `tests/test-self-critique-e2e.sh`
- Create: `tests/self-critique-e2e.mjs` (the runner; the sh wrapper only gates and calls it)

**Interfaces:**
- Consumes: Task 2's critic output contract, Task 1's `score` CLI, Task 5 fixtures.
- Produces: a receipt file `tests/.artifacts/self-critique-e2e-<date>.json` with both ledgers and scores.

- [ ] **Step 1: Write the sh wrapper**: if `SELF_CRITIQUE_E2E` is not `1`, print `skip: set SELF_CRITIQUE_E2E=1 to run the headless critique` and exit 0 (so `npm test` stays green in CI); else `node tests/self-critique-e2e.mjs`.

- [ ] **Step 2: Write the runner.** For each of `correct` and `seeded`: copy the fixture repo to a tmp dir, run `claude -p --output-format json --model sonnet --allowedTools "Read,Grep,Glob,Bash(node:*)" --add-dir <tmp>` with a prompt that passes the task text and the answer text and the round-one critic prompt from SKILL.md verbatim (read it from the file between the markers `## Critic prompt template` and the next `## `), requiring a fenced JSON block as the final output. Parse the block, build a ledger where every critic claim gets `origin: both` when its text shares a keyword with an author claim, else `critic`; score it with `claim-ledger.mjs score`. Assert:
  - A: `correct.score >= expected.correct.min_round1_score`
  - B: `seeded.score <= expected.seeded.max_round1_score`
  - C: every word in `must_refute` appears in the text of a `refuted` claim; every word in `must_miss` appears in `missed`
  Print the two scores and the per-claim summary tables, write the receipt file, exit 1 on any failed assertion with the assertion letter.

- [ ] **Step 3: Run it for real, once, and keep the receipt**

Run: `SELF_CRITIQUE_E2E=1 sh tests/test-self-critique-e2e.sh`
Expected: `correct: <score>` at or above 90, `seeded: <score>` at or below 70, assertions A, B, C pass. If A fails, the blind prompt or the penalty table is still inflating: fix the prompt wording in Task 2 (not the threshold) and rerun. Paste the two scores and the receipt path into the PR body.

- [ ] **Step 4: Run the full suite**

Run: `npm run build && git diff --exit-code && npm test`
Expected: all pass; generated tree not stale.

- [ ] **Step 5: Commit**

```bash
git add tests/test-self-critique-e2e.sh tests/self-critique-e2e.mjs tests/.artifacts/self-critique-e2e-*.json
git commit -m "test(self-critique): headless e2e proves a correct answer scores 90+ blind and a seeded one does not"
```

### Task 7: Docs and PR

**Files:**
- Modify: `README.md` (self-critique row: description), `docs/superpowers/specs/2026-10-27-self-critique-v2-spec.md` (append a "Shipped" line with the e2e scores)

- [ ] **Step 1: Update the README row to the new catalog description; run `npm run validate`.**
- [ ] **Step 2: Open the PR** against the default branch with a "TL;DR (for humans)" first: what changed for someone running `/self-critique` (blind critic, computed score, corrected answer restated, rules with fire counters), the two e2e scores, and "no change to other skills". Receipts below.
- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-27-self-critique-v2-spec.md
git commit -m "docs(self-critique): v2 description and e2e receipt"
```

---

## Self-review notes

- Spec coverage: weak part 1 (score) is Task 1 and 2; weak part 2 (anchored critic) is Task 2; weak part 3 (littering) is Task 3 and 4; weak part 4 (cost, labels, re-verify) is Task 2 steps 2 to 4; weak part 5 (restate) is Task 4 step 4. Killer features 1, 2, 3 map to Tasks 3 and 4, Task 1, and Task 2 respectively. The Stop hook is intentionally out of scope.
- "Test it actually works": Tasks 1 and 3 pin the deterministic parts; Task 6 is the only test of the prompt itself and is gated because it costs money and needs the CLI; it is run once by hand in Step 3 and its receipt is committed.
