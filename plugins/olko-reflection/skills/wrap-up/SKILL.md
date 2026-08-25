---
name: wrap-up
description: Verify that a completed implementation matches its original objective, all applicable checks are green, and task-owned temporary files, worktrees, and local branches are safely tidied.
license: MIT
compatibility: Codex, Claude Code, Cursor, GitHub Copilot, Windsurf, Kiro, Grok, and other Agent Skills compatible tools.
metadata:
  author: Oleg Koval
  tags:
    - delivery
    - verification
    - cleanup
    - git
    - worktrees
    - release-hygiene
---

# Wrap Up

Run this skill manually from time to time or as the final step after a task reaches its goal. It is a delivery audit and cleanup pass, not permission to expand scope or hide unfinished work.

## 1. Reconstruct the task

- Read the original request, acceptance criteria, task plan, and final diff.
- Write a short objective statement and an acceptance matrix: each requested outcome, its evidence, and its status.
- Compare the result with the original idea, not merely with the implementation plan. Mark anything ambiguous or unverified as `UNKNOWN` rather than assuming it is complete.
- Identify the exact repositories, worktrees, branches, files, services, and temporary paths owned by this task. Preserve pre-existing user work.

## 2. Verify the implementation

- Inspect the final diff and confirm every requested behavior is implemented.
- Check related tests, types, docs, configuration, migrations, and feature flags where the change requires them.
- Run the repository-defined checks appropriate to the change. Follow local instructions and use the project’s package scripts rather than bypassing its tooling.
- Prefer the smallest meaningful verification first, then the full applicable suite. Record exact commands and results.
- If a check fails, determine whether it is caused by this task. Do not call the task green because an unrelated check happened to pass.
- For user-facing behavior, require real browser/device or human evidence when that is part of acceptance; automated tests alone are not visual acceptance.

## 3. Verify delivery state

Keep these gates separate and evidence-backed:

- Local worktree: branch, `HEAD`, tracked changes, and untracked files.
- Remote: tracking branch and remote SHA, verified with Git or the existing provider CLI.
- PR: current title/body, merge state, review threads, and required checks, when applicable.
- CI: current-head status, not an old successful run.
- Deployment: actual deployed version or endpoint health, when applicable.
- Device or human QA: real acceptance evidence, when applicable.

Do not claim remote, PR, CI, deployment, or QA completion from a local test or commit alone. Do not push, merge, deploy, or delete a remote branch as a side effect of this skill unless the task explicitly authorized it.

## 4. Clean task-owned artifacts

Clean only paths created by this task or explicitly named for cleanup.

- Remove known temporary files, test output, logs, copied fixtures, and scratch directories after capturing any required evidence.
- Never recursively delete a broad directory, the workspace root, an unresolved glob, or an unknown untracked file.
- For dirty paths that predate this task or cannot be attributed confidently, leave them in place and report them.
- Check the repository’s worktree list and remove only task-owned worktrees that are clean and no longer needed. Use an exact path; never remove a worktree containing uncommitted user work.

## 5. Clean local branches safely

- Confirm the task branch has the intended commit and that the remote branch contains the same work when remote delivery was required.
- If the remote branch is merged, verify the merge state before deleting the local branch.
- If the remote branch is pushed but unmerged, treat it as the recovery point. Delete the local branch only when the task is delivered, the remote branch is confirmed intact, the worktree is clean, and the user’s workflow permits local deletion. Otherwise preserve it and report why.
- Never use force branch deletion or destructive checkout/reset commands unless the user explicitly requests that exact recovery operation.
- Before deleting a branch, verify it is not checked out by another worktree and that no unique local commits would be lost.

## 6. Report the result

Lead with the outcome. Use a short `DELIVERY RECEIPT` heading and a one- or
two-sentence summary before the fields. Add `STATUS`, `NEXT_PHASE`, and
`NEXT_STEP` near the top when follow-up work remains. Keep the required fields
flush-left and grouped with one blank line between logical groups, not between
every field. Keep each value concise and avoid repeating the same prose. Do
not use Markdown tables, decorative separators, bullets, emojis, or indented
continuation lines inside the canonical field block. Put `FINAL_STATUS` last.
Add `LOCAL_COMMIT` when a local commit exists. Always finish with this receipt,
using `NOT_APPLICABLE` for out-of-scope gates and `NOT_RUN` for applicable
checks that were not executed:

```text
DELIVERY RECEIPT

<short outcome summary>
STATUS: <DELIVERED | BLOCKED | INTENTIONALLY_UNCHANGED>
NEXT_PHASE: <next phase or NOT_APPLICABLE>
NEXT_STEP: <single smallest next action or NOT_APPLICABLE>

OBJECTIVE:
CHANGED:
NOT_CHANGED:

TESTS:
BUILD:

REMOTE:
PR:
CI:
DEPLOYMENT:
DEVICE_OR_HUMAN_QA:

KNOWN_LIMITATIONS:
LOCAL_COMMIT: <hash and subject, or NOT_APPLICABLE>
FINAL_STATUS:
```

`FINAL_STATUS` must be exactly one of `DELIVERED`, `BLOCKED`, or `INTENTIONALLY_UNCHANGED`. Use `BLOCKED` when required evidence or cleanup cannot safely be completed; name the blocker and next action. Never promote a partial result to `DELIVERED`.
