# fix-mode.md -- lekker-review `--fix` procedure

Run this AFTER the review has been printed and saved to `~/code-reviews/`, and
ONLY when `FIX_MODE=true` (either `--fix` was passed, or the user answered yes to
the post-review offer).

Fix mode turns verified findings into real commits on the PR branch. It edits
only the isolated review worktree, never the user's checkout, and it never
pushes without explicit confirmation.

**Never fix and push in the same breath as reporting.** Committing is local and
reversible; pushing writes to someone else's branch and is outward-facing.

---

## Step 1 -- Preconditions (all must hold, else stop and report)

| Precondition | Check | If it fails |
|--------------|-------|-------------|
| Worktree exists | `WORKTREE_PATH` non-null and the dir exists | Run `scripts/setup-worktree.sh` now, then continue. Fix mode cannot work from the diff alone. |
| Worktree is clean | `git -C <WORKTREE_PATH> status --porcelain` is empty | Stop. Report the dirty paths -- something already edited it. |
| Head still current | `git -C <repoRoot> fetch origin <PR_BRANCH>` then compare `git rev-parse origin/<PR_BRANCH>` to `headSha` | Head moved during the review. Stop, report both shas, tell the user to re-run: the review is stale and fixes could clobber new work. |
| PR is open | `gh pr view <PR_NUMBER> --repo <REPO_SLUG> --json state,mergedAt` | Stop if MERGED or CLOSED. |
| PR is not from a fork you cannot write to | `gh pr view --json headRepositoryOwner,maintainerCanModify` | If the head repo is a fork and `maintainerCanModify` is false, fixes can be committed locally but NOT pushed. Say so up front, before spending agents. |

The worktree checkout is a **detached HEAD** at `origin/<PR_BRANCH>` (see
`setup-worktree.sh`). That is intentional -- do not create or check out a
branch in it. Commits land on the detached HEAD and are pushed with an explicit
refspec in Step 6.

---

## Step 2 -- Select the findings to fix

Eligible finding = severity `critical` or `important`, has a non-empty `fix`
field, and its `file` exists in the worktree.

- Findings without a `fix` field are review-only. List them as "not
  auto-fixable" in the report; never guess a fix.
- `observation` and `idiomatic` findings are NEVER auto-fixed. They are
  judgment calls and non-blocking by definition.
- `PR-1` (title prefix) is not a code fix. Never edit the PR title as part of
  fix mode -- it stays a `⛔ CANNOT MERGE` instruction for the author.
- Skip any finding whose `file` is generated (`*/generated/*`, lockfiles,
  `*.snap`, build output). Report it as skipped-generated.

If the user chose "Critical only" at the offer prompt, filter to `critical`.

If nothing is eligible: say so in one line and skip to Step 8. Do not run the
workflow with an empty finding list.

Write the selected findings to `<scratchpad>/fix-findings.json` (receipt), then
state the plan before spending agents:

```
Fixing <N> finding(s) across <M> file(s): <file list>
Not auto-fixable: <N> (<reasons>)
```

---

## Step 3 -- Run the fix workflow

```
Workflow tool:
scriptPath: ${CLAUDE_PLUGIN_ROOT}/fix-workflow.js
args: {
  repoSlug,
  prNumber,
  worktreePath: "<WORKTREE_PATH>",
  diffFile:     "<scratchpad>/pr.diff",
  contextFile:  "<scratchpad>/context.json",
  promptDir:    "${CLAUDE_PLUGIN_ROOT}/references/agents",
  findings:     [ <the selected finding objects, verbatim> ]
}
```

Pass `findings` as a real JSON array, not a stringified one. The workflow groups
by file (one agent per file, so no two agents ever edit the same file), applies
the fix, then runs a read-only fix-verifier over the actual `git diff`. A
verdict other than `good` buys exactly one retry, then stops.

Return value:
`{groups, droppedGroups, agentCount, retryCount, outputTokens, turnTokensTotal}`,
one `groups` entry per file with `results[]`, `filesTouched[]`, `verdict`,
`problems[]`, `committable`. `outputTokens` is the fix workflow's own spend
(already excluding the review workflow that ran before it); `turnTokensTotal` is
the whole turn's pool. Report the former on the `Fix agents:` cost line.

If the Workflow tool is unavailable: fall back to launching one Agent per file
group on `sonnet` with `references/agents/fixer.md`, then one Agent per group
with `references/agents/fix-verifier.md`. Same rules, same verdict handling.
State the fallback in the report.

---

## Step 4 -- Revert what did not earn a commit

For every group with `committable: false` that touched files:

```bash
git -C <WORKTREE_PATH> checkout -- <each path in filesTouched>
```

Then confirm the revert landed:

```bash
git -C <WORKTREE_PATH> status --porcelain
```

Only committable groups' files may remain modified. Any leftover untracked file
from a reverted group gets removed explicitly (`rm -f <path>`), never with
`git clean -fd` (too blunt for a shared worktree).

`harmful` verdicts are a normal outcome, not a failure of the run: the finding
simply stays a review comment for the author. Report it as such.

---

## Step 5 -- Verify the fixed tree (fresh post-condition)

```bash
~/.claude/skills/lekker-review/scripts/verify-fixes.sh \
  <WORKTREE_PATH> <scratchpad>/fix-verify.json tests
```

Pass `tests` only when the diff touched logic and the repo has a `test` script;
pass `no-tests` for doc/config-only fixes or when the suite needs live infra.

Read the JSON and compare against the pre-fix baseline in `worktree.json`:

- `tscChangedTail` / `tscErrorCount` -- compare against the same two baseline
  keys. `tscChangedTail` is the attributable set (errors in files this branch
  touched, which now includes the files the fix agents wrote); an entry there
  that is not in the baseline was introduced by the fixes. A rise in
  `tscErrorCount` with no new `tscChangedTail` entry means the fix broke a file
  it does not own - treat that as introduced too. Revert the offending group's
  files (Step 4) and mark those findings `failed`. Never commit a tree with
  newly-introduced type errors.
- `eslintTail` -- same comparison. Both runs lint only changed files, so the
  comparison is like-for-like; check `eslintScope` matches the baseline's
  (`changed-files` vs `full-fallback`) before trusting a diff between the two.
- `testTail` / `testExitCode` -- a newly failing test caused by a fix means
  revert that group. A test that already failed on the baseline head is not
  yours; say so explicitly rather than silently ignoring it.
- `dirtyPaths` -- must contain only files declared by committable groups. An
  undeclared path is a red flag: revert it and report.

If a check was skipped (no `node_modules`, no config), say `skipped` in the
report. Skipped is a state, not a pass.

---

## Step 5b -- Proof flip (red → green)

For every group that is still `committable` after Step 5, collect the
findings in that group that carry `proof.proven === true` (the
`<scratchpad>/fix-findings.json` sidecar written in Step 2 has the `proof`
objects, including `testCode` and `testCommand`, alongside each finding). If a
committable group has no proven findings, skip it -- there is nothing to flip.

For each proven finding in a committable group:

1. **Re-materialize the test**: write `proof.testCode` back to its original
   filename (the same `lekker-proof-<file-slug>-<line>.test.ts` name it was captured
   under) at the worktree root.
2. **Run** exactly `proof.testCommand` (Bash `timeout` 120000).
3. **Judge**:
   - **PASSES now** -> the fix demonstrably resolves the finding. Record
     `proofFlip: green` for that finding in the Step 8 status table.
   - **STILL FAILS with the same assertion** -> the fix did not fix the bug.
     The group is NOT committable regardless of the fix-verifier's `good`
     verdict -- revert it (Step 4 procedure) and mark its findings `failed`
     with reason `proof still red after fix`. An executed test outranks a
     reviewer agent's opinion.
   - **Fails for a NEW, unrelated reason** (import broke, different error) ->
     the fix likely broke something else; same outcome: revert the group,
     mark its findings `failed`, and quote the new error in the reason.
4. **Delete the test file** and verify with `git -C <WORKTREE_PATH> status
   --porcelain` that only the fix edits remain -- no stray proof file, no
   other drift.

A group reverted at this step no longer participates in Step 6 (Commit) --
treat it exactly like a Step 4 revert. Re-run the `git status --porcelain`
check after any revert triggered here before moving on.

---

## Step 6 -- Commit (local only)

One commit per file group, in group order. Stage explicitly -- never `git add -A`,
never `git add .`:

```bash
git -C <WORKTREE_PATH> add -- <filesTouched for this group>
git -C <WORKTREE_PATH> commit -m "<subject>" -m "<body>"
```

Subject: `<TICKET_PREFIX> review fix: <short label>` where `TICKET_PREFIX` is the
`[TICKET-NNN]` from the PR title when there is one, omitted otherwise. Keep the
subject under 72 chars.

Body: one `- ` line per applied finding, using the fixer's `summary`, then:

```
Applied from lekker-review: <REVIEW_FILE>

Co-Authored-By: Claude Code <noreply@anthropic.com>
```

If two groups declared the same file, commit them together as one commit and
say so in the report.

Receipt after committing:

```bash
git -C <WORKTREE_PATH> log --oneline <headSha>..HEAD
git -C <WORKTREE_PATH> status --porcelain   # must be empty
```

---

## Step 7 -- Push (requires explicit confirmation)

Show the user, before asking:

- the commit list (`git log --oneline <headSha>..HEAD`)
- the full diffstat (`git diff --stat <headSha>..HEAD`)
- the per-finding table from Step 8

Then ask, in a single question: push these `<N>` commit(s) to
`<PR_BRANCH>` on `<REPO_SLUG>`, or leave them local?

**Unattended runs (cron, `/loop`, background agent): never push, never ask.**
Stop after Step 6, keep the worktree, and report the worktree path plus the
exact push command so a human can release it. This matches the standing
unattended-run rule: stage the artifact, a human releases it.

On confirmed push:

```bash
git -C <repoRoot> fetch origin <PR_BRANCH>
# guard: origin must still be at the sha we based the fixes on
git -C <repoRoot> rev-parse origin/<PR_BRANCH>   # must equal <headSha>
git -C <WORKTREE_PATH> push origin HEAD:refs/heads/<PR_BRANCH>
```

- If the guard sha differs, ABORT the push. Report that the branch moved and
  leave the commits local. Never `--force`, never `--force-with-lease`, never
  rebase someone else's branch.
- Never push to `main`, `master`, `staging`, or `develop`, whatever the branch
  variables say. Stop if `PR_BRANCH` is one of those.

Post-condition (fresh source, not the push output):

```bash
gh pr view <PR_NUMBER> --repo <REPO_SLUG> --json headRefOid,mergeStateStatus
```

Confirm `headRefOid` equals the local HEAD sha. Print
`✓ Pushed <N> commit(s) -> <PR_URL> (head now <new short sha>)`. If it does not
match, say the push is unconfirmed and stop -- do not retry.

Do NOT also post the fixed findings as inline review comments. When `--post` and
`--fix` both ran, post only the findings that were NOT applied; a comment asking
for a change you already committed is noise.

---

## Step 8 -- Report and record

Print a table:

| # | Finding | File | Status | proofFlip | Note |
|---|---------|------|--------|-----------|------|
| 1 | <title> | `<file>:<line>` | ✅ applied | green | <fixer summary> |
| 2 | <title> | `<file>:<line>` | ↩️ reverted | still-red | <verifier problem, or "proof still red after fix"> |
| 3 | <title> | `<file>:<line>` | ⏭️ skipped | n/a | <reason, e.g. needs cross-file change> |
| 4 | <title> | `<file>:<line>` | ❌ failed | n/a | <what blocked it> |

`proofFlip` is `green` (proof re-ran and passed), `still-red` (proof re-ran and
still failed, so the group was reverted per Step 5b), or `n/a` (the finding
carried no `proof.proven === true`, so Step 5b never ran for it).

Then append this section to `REVIEW_FILE` (the saved review), so the record and
the review never drift apart:

```markdown
---

## 🔧 Fixes applied

**Base:** `<headShaShort>` · **Commits:** <N> · **Pushed:** <yes, head now `<sha>` | no, local only at <WORKTREE_PATH>>
**Checks:** tsc <clean | N new errors | skipped> · eslint <...> · tests <passed | failed | skipped>
**Fix agents:** <N> (<retryCount> retried)
**Proof flips:** <M green / K still-red / rest n/a> *(include only when at least one finding carried `proof.proven === true`)*

| # | Finding | File | Status | proofFlip | Note |
...same table...
```

Re-read the file after writing and emit `✓ Fixes recorded -> <REVIEW_FILE>`.

Add one line to the `## 💰 Review Cost` block for fix-mode spend:

```
Fix agents:       <N> (sonnet): <outputTokens> output tokens, ~$<X.XX>
```

---

## Step 9 -- Cleanup override

The normal cleanup step removes the worktree. In fix mode:

- **Pushed successfully** -> clean up as usual.
- **Commits exist but were not pushed** -> KEEP the worktree and the repo clone.
  Print the path and the push command. Deleting it would destroy the only copy
  of the work.
- **Nothing was committed** -> clean up as usual.

---

## Failure rules

- Two identical failures = stop and diagnose. No loops.
- Never claim a fix landed without the `git log` / `git status` receipt.
- Never present the review's proposed `fix` text as though it were applied. Only
  a committed diff counts.
