---
name: pr-finalize-complete
description: >
  Comprehensive PR finalization workflow for PRs that may already be partially or fully addressed.
  Checks the current state of all review comments (CodeRabbit, Qodo, Greptile, human), identifies
  which issues are already resolved vs. still open, verifies the test suite passes, runs linting,
  and prepares a clean push. Handles stale bot comments on moved/renamed files, direct unit test
  gaps, and branch conflict resolution. Use when a PR has been worked on and you need to confirm
  it is truly ready to merge, or when review tools show findings that may already be fixed.
compatibility: Requires git and gh authenticated. Review-bot sweeps only cover bots actually installed on the repo.
metadata:
  version: "1.0"
allowed-tools: Bash(gh:*) Bash(git:*)
---

# PR Finalize Complete

Confirm a PR is genuinely merge-ready -- even when all issues were already addressed -- by verifying the evidence, not trusting the assumption.

## When to use this vs pr-finalize

Use pr-finalize-complete when:
- The branch owner says "it should be fixed already" and you need to confirm
- Review bot findings may be stale (comments on old file paths, already-changed code)
- You need to produce a verification report, not just drive fixes
-- CI was green before but you need to re-confirm after a rebase

Use pr-finalize when starting from scratch on an unaddressed PR.

## Inputs

- **PR number or URL** (optional): detect from the current branch if not given.
- `--no-push` (optional): run all verification steps but skip the final push.

## Non-negotiables

- **Never claim a test passed without running it.** Report the actual exit code and test count.
- **Never resolve a bot comment without checking whether the issue still exists in the current code.** Stale comments are common and silently resolving them is wrong.
- **Never git add -A.** Start with a clean tree; stage only files your fixes actually touched.
- **Stale comments are not done -- they are no longer applicable.** Distinguish the two in your report.

## Instructions

### 1. Establish ground truth

```bash
gh pr view <PR> --json number,title,body,state,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,reviews,statusCheckRollup,url
```

Record before touching anything:

- Is the branch **clean** (`git status --porcelain` empty)?
- Is the branch **behind** `origin/<base>`?
- What **checks are currently failing**, and which are required?
- Which bots have actually posted (completed, not just triggered)?

### 2. Rebase only if needed

If mergeable is CONFLICTING or the branch is behind its base:

```bash
git fetch origin <base>
git rebase origin/<base>
```

Resolve conflicts by understanding both sides. After resolving, run tests before continuing.
If there is no conflict, skip this step -- do not rebase speculatively.

### 3. Triage existing review comments

Collect all findings:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments --paginate
gh api repos/{owner}/{repo}/issues/<PR>/comments --paginate
gh pr view <PR> --json reviews
```

For each unresolved finding, determine its actual current status in the code:

| Status | Meaning | Action |
|---|---|---|
| Already fixed | Code the comment targets has been changed and issue no longer exists | Verify in code, reply confirming fix, resolve |
| Stale | Comment targets a file/line/symbol that no longer exists | Verify, reply noting it is stale, resolve |
| Still present | Issue exists in current code | Fix it, commit, reply, resolve |
| False positive | Bot diagnosis is wrong for this codebase | Reply with specific rebuttal, leave open |
| Needs human | Product/architecture decision required | Reply, leave open, surface in report |

A comment is stale if the file it targets has been deleted or
renamed, the function or class it names no longer exists, or the
issue was flagged on an old line that has since been rewritten.

Check for staleness before any fix attempt:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/files --paginate
git diff origin/<base>...HEAD =- <file>
```

For stale comments: verify in current HEAD, reply explaining what changed, then resolve.

### 4. Verify test coverage

Find changed files:

```bash
gh pr view <PR> --json files -q '.files[].path'
```

For each changed module: check for a direct unit test file, confirm
it exercises the specific code paths changed, and run it to verify
impasses.

If a module has no direct unit tests but is only indirectly covered,
that is a real gap. Add direct tests unless the coverage gap is
explicitly justified.

### 5. Run the real gates

Discover from the repo -- do not guess target names:

```bash
cat package.json | jq '.scripts'
```

Run in order: lint, format check, full test suite. Capture the actual
exit code and output. Do not push if any required gate is red.

### 6. Push and report

If there were changes to commit:

```bash
git add <only files you touched>
git commit -m "address review feedback and verify tests"
git push --force-with-lease
```

Post one PR comment with a verifiable summary: rebase status, each
finding and its disposition, test coverage decision, and verbatim
gate output with real numbers.

### 7. Verify final state

```bash
gh pr view <PR> --json mergeable,mergeStateStatus,statusCheckRollup
```

Poll until checks complete. If anything that was green went red,
diagnose and fix before declaring done.

## Common patterns

### Pattern: All issues already fixed

When a bot shows open findings but the branch owner believes they
are all resolved:
1. Do not trust the assertion -- verify each one in the current code.
2. Stale comments are the most common case: the code was refactored
   and the bot finding path no longer exists.
3. Distinguish "already fixed before bot ran" from "fixed in a later
   commit the bot has not re-reviewed yet".
4. Re-trigger the bot if it has not reviewed current HEAD.

### Pattern: Direct unit tests missing

Bots frequently flag helper functions exercised only through callers.
Add a direct test for the helper itself -- do not rely on indirect
coverage through a caller integration test.

### Pattern: Branch conflict with rewritten shared file

When rebase hits a conflict in a file both branches modified:
1. Run git log to understand what main changed and why.
2. Read the purpose of the main-side hunk -- it is usually an invariant
   your branch is unaware of.
3. Apply main's change to your version of the file, then re-run
   the affected tests.
4. Document which invariant you preserved in your PR comment.

### Pattern: CI flaky on first push

Before declaring a gate failure real:
1. Check if the failure is in a known flaky test.
2. Check if the failure is in a linter with a stale cache from a
   different worktree.
3. Re-run the specific failing check once before fixing.
4. Only fix if the failure reproduces on re-run.

## Related skills

- pr-finalize -- drive a PR from scratch to merge-ready when comments are unaddressed.
- qodoloop -- full Qodo thread protocol (per-finding Agent Prompts, resolve mutations).
- coderabbitloop -- full CodeRabbit thread protocol.
- ci-fix-loop -- when the blocker is a failing CI pipeline, not review feedback.
