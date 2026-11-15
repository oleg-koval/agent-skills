---
name: namespace-runner-migration
description: USE THIS SKILL AUTOMATICALLY for GitHub Actions migrations to or from Namespace. Inventory workflow runners, validate the requested destination, open the migration and paired rollback PRs, and create a trial-end calendar reminder only when requested and verified.
metadata:
  short-description: Migrate GitHub Actions runners to or from Namespace
---

# Namespace Runner Migration

Use this skill for runner migrations where Namespace is the source or destination. Do not use it for migrations between other providers; use the provider-specific workflow.

## Workflow

1. Read repository instructions and inspect the live repository, workflow files, and actual migration PR base branch. Preserve unrelated checkout changes with an isolated worktree.
2. Inventory every workflow job's `runs-on`, conditional routing, relevant security conditions, and the current provider. Confirm the requested source and destination providers before editing.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:3dd0437972d4d9874b43bf74c7c7c50a7a7a760e6f771bc7a193d5f8fbd6ffc6 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f5b45380e5ca6ccee592b970057819b03e1d6ebac0bf4f1c316dc8728500cc13 -->

3. Confirm the destination selector from the user or an authoritative provider source. For Namespace destinations, verify the exact `namespace-profile-*` label; do not assume the account name is the profile name. For migrations away from Namespace, verify the actual destination selector, such as `ubuntu-latest`, or the requested provider's documented label. Do not require Namespace details when Namespace is not the destination.
4. Change only the selectors needed for the migration. Preserve triggers, permissions, job conditions, deployment gates, and step behavior. Update comments that become false. Preserve and assess security guards independently of the runner change.
5. Validate each changed job against the requested destination provider, and search for remaining old selectors. Check Namespace profile labels and acceptance only when Namespace is the destination. Run the repository's applicable checks and report any check that cannot run. A configured selector is not proof of live runner acceptance; verify a completed job on the destination provider before claiming acceptance.
6. Prevent duplicate work before making external writes. Search for an existing migration PR and reuse or update it when it represents this migration. Use one deterministic migration branch per repository, base branch, and migration. Creating that branch is the concurrency claim: if it already exists, inspect and reuse its work rather than creating a second branch. Recheck open PRs after pushing. Stop if another concurrent change makes ownership or scope unclear.
7. Record the migration PR's exact head SHA and actual base branch. Open the migration PR as a draft until its rollback is prepared. Do not mark it ready while the rollback PR is missing. If rollback creation fails, keep the migration draft, diagnose once, and resume from the recorded branch and SHA. Do not report the pair as complete until both PRs exist and their diffs are verified.
8. Prepare the paired rollback so it restores the original runner selectors:
   - Before the migration merges, branch from its exact head SHA and apply the inverse runner diff. Open a draft rollback PR with the migration PR's head branch as its base, so the visible diff is the inverse runner change. Verify the PR diff explicitly.
   - If the migration changes after the rollback is prepared, record the new head SHA and rebuild or update the rollback from that exact head. Verify that every changed runner selector is restored and unrelated migration-branch changes are not reverted.
   - After the migration merges, including when it is already merged at the start of this task, read its actual merge result and actual base branch from the merged PR metadata. Fetch the updated base branch and rebuild the rollback branch from its current tip, cherry-picking only the inverse runner commit. If no rollback commit exists yet, apply the inverse runner diff there. Open or retarget the rollback PR against that actual base branch. Do not assume GitHub retargeting preserves a useful diff after squash or rebase merges. Verify the resulting PR diff is non-empty and restores the exact original runner settings before marking the rollback ready.
   - A cherry-pick rollback targeting the integration branch is valid only after the migration is merged there. Before then, keep the rollback draft based on the migration PR's head branch so its diff remains the inverse runner change.
   - Check branch deletion settings before relying on a dependent PR. Preserve the migration branch until the rollback is rebuilt from the merge result and retargeted. If branch retention cannot be ensured, keep the migration PR draft and do not claim the paired rollback is safe to merge.
   - Use the migration PR's actual base branch throughout. Never assume it is named `main`.


<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

9. If, and only if, the user requests a calendar reminder, verify the trial end date from an authoritative source or the user. Search the calendar for an existing reminder with the same title and date; update or reuse it instead of creating a duplicate. If the date is unknown, ask for it and continue independent migration work. Create an all-day event with no attendees or invitations, and include links to both PRs.
10. Re-read the live PR states, exact branch SHAs, complete check rollups, and any calendar event after writes. Report migration and rollback PRs, their dependency and verified diffs, local and remote checks, and live runner acceptance separately.

## Boundaries

- Creating a calendar event requires an explicit request. A migration request alone does not authorize a calendar write.
- Never merge either PR, change provider billing, or enable runner profiles unless separately requested.
- If a destination runner is unavailable or incompatible with a job, document the blocker rather than silently falling back to another provider.
- Keep PR bodies factual, use a `TL;DR (for humans)` section, avoid placeholder ticket references, and omit generated attribution footers.
